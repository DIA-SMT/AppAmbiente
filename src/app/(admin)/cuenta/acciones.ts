'use server'

/**
 * Mi cuenta: el correo con el que se entra al panel, y el segundo factor.
 *
 * Todo lo de acá es sobre la cuenta de quien está mirando la pantalla. El id
 * sale de la sesión y nunca de un campo del formulario, así que desde esta
 * pantalla no se le puede tocar el segundo factor a nadie más.
 *
 * Es la pantalla donde alguien se puede quedar afuera para siempre, y de eso
 * salen las dos decisiones que la ordenan:
 *
 *  · el secreto no queda confirmado hasta que la persona escribió un código
 *    salido de su teléfono. Darlo por bueno antes deja afuera al que abrió la
 *    pantalla, no llegó a escanear y cerró;
 *
 *  · los ocho códigos de respaldo nacen en el mismo momento en que el segundo
 *    factor empieza a exigirse, no en un paso posterior que se puede saltear.
 *    Con una sola cuenta de coordinación, un segundo factor sin salida de
 *    emergencia es la base inaccesible para siempre.
 */

import { revalidatePath } from 'next/cache'
import { verificarCredencial } from '@db/credenciales'
import { consultarConSesion } from '@db/sesion'
import { descifrarSecreto, generarCodigosDeRespaldo, verificarCodigo } from '@db/totp'
import { hashearCodigosDeRespaldo } from '@/lib/acceso'
import { mensajeDeError } from '@/lib/datos'
import { exigirAdmin, type Sesion } from '@/lib/sesion'

export interface EstadoCuenta {
  error?: string
  aviso?: string
  /** Los ocho en claro, por única vez. Después de esta respuesta no existen más. */
  codigos?: string[]
}

/**
 * Los dominios con los que se entra al panel.
 *
 * La misma lista que usa el alta de src/app/(admin)/usuarios/acciones.ts, y vive
 * en el código y no en un check de la base a propósito: el día que la Secretaría
 * aparezca con una casilla de otro dominio, agregarlo son dos líneas y un
 * despliegue, y no una migración sobre una base en uso.
 */
const DOMINIOS_INSTITUCIONALES = ['smt.gob.ar']

function normalizarCorreo(bruto: string): string {
  return bruto.trim().toLowerCase()
}

function esCorreoInstitucional(correo: string): boolean {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return false
  return DOMINIOS_INSTITUCIONALES.some((d) => correo.endsWith(`@${d}`))
}

function traducir(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('perfiles_correo_idx')) {
    return 'Ese correo ya lo usa otra cuenta. Cada persona entra con el suyo.'
  }
  // El despliegue son dos pasos sueltos —el SQL a la base y el build a Vercel— y
  // nada garantiza el orden. Si el build llegó primero, decir qué falta ahorra
  // el rato de mirar un error de Postgres que no le habla a nadie.
  if (/column .*(correo|totp_|codigos_respaldo).* does not exist/i.test(m)) {
    return 'La base todavía no tiene la actualización del segundo factor. Avisale a la Dirección de IA; mientras tanto entrás igual, como hasta ahora.'
  }
  return mensajeDeError(e)
}

interface FilaPropia {
  correo: string | null
  totp_secreto: string | null
  totp_confirmado_en: string | null
}

/**
 * Volver a probar quién sos antes de apagar el segundo factor o cambiar el
 * correo con el que se entra.
 *
 * Tener la sesión abierta no alcanza para estas tres cosas. Una sesión de
 * coordinación dura doce horas: una notebook abierta en la oficina, o una
 * cookie robada, alcanzaban para apagar el segundo factor de esa cuenta —y
 * desde ahí la contraseña vuelve a ser lo único que la protege— o para
 * reemplazar los ocho códigos de respaldo sin que la persona se entere de que
 * los suyos, los del papel, dejaron de servir.
 *
 * Se pide la CONTRASEÑA y no el código del teléfono a propósito. Estos tres
 * botones se usan justamente el día que el código no se puede generar: se
 * perdió el teléfono, o el secreto guardado quedó ilegible porque rotaron
 * AUTH_SECRET. Pedir lo que en ese momento no existe convierte la única salida
 * en otra puerta cerrada.
 *
 * Tampoco suma al contador de intentos fallidos del ingreso, y eso también es a
 * propósito: si sumara, alguien que consiguió una cookie podría trabarle la
 * cuenta a la coordinación escribiendo cualquier cosa acá cinco veces, que es
 * exactamente lo que este sistema no se puede permitir.
 */
async function confirmarQueSosVos(sesion: Sesion, datos: FormData): Promise<string | null> {
  const credencial = String(datos.get('credencial') ?? '')
  if (!credencial) {
    return 'Escribí tu contraseña para confirmar que sos vos.'
  }

  const filas = await consultarConSesion<{ credencial_hash: string }>(
    sesion,
    `select credencial_hash from perfiles where id = $1`,
    [sesion.perfilId],
  )
  const hash = filas[0]?.credencial_hash
  if (!hash || !verificarCredencial(credencial, hash)) {
    return 'Esa no es tu contraseña. Es la misma con la que entrás al panel.'
  }
  return null
}

