'use server'

import { redirect } from 'next/navigation'
import { esquemaMovimiento } from '@/lib/cola'
import { crearMovimiento, mensajeDeError } from '@/lib/datos'
import { sesionActual } from '@/lib/sesion'

export interface EstadoAlta {
  error?: string
  /** Qué campos marcar en rojo. Lo llena la validación del celular. */
  campos?: Record<string, string>
}

/**
 * El movimiento viaja armado desde el celular, en un solo campo del form, con
 * el mismo esquema que usa la cola sin señal: así lo que se manda ahora y lo
 * que se manda cuando vuelve la señal son exactamente la misma cosa.
 */
export async function registrarMovimiento(
  _previo: EstadoAlta,
  datos: FormData,
): Promise<EstadoAlta> {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  let numero: number | undefined

  try {
    const crudo = String(datos.get('movimiento') ?? '')
    const leido = esquemaMovimiento.safeParse(crudo ? JSON.parse(crudo) : null)
    if (!leido.success) {
      return { error: 'El movimiento llegó incompleto. Revisá los campos y probá de nuevo.' }
    }

    const alta = await crearMovimiento(sesion, leido.data)
    if (!alta.ok) return { error: alta.error }
    numero = alta.numero
  } catch (e) {
    return { error: mensajeDeError(e) }
  }

  redirect(`/listo/${numero}`)
}
