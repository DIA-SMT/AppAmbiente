'use server'

import { revalidatePath } from 'next/cache'
import { anularMovimiento } from '@/lib/datos'
import { exigirAdmin } from '@/lib/sesion'

export interface EstadoAnulacion {
  ok?: boolean
  error?: string
}

export async function anular(id: string, motivo: string): Promise<EstadoAnulacion> {
  let sesion
  try {
    sesion = await exigirAdmin()
  } catch {
    return { error: 'Tu sesión venció o no tenés permiso para anular. Volvé a entrar.' }
  }

  const r = await anularMovimiento(sesion, id, motivo)
  if (!r.ok) return { error: r.error }

  revalidatePath('/movimientos')
  revalidatePath(`/movimientos/${id}`)
  return { ok: true }
}
