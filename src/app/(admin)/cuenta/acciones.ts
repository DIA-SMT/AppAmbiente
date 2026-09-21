'use server'

/**
 * Mi cuenta: el correo con el que se entra al panel y la contraseña propia.
 *
 * Todo lo de acá es sobre la cuenta de quien está mirando la pantalla. El id
 * sale de la sesión y nunca de un campo del formulario, así que desde esta
 * pantalla no se le puede tocar la contraseña a nadie más.
 *
 * Es la pantalla que saca a las cuentas de coordinación de la contraseña con la
 * que las crearon —la de fábrica está escrita en el repositorio, que es
 * público—, y de ahí salen las tres decisiones que la ordenan:
 *
 *  · mientras la contraseña siga siendo la que le pusieron a la cuenta, no se
 *    pide la actual. No protege nada: la sabe quien creó la cuenta y, en las que
 *    vienen de antes, cualquiera que abra el repositorio. Pedirla sería poner
 *    una traba en el único camino que hay para salir de /cuenta;
 *
 *  · pero apenas hay una contraseña elegida, cambiarla exige escribir la
 *    anterior. Esta pantalla se abre sola en cualquier sesión viva —una notebook
 *    abierta en la oficina, una cookie robada— y sin esa exigencia quedarse con
 *    la cuenta sería escribir dos veces en un formulario;
 *
 *  · la nueva no puede ser la que ya tiene. Sin esa comprobación, escribir
 *    «123456» dos veces completa el trámite, apaga el aviso y deja la cuenta
 *    exactamente donde estaba, pero ahora dada por resuelta.
 */

import { revalidatePath } from 'next/cache'
import { esClaveValida, hashearCredencial, verificarCredencial } from '@db/credenciales'
import { conSesion } from '@db/sesion'
import type { Conexion } from '@db/client'
import { mensajeDeError } from '@/lib/datos'
import { esCorreoValido, normalizarCorreo } from '@/lib/correo'
import { exigirAdmin, type Sesion } from '@/lib/sesion'

export interface EstadoCuenta {
  error?: string
  aviso?: string
}

/** El mínimo real es el de esClaveValida (db/credenciales.ts); acá se lo nombra. */
const LARGO_MINIMO = 6

function traducir(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('perfiles_correo_idx')) {
    return 'Ese correo ya lo usa otra cuenta. Cada persona entra con el suyo.'
  }
  // El despliegue son dos pasos sueltos —el código a Vercel, el SQL a la base— y
  // van en ese orden. Entre uno y otro esta columna todavía no existe: decir qué
  // falta ahorra el rato de mirar un error de Postgres que no le habla a nadie.
  if (/column .*(correo|credencial_cambiada_en).* does not exist/i.test(m)) {
    return 'A la base todavía le falta la última actualización. Avisale a la Dirección de IA; '
      + 'mientras tanto entrás igual, como hasta ahora.'
  }
  return mensajeDeError(e)
}

interface FilaPropia {
  correo: string | null
  credencial_hash: string
}

interface FilaConMarca extends FilaPropia {
  credencial_cambiada_en: string | null
}

/**
 * El perfil de quien está mirando la pantalla. Nunca el de otro.
 *
 * Recibe la transacción abierta en vez de abrir la suya: lo que se lee acá —el
 * hash con el que se compara lo que escribieron— decide lo que se escribe un
 * renglón más abajo, y las dos cosas tienen que ver la misma fila.
 *
 * No nombra `credencial_cambiada_en` a propósito: guardarCorreo también corre
 * durante el rato que va entre que sube el código y se aplica la migración, y
 * ahí esa columna todavía no existe.
 */
async function perfilPropio(tx: Conexion, sesion: Sesion): Promise<FilaPropia | null> {
  const filas = await tx.consultar<FilaPropia>(
    `select correo, credencial_hash from perfiles where id = $1`,
    [sesion.perfilId],
  )
  return filas[0] ?? null
}

/** Lo mismo, más si la contraseña ya la eligió su dueño. */
async function perfilConMarca(tx: Conexion, sesion: Sesion): Promise<FilaConMarca | null> {
  const filas = await tx.consultar<FilaConMarca>(
    `select correo, credencial_hash, credencial_cambiada_en from perfiles where id = $1`,
    [sesion.perfilId],
  )
  return filas[0] ?? null
}

/**
 * Volver a probar quién sos antes de mudarle la puerta a la cuenta.
 *
 * Tener la sesión abierta no alcanza ni para cambiar el correo con el que se
 * entra ni para cambiar la contraseña: la sesión de coordinación dura doce horas
 * y esta pantalla está a un clic en cualquiera de ellas.
 *
 * No suma al contador de intentos fallidos del ingreso, y eso también es a
 * propósito: si sumara, alguien que consiguió una cookie podría trabarle la
 * cuenta a la coordinación escribiendo cualquier cosa acá cinco veces, que es
 * exactamente lo que este sistema no se puede permitir.
 */
