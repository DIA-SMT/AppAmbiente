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

  if (!usuario) return { error: 'Elegí tu punto o escribí tu usuario.' }
  if (!credencial) return { error: 'Falta el PIN.', usuario }

  const r = await verificarAcceso(usuario, credencial)

  if (!r.ok) {
    if (r.motivo === 'bloqueado') {
      return {
        usuario,
        error: `Demasiados intentos. Probá de nuevo en ${r.minutos} minuto${r.minutos === 1 ? '' : 's'}, o pedile a la coordinadora que te resetee el PIN.`,
      }
    }
    if (r.motivo === 'inactivo') {
      return { usuario, error: 'Este usuario está desactivado. Hablá con la coordinadora.' }
    }
    return { usuario, error: 'El PIN no es correcto.' }
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
