'use server'

/**
 * Alta y mantenimiento de los usuarios.
 *
 * El PIN se muestra una sola vez, acá, en la respuesta de la acción: nunca se
 * guarda en claro ni vuelve a salir por pantalla. Si se pierde, se resetea.
 *
 * Las dos clases de cuenta no se tratan igual. La de punto lleva un PIN de
 * cuatro dígitos que el sistema puede inventar: se teclea en la calle, y lo que
 * la protege no es el largo sino el bloqueo por intentos y que solo pueda
 * escribir movimientos de su propio sitio. La de coordinación lleva un correo
 * institucional con el que entra y una contraseña escrita de seis caracteres
 * para arriba: ve los teléfonos de los vecinos y la auditoría entera.
 *
 * LA CONTRASEÑA QUE SE ESCRIBE ACÁ ES PRESTADA. La cuenta nace con
 * credencial_cambiada_en en null, y eso es lo que hace que el panel, la primera
 * vez que entre, no la deje ir a ninguna pantalla hasta que elija una propia.
 * Por eso quien crea la cuenta puede escribir la primera sin culpa: le sirve
 * para pasarla por teléfono y deja de valer apenas la usan. Lo mismo con
 * «Cambiar contraseña» sobre una cuenta ajena, que es la salida para el que se
 * olvidó la suya.
 *
 * Eliminar un usuario es lo único que este sistema borra de verdad, y solo
 * cuando no hay nada que perder. Quién puede y cuándo lo decide
 * app.eliminar_perfil, del lado de la base.
 */

import { randomInt } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { esClaveValida, esPinValido, hashearCredencial, verificarCredencial } from '@db/credenciales'
import { conSesion, consultarConSesion, type Sesion } from '@db/sesion'
import { mensajeDeError } from '@/lib/datos'
import { esCorreoValido, normalizarCorreo } from '@/lib/correo'
import { exigirAdminCompleto } from '@/lib/sesion'

export interface EstadoUsuario {
  error?: string
  aviso?: string
  /** Solo viaja en la respuesta del alta o del reseteo. */
  pin?: string
  usuario?: string
}

const FORMATO_USUARIO = /^[a-z0-9][a-z0-9._-]{2,31}$/

function pinAlAzar(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0')
}

function traducir(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('perfiles_usuario_idx')) return 'Ya hay un usuario con ese nombre. Probá con otro.'
  if (m.includes('perfiles_correo_idx')) return 'Ese correo ya lo usa otra cuenta. Cada persona entra con el suyo.'
  if (m.includes('perfil_sitio_coherente')) return 'Un usuario de punto tiene que tener un punto asignado.'
  // El nombre del check quedó más largo en la 0023 y más corto en la 0024; el
  // prefijo es el mismo en las dos, así que este `includes` los agarra a los dos
  // y no depende de cuál de las dos migraciones tenga aplicada la base.
  if (m.includes('perfil_vigilador_sin_correo')) {
    return 'El usuario de un punto no lleva correo: la cuenta es del punto y la comparten los que estén de turno.'
  }
  if (m.includes('perfiles_sitio_id_fkey')) return 'Ese punto ya no existe. Actualizá la pantalla.'
  // El despliegue son dos pasos sueltos —el SQL a la base y el build a Vercel—
  // y nada garantiza el orden. Si el build llegó primero, el alta falla acá, y
  // conviene decir qué falta: el mensaje de Postgres no le sirve a nadie.
  if (/column .*correo.* does not exist/i.test(m)) {
    return 'La base todavía no tiene el correo institucional: falta aplicar la actualización pendiente. El usuario no se creó.'
  }
  return mensajeDeError(e)
}

/**
 * Lo que aborta app.eliminar_perfil ya viene escrito para la pantalla —«No se
 * puede eliminar: cargó 513 movimientos»— y es lo único que explica por qué ese
 * usuario sigue en la lista: traducirlo lo cambiaría por un "probá de nuevo"
 * que no le sirve a nadie. Lo que no salió de la función —un permiso, la
 * migración sin aplicar— sí pasa por traducir(): eso es un problema del sistema
 * y no una respuesta para quien está mirando la lista.
 */
