'use server'

import { redirect } from 'next/navigation'
import { verificarAcceso } from '@/lib/acceso'
import { crearCookieDeSesion, cerrarSesion } from '@/lib/sesion'

export interface EstadoIngreso {
  error?: string
  usuario?: string
}

export async function ingresar(
  _previo: EstadoIngreso,
  datos: FormData,
): Promise<EstadoIngreso> {
  const usuario = String(datos.get('usuario') ?? '').trim()
  const credencial = String(datos.get('credencial') ?? '')
  // La coordinación entra con usuario escrito; los puntos, eligiendo del
  // selector. Uno pone una contraseña y el otro un PIN, y decirle "PIN" a
  // quien escribió una contraseña lo manda a buscar algo que no tiene.
  const esCoordinacion = datos.get('modo') === 'admin'
  const falta = esCoordinacion ? 'Falta la contraseña.' : 'Falta el PIN.'
  const incorrecta = esCoordinacion
    ? 'La contraseña no es correcta.'
    : 'El PIN no es correcto.'

  if (!usuario) return { error: 'Elegí tu punto o escribí tu usuario.' }
  if (!credencial) return { error: falta, usuario }

  const r = await verificarAcceso(usuario, credencial)

  if (!r.ok) {
    if (r.motivo === 'bloqueado') {
      return {
        usuario,
        error: `Demasiados intentos. Probá de nuevo en ${r.minutos} minuto${r.minutos === 1 ? '' : 's'}, o pedile a la coordinadora que te resetee el acceso.`,
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

  redirect(r.perfil.rol === 'admin' ? '/tablero' : '/turno')
}

export async function salir() {
  await cerrarSesion()
  redirect('/ingresar')
}
