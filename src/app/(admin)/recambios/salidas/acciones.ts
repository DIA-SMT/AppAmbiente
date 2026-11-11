'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { anularSalidaContenedor } from '@/lib/salidasContenedor'
import { exigirAdminCompleto } from '@/lib/sesion'

/**
 * Anular una salida mal cargada. No se borra: queda en gris, con quién la anuló
 * y por qué, y deja de contar en el Excel salvo que se pidan las anuladas.
 */
export async function anular(id: string, volverA: string, datos: FormData): Promise<void> {
  const sesion = await exigirAdminCompleto().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const motivo = String(datos.get('motivo') ?? '').trim()
  const hecho = await anularSalidaContenedor(sesion, id, motivo)

  // Se vuelve a la misma vista, con los filtros que tenía.
  const destino = new URL(volverA.startsWith('/recambios/salidas') ? volverA : '/recambios/salidas', 'http://x')
  destino.searchParams.set('aviso', hecho.ok ? 'anulada' : 'error')
  if (!hecho.ok) destino.searchParams.set('detalle', hecho.error ?? 'No se pudo anular.')
  else destino.searchParams.delete('detalle')

  revalidatePath('/recambios/salidas')
  redirect(`${destino.pathname}${destino.search}`)
}
