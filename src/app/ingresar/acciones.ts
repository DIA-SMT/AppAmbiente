'use server'

import { redirect } from 'next/navigation'
import { verificarAcceso } from '@/lib/acceso'
import { cerrarSesion, crearCookieDeSesion } from '@/lib/sesion'

export interface EstadoIngreso {
  error?: string
  /** Lo que escribieron recién, para devolverlo puesto y no hacerlo tipear otra vez. */
  usuario?: string
}

/** El bloqueo llega en minutos; el contrato los da opcionales y el texto no. */
function enMinutos(minutos = 5) {
  return `${minutos} minuto${minutos === 1 ? '' : 's'}`
}

export async function ingresar(
  _previo: EstadoIngreso,
  datos: FormData,
): Promise<EstadoIngreso> {
  const usuario = String(datos.get('usuario') ?? '').trim()
  const credencial = String(datos.get('credencial') ?? '')
  // La coordinación entra con lo que escribe; los puntos, eligiendo del
  // selector. Uno pone una contraseña y el otro un PIN, y decirle "PIN" a
  // quien escribió una contraseña lo manda a buscar algo que no tiene.
  const esCoordinacion = datos.get('modo') === 'admin'
  const falta = esCoordinacion ? 'Falta la contraseña.' : 'Falta el PIN.'
  const incorrecta = esCoordinacion
    // Sin decir cuál de los dos está mal: si dijera "la contraseña no es", de
    // paso confirmaría qué correos tienen cuenta.
    ? 'El correo o la contraseña no son correctos.'
    : 'El PIN no es correcto.'

  if (!usuario) {
    return {
      error: esCoordinacion
        ? 'Escribí tu correo institucional o tu usuario.'
        : 'Elegí tu punto o escribí tu usuario.',
    }
  }
  if (!credencial) return { error: falta, usuario }

  const r = await verificarAcceso(usuario, credencial)

  if (!r.ok) {
    if (r.motivo === 'bloqueado') {
      return {
        usuario,
        error: `Demasiados intentos. Probá de nuevo en ${enMinutos(r.minutos)}, o pedile a la coordinadora que te resetee el acceso.`,
      }
    }
    if (r.motivo === 'inactivo') {
      return { usuario, error: 'Este usuario está desactivado. Hablá con la coordinadora.' }
    }
    return { usuario, error: incorrecta }
  }

  await crearCookieDeSesion({
    id: r.perfil.id,
    rol: r.perfil.rol,
    sitio_id: r.perfil.sitio_id,
    nombre: r.perfil.nombre,
    sesion_horas: r.perfil.sesion_horas,
  })

  // Quien todavía no cargó su correo o sigue con la contraseña con la que le
  // crearon la cuenta va a parar a /cuenta, pero eso lo decide el portón del
  // servidor cuando se pide el tablero. Decidirlo también acá sería la misma
  // regla escrita en dos lados, y tarde o temprano dirían cosas distintas.
  redirect(r.perfil.rol === 'admin' ? '/tablero' : '/turno')
}

export async function salir() {
  await cerrarSesion()
  redirect('/ingresar')
}