/** El perfil de quien está mirando la pantalla. Nunca el de otro. */
async function perfilPropio(sesion: Sesion): Promise<FilaPropia | null> {
  const filas = await consultarConSesion<FilaPropia>(
    sesion,
    `select correo, totp_secreto, totp_confirmado_en from perfiles where id = $1`,
    [sesion.perfilId],
  )
  return filas[0] ?? null
}

/**
 * El correo institucional, que es con lo que se entra de ahora en más.
 *
 * Se puede volver a cambiar después de cargado, y no es un detalle: una letra
 * de más al escribirlo es el identificador con el que hay que entrar mañana, y
 * corregirlo no puede depender de que haya otra cuenta de coordinación a mano.
 */
export async function guardarCorreo(
  _previo: EstadoCuenta,
  datos: FormData,
): Promise<EstadoCuenta> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) return { error: 'Se cerró la sesión. Entrá de nuevo.' }

  const correo = normalizarCorreo(String(datos.get('correo') ?? ''))
  if (!esCorreoInstitucional(correo)) {
    return {
      error: `El correo tiene que ser el institucional, terminado en @${DOMINIOS_INSTITUCIONALES[0]}. `
        + 'Es con lo que vas a entrar al panel.',
    }
  }

  try {
    /*
     * Cambiar un correo ya cargado pide la contraseña; cargarlo la primera vez,
     * no. El correo es el identificador con el que se entra: cambiarlo es
     * mudarle la puerta a la cuenta. Pero la primera carga es el paso uno del
     * portón, con la cuenta todavía a medio hacer y sin segundo factor, y
     * ponerle una traba ahí es ponérsela al único camino que hay para salir de
     * /cuenta el día de la presentación.
     */
    const actual = await perfilPropio(sesion)
    if (actual?.correo) {
      const problema = await confirmarQueSosVos(sesion, datos)
      if (problema) return { error: problema }
    }

    const filas = await consultarConSesion<{ correo: string }>(
      sesion,
      `update perfiles set correo = $2 where id = $1 and rol = 'admin' returning correo`,
      [sesion.perfilId, correo],
    )
    if (!filas.length) return { error: 'No se pudo guardar el correo. Actualizá la pantalla.' }
  } catch (e) {
    return { error: traducir(e) }
  }

  revalidatePath('/cuenta')
  revalidatePath('/usuarios')
  return { aviso: `Listo: de ahora en más entrás con ${correo}.` }
}

/**
 * Las tres cosas que se le pueden hacer al segundo factor desde acá.
 *
 * Van juntas en una sola acción porque las tres terminan en el mismo lugar de la
 * pantalla —y confirmar y regenerar devuelven códigos de respaldo, que se
 * muestran una sola vez—: con una respuesta sola, esos códigos no dependen de
 * cuál de los formularios los trajo.
 */
export async function accionDeSegundoFactor(
  _previo: EstadoCuenta,
  datos: FormData,
): Promise<EstadoCuenta> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) return { error: 'Se cerró la sesión. Entrá de nuevo.' }

  const accion = String(datos.get('accion') ?? '')
  const resultado = await resolver(sesion, accion, datos)

  /*
   * Los códigos que ya están en pantalla no se van por lo que conteste la
   * acción siguiente.
   *
   * Sin esto, tocar «Confirmar y activar» dos veces —la primera anduvo y la
   * segunda contesta «ya estaba configurado»— reemplaza la respuesta entera y
   * los ocho códigos desaparecen de la pantalla. En la base están hasheados: no
   * hay forma de volver a mostrarlos, y el que perdió el teléfono se queda
   * afuera. Un doble clic no puede costar eso.
   *
   * La excepción es reconfigurar, que los borra de verdad: ahí seguir
   * mostrándolos sería ofrecer una salida de emergencia que ya no existe.
   */
  if (!resultado.codigos && accion !== 'reconfigurar' && _previo.codigos) {
    return { ...resultado, codigos: _previo.codigos }
  }
  return resultado
}

async function resolver(sesion: Sesion, accion: string, datos: FormData): Promise<EstadoCuenta> {
  try {
    const p = await perfilPropio(sesion)
    if (!p) return { error: 'No se pudo leer tu cuenta. Actualizá la pantalla.' }

    if (accion === 'confirmar') return await confirmar(sesion, p, datos)
    if (accion === 'regenerar') return await regenerar(sesion, p, datos)
    if (accion === 'reconfigurar') return await reconfigurar(sesion, p, datos)
    return { error: 'Esa acción no existe.' }
  } catch (e) {
    return { error: traducir(e) }
  }
}

/**
 * El código de seis dígitos que confirma que el teléfono quedó bien cargado.
 *
 * Acá no se suma intento fallido ni se traba nada: quien está escribiendo ya
 * entró con su contraseña y está configurando su propia cuenta. El contador de
 * intentos es del ingreso, donde del otro lado puede haber cualquiera.
 */