function motivoDeLaBase(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e)).trim()
  const tecnico = /permission denied|does not exist|invalid input|violates|relation |function app\./i.test(m)
  return m && !tecnico ? m : traducir(e)
}

export async function crearUsuario(
  _previo: EstadoUsuario,
  datos: FormData,
): Promise<EstadoUsuario> {
  const sesion = await exigirAdminCompleto().catch(() => null)
  if (!sesion) return { error: 'Se cerró la sesión. Entrá de nuevo.' }

  const usuario = String(datos.get('usuario') ?? '').trim().toLowerCase()
  const nombre = String(datos.get('nombre') ?? '').trim()
  const rol = String(datos.get('rol') ?? 'vigilador') === 'admin' ? 'admin' : 'vigilador'
  const sitioId = String(datos.get('sitio_id') ?? '').trim()
  const pinPedido = String(datos.get('pin') ?? '').trim()
  const clavePedida = String(datos.get('clave') ?? '')
  const correo = normalizarCorreo(String(datos.get('correo') ?? ''))

  if (!FORMATO_USUARIO.test(usuario)) {
    return { error: 'El usuario va en minúsculas, sin espacios ni acentos, de 3 a 32 caracteres. Por ejemplo: pv09.' }
  }
  if (nombre.length < 3) return { error: 'Escribí con qué nombre se va a ver este usuario en los listados.' }

  if (rol === 'admin') {
    // Una cuenta de coordinación no tiene sitio: ve los tres flujos.
    if (!esCorreoValido(correo)) {
      return { error: 'Ese correo no tiene forma de correo. Es con lo que va a entrar al panel.' }
    }
    if (!esClaveValida(clavePedida)) {
      return { error: 'La contraseña de una cuenta de coordinación va de 6 caracteres para arriba. Es sólo para que entre la primera vez.' }
    }
  } else {
    if (!sitioId) return { error: 'Elegí a qué punto pertenece.' }
    if (pinPedido && !esPinValido(pinPedido)) {
      return { error: 'El PIN son entre 4 y 8 dígitos, sin letras.' }
    }
  }

  const credencial = rol === 'admin' ? clavePedida.trim() : pinPedido || pinAlAzar()

  try {
    // credencial_cambiada_en no se nombra, y queda en null: es lo que le pide
    // una contraseña propia la primera vez que entre. No nombrarla también es
    // lo que deja que el alta funcione contra una base sin la 0024 todavía
    // aplicada, que es el orden en el que se despliega este cambio.
    //
    // La sesión del punto no vence a propósito: el vigilador no puede quedarse
    // afuera en la calle. La de coordinación sí, porque ve datos personales.
    const filas = await consultarConSesion<{ id: string }>(
      sesion,
      `insert into perfiles (usuario, nombre, rol, sitio_id, credencial_hash, sesion_horas, correo)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        usuario,
        nombre,
        rol,
        rol === 'admin' ? null : sitioId,
        hashearCredencial(credencial),
        rol === 'admin' ? 12 : null,
        // El usuario de un punto no tiene correo: la cuenta es del punto y la
        // comparten los que estén de turno. El check de la base lo exige así.
        rol === 'admin' ? correo : null,
      ],
    )
    if (!filas.length) return { error: 'No se pudo crear el usuario.' }
  } catch (e) {
    return { error: traducir(e) }
  }

  revalidatePath('/usuarios')

  // La contraseña de coordinación no se devuelve: la escribió quien está
  // mirando la pantalla y dura hasta que la persona entre y elija la suya.
  if (rol === 'admin') {
    return {
      aviso: `Cuenta de coordinación ${usuario} creada. Entra con ${correo} y la contraseña que escribiste, `
        + 'y lo primero que le pide el panel es elegir una propia: de ahí en más vos no la sabés.',
    }
  }
  return { pin: credencial, usuario, aviso: `Usuario ${usuario} creado.` }
}

/**
 * Cambiar la contraseña de una cuenta de coordinación, incluida la propia.
 *
 * Va escrita: el sistema no inventa contraseñas largas porque nadie las anota
 * bien, y una cuenta de coordinación no se puede resetear a ciegas.
 *
 * LO QUE DECIDE TODO ES DE QUIÉN ES LA CUENTA. Sobre la propia queda elegida, y
 * credencial_cambiada_en se completa. Sobre una ajena la escribió otro —quien
 * está mirando esta lista—, así que vuelve a null y el panel le va a pedir una
 * propia a su dueño la próxima vez que entre. Es la diferencia entre una
 * contraseña que eligió su dueño y una que alguien le pasó por teléfono.
 *
 * SOBRE LA PROPIA SE PIDE LA ACTUAL, igual que en /cuenta. Esa exigencia está
 * ahí porque la pantalla se abre sola en cualquier sesión viva —una notebook
 * abierta en la oficina, una cookie robada—, y esta lista se abre desde la misma
 * sesión y con la misma facilidad: sin pedirla acá, la de allá no frena nada,
 * porque al lado quedaba una segunda puerta que hacía lo mismo sin preguntar.
 * Con una sola cuenta de coordinación, eso es el dueño legítimo afuera.
 *
 * Sobre una cuenta ajena no corresponde pedir nada: quien la cambia no es el
 * dueño, no la sabe, y ya está autenticado como coordinación. Ésa es justamente
 * la salida para el que se olvidó la suya.
 *
 * La columna se pregunta antes de nombrarla, y acá no es una precaución de más:
 * la 0024 se aplica DESPUÉS de subir el build, así que hay un rato garantizado
 * en el que no existe. Mientras tanto la contraseña se cambia igual y lo único
 * que no pasa es la marca; el portón no la puede exigir todavía de todos modos.
 */
async function cambiarClave(
  sesion: Sesion,
  id: string,
  clave: string,
  credencialActual: string,
): Promise<{ usuario: string } | { error: string } | null> {
  const propia = id === sesion.perfilId

  return conSesion(sesion, async (tx) => {
    const [{ hay_credencial: hayCredencial }] = await tx.consultar<{ hay_credencial: boolean }>(
      `select exists (select 1 from pg_attribute
                       where attrelid = 'public.perfiles'::regclass
                         and attname = 'credencial_cambiada_en'
                         and not attisdropped) as hay_credencial`,
    )

    /*
     * El hash se lee adentro de la misma transacción que escribe, y por eso se
     * lee acá y no antes: lo que se compara tiene que ser lo que hay en la fila
     * que se está por pisar.
     *
     * No suma al contador de intentos fallidos, igual que en /cuenta: si sumara,
     * alguien con una cookie podría trabarle la cuenta a la coordinación
     * escribiendo cualquier cosa cinco veces.
     */
    if (propia) {
      const [fila] = await tx.consultar<{ credencial_hash: string }>(
        `select credencial_hash from perfiles where id = $1`,
        [id],
      )
      if (!fila) return null
      if (!credencialActual) {
        return { error: 'Escribí tu contraseña actual para confirmar que sos vos.' }
      }
      if (!verificarCredencial(credencialActual, fila.credencial_hash)) {
        return { error: 'Esa no es tu contraseña actual. Es la misma con la que entrás al panel.' }
      }
    }

    const filas = await tx.consultar<{ usuario: string }>(
      `update perfiles
          set credencial_hash = $2, intentos_fallidos = 0, bloqueado_hasta = null
              ${hayCredencial ? `, credencial_cambiada_en = ${propia ? 'now()' : 'null'}` : ''}
        where id = $1 and rol = 'admin'
        returning usuario`,
      [id, hashearCredencial(clave.trim())],
    )
    return filas[0] ?? null
  })
}

export async function accionSobreUsuario(
  _previo: EstadoUsuario,
  datos: FormData,
): Promise<EstadoUsuario> {
  const sesion = await exigirAdminCompleto().catch(() => null)
  if (!sesion) return { error: 'Se cerró la sesión. Entrá de nuevo.' }

  const id = String(datos.get('id') ?? '').trim()
  const accion = String(datos.get('accion') ?? '')
  if (!id) return { error: 'Falta indicar el usuario.' }
  if (accion === 'desactivar' && id === sesion.perfilId) {
    return { error: 'No podés desactivar tu propio usuario.' }
  }
  if (accion === 'eliminar' && id === sesion.perfilId) {
    return { error: 'No podés eliminar tu propio usuario.' }
  }

  try {
    // Resetear el PIN de un punto: lo inventa el sistema y se muestra una vez.
    if (accion === 'reset') {
      const pin = pinAlAzar()
      const filas = await consultarConSesion<{ usuario: string }>(
        sesion,
        `update perfiles
            set credencial_hash = $2, intentos_fallidos = 0, bloqueado_hasta = null
          where id = $1 and rol = 'vigilador'
          returning usuario`,
        [id, hashearCredencial(pin)],
      )
      if (!filas.length) {
        return { error: 'Ese usuario no existe, o es de coordinación: ahí va "Cambiar contraseña".' }
      }
      revalidatePath('/usuarios')
      return { pin, usuario: filas[0].usuario }
    }

    if (accion === 'clave') {
      const clave = String(datos.get('clave') ?? '')
      if (!esClaveValida(clave)) {
        return { error: 'La contraseña va de 6 caracteres para arriba.' }
      }
      const fila = await cambiarClave(sesion, id, clave, String(datos.get('credencial') ?? ''))
      if (!fila) {
        return { error: 'Ese usuario no existe, o es de punto: ahí va "Resetear PIN".' }
      }
      if ('error' in fila) return { error: fila.error }
      revalidatePath('/usuarios')
      return {
        aviso: id === sesion.perfilId
          ? 'Tu contraseña quedó cambiada. La sesión abierta sigue valiendo hasta que venza.'
          : `Contraseña de ${fila.usuario} cambiada. Pasásela, y cuando entre el panel le pide `
            + 'que elija una propia: ahí dejás de saberla.',
      }
    }

    if (accion === 'activar' || accion === 'desactivar') {
      const filas = await consultarConSesion<{ usuario: string }>(
        sesion,
        `update perfiles set activo = $2 where id = $1 returning usuario`,
        [id, accion === 'activar'],
      )
      if (!filas.length) return { error: 'Ese usuario no existe.' }
      revalidatePath('/usuarios')
      return {
        aviso: accion === 'activar'
          ? `${filas[0].usuario} puede volver a entrar.`
          : `${filas[0].usuario} ya no puede entrar. Si tenía la sesión abierta, se le corta en el próximo pedido.`,
      }
    }

    // Borrar de verdad, que en el resto del sistema no se hace nunca. Sale bien
    // solo si el perfil no dejó rastro en ninguna tabla ni en la auditoría, y
    // eso lo comprueba app.eliminar_perfil: la condición vive en la base, donde
    // no depende de que la pantalla se haya acordado de mirarla.
    if (accion === 'eliminar') {
      try {
        const filas = await consultarConSesion<{ usuario: string }>(
          sesion,
          'select app.eliminar_perfil($1) as usuario',
          [id],
        )
        const usuario = filas[0]?.usuario
        if (!usuario) return { error: 'Ese usuario no existe.' }
        revalidatePath('/usuarios')
        return { aviso: `${usuario} quedó eliminado.` }
      } catch (e) {
        return { error: motivoDeLaBase(e) }
      }
    }

    if (accion === 'desbloquear') {
      // Vuelve también el rol: una cuenta de punto se traba probando el PIN y
      // una de coordinación probando la contraseña, y decirle «PIN» a quien
      // nunca tuvo uno es mandarlo a buscar algo que no existe.
      const filas = await consultarConSesion<{ usuario: string; rol: string }>(
        sesion,
        `update perfiles set intentos_fallidos = 0, bloqueado_hasta = null
          where id = $1 returning usuario, rol`,
        [id],
      )
      if (!filas.length) return { error: 'Ese usuario no existe.' }
      revalidatePath('/usuarios')
      const conQue = filas[0].rol === 'admin' ? 'su contraseña' : 'el PIN'
      return { aviso: `${filas[0].usuario} puede volver a probar ${conQue}.` }
    }

    return { error: 'Esa acción no existe.' }
  } catch (e) {
    return { error: traducir(e) }
  }
}
