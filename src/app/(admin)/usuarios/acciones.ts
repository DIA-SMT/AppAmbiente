'use server'

/**
 * Alta y mantenimiento de los usuarios de punto.
 *
 * El PIN se muestra una sola vez, acá, en la respuesta de la acción: nunca se
 * guarda en claro ni vuelve a salir por pantalla. Si se pierde, se resetea.
 */

import { randomInt } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { esPinValido, hashearCredencial } from '@db/credenciales'
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

export async function crearUsuario(
  _previo: EstadoUsuario,
  datos: FormData,
): Promise<EstadoUsuario> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) return { error: 'Se cerró la sesión. Entrá de nuevo.' }

  const usuario = String(datos.get('usuario') ?? '').trim().toLowerCase()
  const nombre = String(datos.get('nombre') ?? '').trim()
  const sitioId = String(datos.get('sitio_id') ?? '').trim()
  const pinPedido = String(datos.get('pin') ?? '').trim()

  if (!FORMATO_USUARIO.test(usuario)) {
    return { error: 'El usuario va en minúsculas, sin espacios ni acentos, de 3 a 32 caracteres. Por ejemplo: pv09.' }
  }
  if (nombre.length < 3) return { error: 'Escribí con qué nombre se va a ver este usuario en los listados.' }
  if (!sitioId) return { error: 'Elegí a qué punto pertenece.' }
  if (pinPedido && !esPinValido(pinPedido)) {
    return { error: 'El PIN son entre 4 y 8 dígitos, sin letras.' }
  }

  const pin = pinPedido || pinAlAzar()

  try {
    // sesion_horas en null: la sesión del punto no vence a propósito.
    const filas = await consultarConSesion<{ id: string }>(
      sesion,
      `insert into perfiles (usuario, nombre, rol, sitio_id, credencial_hash, sesion_horas)
       values ($1, $2, 'vigilador', $3, $4, null)
       returning id`,
      [usuario, nombre, sitioId, hashearCredencial(pin)],
    )
    if (!filas.length) return { error: 'No se pudo crear el usuario.' }
  } catch (e) {
    return { error: traducir(e) }
  }

  revalidatePath('/usuarios')
  return { pin, usuario, aviso: `Usuario ${usuario} creado.` }
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

  try {
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
        return { error: 'Ese usuario no existe, o es de coordinación: su contraseña no se resetea desde acá.' }
      }
      revalidatePath('/usuarios')
      return { pin, usuario: filas[0].usuario }
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