async function confirmar(
  sesion: Sesion,
  p: FilaPropia,
  datos: FormData,
): Promise<EstadoCuenta> {
  const codigo = String(datos.get('codigo') ?? '').replace(/\D/g, '')
  if (codigo.length !== 6) {
    return { error: 'El código son los seis dígitos que muestra la aplicación del celular.' }
  }
  if (p.totp_confirmado_en) {
    return { error: 'Tu segundo factor ya estaba configurado. Actualizá la pantalla.' }
  }
  if (!p.totp_secreto) {
    return { error: 'Todavía no hay ningún código para escanear. Actualizá la pantalla.' }
  }

  let secreto: string
  try {
    secreto = descifrarSecreto(p.totp_secreto)
  } catch {
    // Pasa si cambió AUTH_SECRET entre que se dibujó el QR y ahora. Lo que hay
    // guardado no sirve más: se borra y la pantalla arranca de cero con uno
    // nuevo, que es lo único que puede terminar bien.
    await consultarConSesion(
      sesion,
      `update perfiles set totp_secreto = null where id = $1 and totp_confirmado_en is null`,
      [sesion.perfilId],
    )
    revalidatePath('/cuenta')
    return { error: 'El código que estabas por confirmar ya no sirve. Escaneá el nuevo que aparece en pantalla.' }
  }

  const paso = verificarCodigo(secreto, codigo)
  if (paso === null) {
    return {
      error: 'Ese código no coincide. Fijate que sea el de «Residuos SMT» y escribilo antes de que cambie; '
        + 'si sigue sin andar, revisá que la hora del celular esté en automático.',
    }
  }

  const codigos = generarCodigosDeRespaldo()

  // El paso queda guardado junto con la confirmación: el código que se acaba de
  // usar para configurar no sirve además para el primer ingreso.
  const filas = await consultarConSesion<{ id: string }>(
    sesion,
    `update perfiles
        set totp_confirmado_en = now(), totp_ultimo_paso = $2::bigint, codigos_respaldo = $3::text[]
      where id = $1 and rol = 'admin' and totp_confirmado_en is null
    returning id`,
    [sesion.perfilId, paso, hashearCodigosDeRespaldo(codigos)],
  )
  if (!filas.length) {
    return { error: 'Tu segundo factor ya estaba configurado. Actualizá la pantalla.' }
  }

  revalidatePath('/cuenta')
  revalidatePath('/usuarios')
  return {
    codigos,
    aviso: 'Segundo factor activado. Desde el próximo ingreso el sistema te va a pedir el código.',
  }
}

/** Ocho nuevos. Los de antes dejan de servir en el mismo momento. */
async function regenerar(sesion: Sesion, p: FilaPropia, datos: FormData): Promise<EstadoCuenta> {
  if (!p.totp_confirmado_en) {
    return { error: 'Todavía no hay segundo factor configurado, así que no hay códigos que renovar.' }
  }

  // Es la más silenciosa de las tres: le deja ocho códigos buenos a quien esté
  // adentro y quema los que la persona tiene anotados en un papel, sin que
  // nadie se entere hasta el día que hace falta usarlos.
  const problema = await confirmarQueSosVos(sesion, datos)
  if (problema) return { error: problema }

  const codigos = generarCodigosDeRespaldo()
  await consultarConSesion(
    sesion,
    `update perfiles set codigos_respaldo = $2::text[] where id = $1 and rol = 'admin'`,
    [sesion.perfilId, hashearCodigosDeRespaldo(codigos)],
  )

  revalidatePath('/cuenta')
  return { codigos, aviso: 'Códigos nuevos. Los ocho de antes ya no sirven.' }
}

/**
 * Cambié de teléfono: se borra lo configurado y se vuelve a empezar.
 *
 * Deja la cuenta como recién creada y el portón del panel trae de vuelta acá
 * hasta que se confirme el código nuevo. En el medio se entra sólo con la
 * contraseña, igual que antes de todo esto: nadie queda afuera por abandonar
 * la pantalla a mitad de camino.
 *
 * Se van también los códigos de respaldo. Son la salida de emergencia de un
 * teléfono que ya no está; dejarlos sería creer que siguen sirviendo para algo.
 */
async function reconfigurar(sesion: Sesion, p: FilaPropia, datos: FormData): Promise<EstadoCuenta> {
  if (!p.totp_confirmado_en) {
    return { error: 'No hay nada configurado todavía: escaneá el código que está en pantalla.' }
  }

  // Lo que hace este botón es apagar el segundo factor: mientras no se confirme
  // el teléfono nuevo, la cuenta entra con la contraseña sola. Por eso pide la
  // contraseña: si no, una sesión ajena lo apaga en un POST y listo.
  const problema = await confirmarQueSosVos(sesion, datos)
  if (problema) return { error: problema }

  await consultarConSesion(
    sesion,
    `update perfiles
        set totp_secreto = null, totp_confirmado_en = null, totp_ultimo_paso = null,
            codigos_respaldo = '{}'
      where id = $1 and rol = 'admin'`,
    [sesion.perfilId],
  )

  revalidatePath('/cuenta')
  revalidatePath('/usuarios')
  return {
    aviso: 'Listo. Escaneá el código nuevo con el teléfono que vas a usar de ahora en más y confirmalo acá.',
  }
}