function confirmarQueSosVos(p: FilaPropia, datos: FormData): string | null {
  const credencial = String(datos.get('credencial') ?? '')
  if (!credencial) return 'Escribí tu contraseña actual para confirmar que sos vos.'
  if (!verificarCredencial(credencial, p.credencial_hash)) {
    return 'Esa no es tu contraseña actual. Es la misma con la que entrás al panel.'
  }
  return null
}

/**
 * La contraseña nueva, escrita dos veces.
 *
 * Los espacios de los bordes se van antes de guardarla, igual que en el alta de
 * Usuarios: una contraseña que termina en un espacio que no se ve es una
 * contraseña que la persona no va a poder volver a escribir.
 */
function revisarClaveNueva(p: FilaPropia, datos: FormData): { error: string } | { hash: string } {
  const nueva = String(datos.get('nueva') ?? '').trim()
  const repetida = String(datos.get('repetida') ?? '').trim()

  if (!nueva) return { error: 'Escribí la contraseña que querés usar de ahora en más.' }
  if (nueva.length < LARGO_MINIMO) {
    return { error: `La contraseña va de ${LARGO_MINIMO} caracteres para arriba.` }
  }
  // Ya está recortada y ya pasó el mínimo: lo único que puede rechazar
  // esClaveValida a esta altura es que sea larguísima.
  if (!esClaveValida(nueva)) {
    return { error: 'Esa contraseña es demasiado larga. Con 128 caracteres alcanza.' }
  }
  if (nueva !== repetida) {
    return { error: 'Las dos no coinciden. Escribila igual en los dos campos.' }
  }
  if (verificarCredencial(nueva, p.credencial_hash)) {
    return { error: 'Esa es la que ya tenés puesta. Elegí una distinta.' }
  }

  return { hash: hashearCredencial(nueva) }
}

/** Nada de esto se ve hasta que la pantalla se vuelve a dibujar del servidor. */
function refrescar(): void {
  revalidatePath('/cuenta')
  // La lista de usuarios muestra el correo de cada cuenta y avisa cuál sigue con
  // la contraseña con la que la crearon.
  revalidatePath('/usuarios')
}

/**
 * Lo obligatorio: el correo institucional y una contraseña elegida por la
 * persona, guardados juntos.
 *
 * Los dos campos entran en el mismo update porque son un solo trámite. Si el
 * correo se guardara por su cuenta y la contraseña fallara, la pantalla volvería
 * a aparecer entera y diciendo lo mismo que antes, sin forma de saber qué quedó
 * guardado y qué no.
 *
 * Sólo existe mientras la cuenta no haya elegido contraseña todavía: es la única
 * acción que no pide la actual. Después de eso, cambiarla es cambiarClave().
 *
 * EL CORREO SOLO SE ESCRIBE SI NO HABÍA NINGUNO. Que falte la contraseña propia
 * no quiere decir que la cuenta esté recién creada: es también el estado en el
 * que queda cualquiera después de un reseteo desde /usuarios o desde db:clave, y
 * ésas ya tienen el correo cargado. Si esta acción lo pisara, una sesión robada
 * sobre una cuenta recién reseteada le cambiaría de un saque el correo y la
 * contraseña, y su dueño se quedaría sin con qué entrar y sin saber con qué se
 * entra ahora. Mudarle la puerta a una cuenta pide la contraseña actual, y eso
 * es guardarCorreo; acá lo único que falta es la contraseña.
 */
export async function completarCuenta(
  _previo: EstadoCuenta,
  datos: FormData,
): Promise<EstadoCuenta> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) return { error: 'Se cerró la sesión. Entrá de nuevo.' }

  let resultado: EstadoCuenta
  try {
    resultado = await conSesion(sesion, async (tx) => {
      const p = await perfilConMarca(tx, sesion)
      if (!p) return { error: 'No se pudo leer tu cuenta. Actualizá la pantalla.' }
      if (p.credencial_cambiada_en) {
        return { error: 'Tu cuenta ya tiene una contraseña elegida. Actualizá la pantalla.' }
      }

      // Null cuando ya había uno: la consulta de abajo entonces no lo nombra.
      let correoNuevo: string | null = null
      if (!p.correo) {
        const correo = normalizarCorreo(String(datos.get('correo') ?? ''))
        if (!esCorreoValido(correo)) {
          return { error: 'Ese correo no tiene forma de correo. Es con lo que vas a entrar al panel.' }
        }
        correoNuevo = correo
      }

      const revisada = revisarClaveNueva(p, datos)
      if ('error' in revisada) return { error: revisada.error }

      /*
       * El `credencial_cambiada_en is null` del where es el mismo control de
       * arriba, pero contra dos pestañas abiertas: la fila queda bloqueada, la
       * segunda lee lo que escribió la primera y no pisa nada.
       *
       * El contador de intentos fallidos vuelve a cero porque quien acaba de
       * elegir contraseña no tiene por qué arrastrar los errores de la anterior.
       */
      const filas = await tx.consultar<{ correo: string | null }>(
        `update perfiles
            set credencial_hash = $2,
                credencial_cambiada_en = now(),
                intentos_fallidos = 0,
                bloqueado_hasta = null
                ${correoNuevo === null ? '' : ', correo = $3'}
          where id = $1 and rol = 'admin' and credencial_cambiada_en is null
        returning correo`,
        correoNuevo === null
          ? [sesion.perfilId, revisada.hash]
          : [sesion.perfilId, revisada.hash, correoNuevo],
      )
      if (!filas.length) {
        return { error: 'No se pudo guardar. Actualizá la pantalla y fijate cómo quedó.' }
      }

      const conQueEntra = filas[0].correo ?? correoNuevo ?? p.correo
      return { aviso: `Listo. De ahora en más entrás con ${conQueEntra} y la contraseña que elegiste.` }
    })
  } catch (e) {
    return { error: traducir(e) }
  }

  if (resultado.aviso) refrescar()
  return resultado
}

