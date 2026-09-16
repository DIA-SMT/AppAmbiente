'use server'

/**
 * Pedir el recambio de un contenedor, y cancelarlo si se pidió de más.
 *
 * Esto reemplaza el primer tramo del circuito: el mensaje al grupo de Puntos
 * Verdes. El resto sigue igual —la coordinación habla con la empresa por
 * WhatsApp— y los textos de acá no prometen otra cosa: si el vigilador creyera
 * que la app le avisa a la empresa, nadie escribiría el mensaje.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import { cancelarPedido, pedirRecambio } from '@/lib/datos'
import { UUID } from '@/lib/recursos'
import { sesionActual, type Sesion } from '@/lib/sesion'

export interface EstadoRecambio {
  ok?: boolean
  /** Qué quedó pedido y qué pasa ahora. */
  aviso?: string
  /** Ese contenedor ya tenía un pedido abierto. No es un error. */
  yaPedido?: boolean
  error?: string
}

/** Una línea, no un descargo: lo mismo que deja escribir la pantalla. */
const MAX_OBSERVACIONES = 200

/**
 * Cómo nombrar el contenedor: "contenedor de Cartón", sin artículo, para que
 * cada frase le ponga el suyo.
 *
 * La corriente sale de la base y no del celular, así el aviso nombra el
 * contenedor donde el pedido quedó realmente anotado y no el que la pantalla
 * creía tener. Uno sin corriente asignada se nombra a secas.
 */
async function comoSeLlama(sesion: Sesion, contenedorId: string): Promise<string> {
  const [fila] = await consultarConSesion<{ material: string | null }>(
    sesion,
    `select m.nombre as material
       from contenedores c
       left join materiales m on m.id = c.material_id
      where c.id = $1`,
    [contenedorId],
  )
  return fila?.material ? `contenedor de ${fila.material}` : 'contenedor'
}

export async function pedirElRecambio(
  contenedorId: string,
  urgente: boolean,
  observaciones: string,
): Promise<EstadoRecambio> {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  if (!UUID.test(contenedorId)) {
    return { error: 'No se pudo identificar el contenedor. Recargá la pantalla.' }
  }

  const cual = await comoSeLlama(sesion, contenedorId)

  const hecho = await pedirRecambio(sesion, {
    contenedorId,
    urgente,
    observaciones: String(observaciones ?? '').trim().slice(0, MAX_OBSERVACIONES),
  })
  if (!hecho.ok) return { error: hecho.error }

  revalidatePath('/contenedores')
  // El botón del turno dice cuántos contenedores esperan: ese número acaba de
  // cambiar.
  revalidatePath('/turno')

  // Pedir dos veces lo mismo no lo apura y ensuciaría el tiempo de respuesta,
  // así que la segunda vez no se crea nada. No es un error: es el mismo pedido.
  if (hecho.yaPedido) {
    return {
      yaPedido: true,
      aviso: `El ${cual} ya estaba pedido. Sigue valiendo ese pedido: volver a pedirlo no lo apura.`,
    }
  }

  return {
    ok: true,
    aviso: `Queda pedido el recambio del ${cual}${urgente ? ', como urgente' : ''}. Ahora la coordinación lo pasa a la empresa.`,
  }
}

export async function cancelarElPedido(
  pedidoId: string,
  motivo: string,
): Promise<EstadoRecambio> {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  if (!UUID.test(pedidoId)) {
    return { error: 'No se pudo identificar el pedido. Recargá la pantalla.' }
  }

  const hecho = await cancelarPedido(sesion, pedidoId, String(motivo ?? ''))
  if (!hecho.ok) return { error: hecho.error }

  revalidatePath('/contenedores')
  revalidatePath('/turno')

  return {
    ok: true,
    aviso: 'Pedido cancelado. Si el contenedor sigue lleno, pedilo de nuevo.',
  }
}
