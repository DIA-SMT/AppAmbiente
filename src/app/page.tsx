import { redirect } from 'next/navigation'
import { sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

export default async function Inicio() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')
  redirect(sesion.rol === 'admin' ? '/tablero' : '/turno')
}
