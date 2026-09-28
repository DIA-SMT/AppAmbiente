'use server'

/**
 * Olvidar desde el celular algo que Migue recuerda del punto.
 *
 * Lo hace la base: app.migue_olvidar_recuerdo mira que el recuerdo sea de
 * este punto, lo vacía y cierra, vaciándolas, las conversaciones donde lo
 * tenía presente. Acá sólo se valida lo que llega y se arma la vuelta.
 *
 * Sale bien con un redirect y no devolviendo un aviso, a diferencia de
 * /contenedores: allá el botón sigue en pantalla después de pedir, y acá el
 * recuerdo olvidado desaparece de la lista con su botón y con cualquier aviso
 * que el botón quisiera mostrar. El aviso lo muestra la pantalla.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { olvidarRecuerdo } from '@/lib/migue/pantallas'
import { UUID } from '@/lib/recursos'
import { sesionActual } from '@/lib/sesion'

export interface EstadoOlvido {
  error?: string
}

export async function olvidarDelPunto(recuerdoId: string): Promise<EstadoOlvido> {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  // La base igual dejaría a la coordinación olvidar un recuerdo de un punto,
  // pero por esta puerta no: la del panel pide la cuenta completa, y ésta no
  // puede ser la rendija por donde una cuenta a medio configurar actúa igual.
  if (sesion.rol !== 'vigilador') redirect('/tablero')

  if (!UUID.test(recuerdoId)) {
    return { error: 'No se pudo identificar qué olvidar. Recargá la pantalla.' }
  }

  const hecho = await olvidarRecuerdo(sesion, recuerdoId)
  if (!hecho.ok) return { error: hecho.error }

  revalidatePath('/preguntar/recuerdos')
  // La conversación que estaba abierta en este celular pudo haberse cerrado:
  // si /preguntar quedara en la memoria del navegador, la seguiría mostrando.
  revalidatePath('/preguntar')
  redirect('/preguntar/recuerdos?aviso=olvidado')
}
