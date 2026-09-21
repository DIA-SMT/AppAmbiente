'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import { exigirAdminCompleto } from '@/lib/sesion'

/**
 * Anonimizar corre en la base (app.anonimizar_vecino): vacía nombre, teléfono
 * y barrio y marca la ficha. La fila no se borra, así los movimientos que
 * trajo ese vecino y el tablero quedan intactos.
 */
export async function anonimizarVecino(datos: FormData): Promise<void> {
  const sesion = await exigirAdminCompleto().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const id = String(datos.get('id') ?? '').trim()
  const busqueda = String(datos.get('q') ?? '').trim()

  let aviso = 'anonimizado'
  if (!id) {
    aviso = 'error'
  } else {
    try {
      await consultarConSesion(sesion, `select app.anonimizar_vecino($1)`, [id])
    } catch {
      aviso = 'error'
    }
  }

  revalidatePath('/vecinos')

  const parametros = new URLSearchParams()
  if (busqueda) parametros.set('q', busqueda)
  parametros.set('aviso', aviso)
  redirect(`/vecinos?${parametros.toString()}`)
}