/**
 * El correo solo, sin tocar la contraseña.
 *
 * Es la acción de la tarjeta de la cuenta ya completa —cambiar un correo mal
 * escrito no puede depender de que haya otra cuenta de coordinación a mano: una
 * letra de más es el identificador con el que hay que entrar mañana—, y también
 * la única que hay durante el rato que va entre que sube el código y se aplica
 * la migración, cuando `credencial_cambiada_en` todavía no existe.
 *
 * Cambiar un correo ya cargado pide la contraseña; cargarlo la primera vez, no.
 * Cambiarlo es mudarle la puerta a la cuenta. Pero la primera carga es lo que el
 * portón exige para dejar salir de /cuenta, y ponerle una traba ahí es ponérsela
 * al único camino que hay para afuera.
 */
export async function guardarCorreo(
  _previo: EstadoCuenta,
  datos: FormData,
): Promise<EstadoCuenta> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) return { error: 'Se cerró la sesión. Entrá de nuevo.' }

  const correo = normalizarCorreo(String(datos.get('correo') ?? ''))
  if (!esCorreoValido(correo)) {
    return { error: 'Ese correo no tiene forma de correo. Es con lo que entrás al panel.' }
  }

  let resultado: EstadoCuenta
  try {
    resultado = await conSesion(sesion, async (tx) => {
      const p = await perfilPropio(tx, sesion)
      if (!p) return { error: 'No se pudo leer tu cuenta. Actualizá la pantalla.' }

      if (p.correo) {
        const problema = confirmarQueSosVos(p, datos)
        if (problema) return { error: problema }

        if (normalizarCorreo(p.correo) === correo) {
          return { aviso: `Ya entrabas con ${correo}: quedó igual.` }
        }
      }

      const filas = await tx.consultar<{ correo: string }>(
        `update perfiles set correo = $2 where id = $1 and rol = 'admin' returning correo`,
        [sesion.perfilId, correo],
      )
      if (!filas.length) return { error: 'No se pudo guardar el correo. Actualizá la pantalla.' }

      return { aviso: `Listo: de ahora en más entrás con ${correo}.` }
    })
  } catch (e) {
    return { error: traducir(e) }
  }

  if (resultado.aviso) refrescar()
  return resultado
}

/** La contraseña de todos los días, cambiada por quien la usa. */
export async function cambiarClave(
  _previo: EstadoCuenta,
  datos: FormData,
): Promise<EstadoCuenta> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) return { error: 'Se cerró la sesión. Entrá de nuevo.' }

  let resultado: EstadoCuenta
  try {
    resultado = await conSesion(sesion, async (tx) => {
      const p = await perfilPropio(tx, sesion)
      if (!p) return { error: 'No se pudo leer tu cuenta. Actualizá la pantalla.' }

      const problema = confirmarQueSosVos(p, datos)
      if (problema) return { error: problema }

      const revisada = revisarClaveNueva(p, datos)
      if ('error' in revisada) return { error: revisada.error }

      const filas = await tx.consultar<{ id: string }>(
        `update perfiles
            set credencial_hash = $2,
                credencial_cambiada_en = now(),
                intentos_fallidos = 0,
                bloqueado_hasta = null
          where id = $1 and rol = 'admin'
        returning id`,
        [sesion.perfilId, revisada.hash],
      )
      if (!filas.length) {
        return { error: 'No se pudo cambiar la contraseña. Actualizá la pantalla.' }
      }

      // La sesión no se corta: el token ya firmado no sabe nada de la
      // contraseña. Decirlo acá es más honesto que dejar que se note la próxima
      // vez que alguien busque el celular para volver a entrar.
      return { aviso: 'Contraseña cambiada. La sesión que tenés abierta sigue valiendo; la próxima vez que entres va la nueva.' }
    })
  } catch (e) {
    return { error: traducir(e) }
  }

  if (resultado.aviso) refrescar()
  return resultado
}
