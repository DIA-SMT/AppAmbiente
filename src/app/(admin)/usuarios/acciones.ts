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
 * escribir movimientos de su propio sitio. La de coordinación lleva una
 * contraseña escrita de seis caracteres para arriba, que la elige una persona y
 * el sistema nunca inventa: ve los teléfonos de los vecinos y la auditoría
 * entera.
 *
 * Eliminar un usuario es lo único que este sistema borra de verdad, y solo
 * cuando no hay nada que perder. Quién puede y cuándo lo decide
 * app.eliminar_perfil, del lado de la base.
 */

import { randomInt } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { esClaveValida, esPinValido, hashearCredencial } from '@db/credenciales'
import { consultarConSesion } from '@db/sesion'
import { mensajeDeError } from '@/lib/datos'
import { exigirAdmin } from '@/lib/sesion'

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
  if (m.includes('perfil_sitio_coherente')) return 'Un usuario de punto tiene que tener un punto asignado.'
  if (m.includes('perfiles_sitio_id_fkey')) return 'Ese punto ya no existe. Actualizá la pantalla.'
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
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) return { error: 'Se cerró la sesión. Entrá de nuevo.' }

  const usuario = String(datos.get('usuario') ?? '').trim().toLowerCase()
  const nombre = String(datos.get('nombre') ?? '').trim()
  const rol = String(datos.get('rol') ?? 'vigilador') === 'admin' ? 'admin' : 'vigilador'
  const sitioId = String(datos.get('sitio_id') ?? '').trim()
  const pinPedido = String(datos.get('pin') ?? '').trim()
  const clavePedida = String(datos.get('clave') ?? '')

  if (!FORMATO_USUARIO.test(usuario)) {
    return { error: 'El usuario va en minúsculas, sin espacios ni acentos, de 3 a 32 caracteres. Por ejemplo: pv09.' }
  }
  if (nombre.length < 3) return { error: 'Escribí con qué nombre se va a ver este usuario en los listados.' }

  if (rol === 'admin') {
    // Una cuenta de coordinación no tiene sitio: ve los tres flujos.
    if (!esClaveValida(clavePedida)) {
      return { error: 'La contraseña de una cuenta de coordinación va de 6 caracteres para arriba. Elegila vos: el sistema no la inventa.' }
    }
  } else {
    if (!sitioId) return { error: 'Elegí a qué punto pertenece.' }
    if (pinPedido && !esPinValido(pinPedido)) {
      return { error: 'El PIN son entre 4 y 8 dígitos, sin letras.' }
    }
  }

  const credencial = rol === 'admin' ? clavePedida.trim() : pinPedido || pinAlAzar()

  try {
    // La sesión del punto no vence a propósito: el vigilador no puede quedarse
    // afuera en la calle. La de coordinación sí, porque ve datos personales.
    const filas = await consultarConSesion<{ id: string }>(
      sesion,
      `insert into perfiles (usuario, nombre, rol, sitio_id, credencial_hash, sesion_horas)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [
        usuario,
        nombre,
        rol,
        rol === 'admin' ? null : sitioId,
        hashearCredencial(credencial),
        rol === 'admin' ? 12 : null,
      ],
    )
    if (!filas.length) return { error: 'No se pudo crear el usuario.' }
  } catch (e) {
    return { error: traducir(e) }
  }

  revalidatePath('/usuarios')

  // La contraseña de coordinación la escribió quien la va a usar: no hace falta
  // devolvérsela, y mostrarla sería dejarla en pantalla sin motivo.
  if (rol === 'admin') {
    return { aviso: `Cuenta de coordinación ${usuario} creada. Entra con la contraseña que escribiste.` }
  }
  return { pin: credencial, usuario, aviso: `Usuario ${usuario} creado.` }
}

export async function accionSobreUsuario(
  _previo: EstadoUsuario,
  datos: FormData,
): Promise<EstadoUsuario> {
  const sesion = await exigirAdmin().catch(() => null)
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

    // Cambiar la contraseña de una cuenta de coordinación, incluida la propia.
    // Va escrita: el sistema no inventa contraseñas largas porque nadie las
    // anota bien, y una cuenta de coordinación no se puede resetear a ciegas.
    if (accion === 'clave') {
      const clave = String(datos.get('clave') ?? '')
      if (!esClaveValida(clave)) {
        return { error: 'La contraseña va de 6 caracteres para arriba.' }
      }
      const filas = await consultarConSesion<{ usuario: string }>(
        sesion,
        `update perfiles
            set credencial_hash = $2, intentos_fallidos = 0, bloqueado_hasta = null
          where id = $1 and rol = 'admin'
          returning usuario`,
        [id, hashearCredencial(clave.trim())],
      )
      if (!filas.length) {
        return { error: 'Ese usuario no existe, o es de punto: ahí va "Resetear PIN".' }
      }
      revalidatePath('/usuarios')
      return {
        aviso: id === sesion.perfilId
          ? 'Tu contraseña quedó cambiada. La sesión abierta sigue valiendo hasta que venza.'
          : `Contraseña de ${filas[0].usuario} cambiada.`,
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
      const filas = await consultarConSesion<{ usuario: string }>(
        sesion,
        `update perfiles set intentos_fallidos = 0, bloqueado_hasta = null
          where id = $1 returning usuario`,
        [id],
      )
      if (!filas.length) return { error: 'Ese usuario no existe.' }
      revalidatePath('/usuarios')
      return { aviso: `${filas[0].usuario} puede volver a probar el PIN.` }
    }

    return { error: 'Esa acción no existe.' }
  } catch (e) {
    return { error: traducir(e) }
  }
}
