/**
 * Recibe los movimientos que el celular no pudo enviar en el momento.
 *
 * Es la misma alta que hace el formulario, con la misma sesión y las mismas
 * políticas: la cola no es una puerta de atrás. Y como crearMovimiento es
 * idempotente por client_uuid, el celular puede reintentar todas las veces que
 * haga falta sin miedo a duplicar.
 */
import { crearMovimiento } from '@/lib/datos'
import { esquemaMovimiento } from '@/lib/cola'
import { sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

export async function POST(pedido: Request) {
  const sesion = await sesionActual()
  if (!sesion) {
    return Response.json({ ok: false, error: 'Se cerró la sesión. Volvé a entrar a la app.' }, { status: 401 })
  }

  const cuerpo = await pedido.json().catch(() => null)
  const leido = esquemaMovimiento.safeParse(cuerpo)
  if (!leido.success) {
    return Response.json(
      { ok: false, error: 'El movimiento llegó incompleto. Cargalo de nuevo.' },
      { status: 400 },
    )
  }

  const alta = await crearMovimiento(sesion, leido.data)
  if (!alta.ok) {
    return Response.json({ ok: false, error: alta.error }, { status: 422 })
  }

  return Response.json({ ok: true, numero: alta.numero })
}
