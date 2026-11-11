'use server'

/**
 * Anotar el contenedor lleno que se lleva la 9 de Julio.
 *
 * Es lo que la coordinación después cruza con el Excel de la empresa, así que
 * se anota en el momento y desde el punto: lo que dice el vigilador que se fue,
 * contra lo que la empresa dice que llevó y cobra.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { registrarSalidaContenedor } from '@/lib/salidasContenedor'
import { sesionActual } from '@/lib/sesion'
import type { SalidaContenedorNueva } from '@/lib/tipos'

export interface EstadoSalida {
  ok?: boolean
  error?: string
  campos?: Record<string, string>
  /** El mismo envío llegó dos veces: quedó anotada una sola. */
  yaEstaba?: boolean
}

export async function anotarSalida(datos: SalidaContenedorNueva): Promise<EstadoSalida> {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  const hecho = await registrarSalidaContenedor(sesion, datos)
  if (!hecho.ok) return { error: hecho.error, campos: hecho.campos }

  revalidatePath('/contenedores/salida')
  return { ok: true, yaEstaba: hecho.yaEstaba }
}
