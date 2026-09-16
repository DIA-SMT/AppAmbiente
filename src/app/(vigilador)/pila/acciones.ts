'use server'

/**
 * Anotar un volteo, un riego o una temperatura desde la Planta.
 *
 * Lo hace un operario al lado de la pila, con guantes: la acción no pide fecha
 * —vale la de ahora— ni devuelve nada más que la frase que la pantalla le
 * muestra debajo de los botones.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import { registrarControl } from '@/lib/datos'
import { hora, numero } from '@/lib/formato'
import { UUID } from '@/lib/recursos'
import { sesionActual } from '@/lib/sesion'

export interface EstadoControl {
  ok?: boolean
  /** Qué quedó anotado y en qué pila. */
  aviso?: string
  error?: string
}

/** Lo único que se anota de un toque. Humedad y observación no tienen pantalla. */
const TIPOS = ['volteo', 'riego', 'temperatura'] as const
type TipoRapido = (typeof TIPOS)[number]

const ROTULO: Record<TipoRapido, string> = {
  volteo: 'Volteo',
  riego: 'Riego',
  temperatura: 'Temperatura',
}

export async function anotarControl(
  pilaId: string,
  tipo: string,
  valor: number | null = null,
): Promise<EstadoControl> {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  if (!UUID.test(pilaId)) {
    return { error: 'No se pudo identificar la pila. Recargá la pantalla.' }
  }
  if (!(TIPOS as readonly string[]).includes(tipo)) {
    return { error: 'No se pudo identificar qué se estaba anotando. Recargá la pantalla.' }
  }
  const que = tipo as TipoRapido

  // Un volteo y un riego valen por haber pasado; una temperatura sin número no
  // dice nada, y `null` no puede colarse como cero grados.
  if (que === 'temperatura' && (valor === null || !Number.isFinite(valor))) {
    return { error: 'Escribí la temperatura para poder anotarla.' }
  }

  const alta = await registrarControl(sesion, {
    pila_id: pilaId,
    tipo: que,
    valor: que === 'temperatura' ? valor : null,
  })
  if (!alta.ok) return { error: alta.error }

  revalidatePath('/pila')

  // El código sale de la base y no del celular: así el aviso nombra la pila
  // donde el control quedó realmente anotado.
  const [pila] = await consultarConSesion<{ codigo: string }>(
    sesion,
    'select codigo from pilas where id = $1',
    [pilaId],
  )

  const anotado = que === 'temperatura' ? `${numero(valor, 1)} °C` : ROTULO[que]
  return {
    ok: true,
    aviso: `${anotado} en ${pila?.codigo ?? 'la pila'}, a las ${hora(new Date())}.`,
  }
}
