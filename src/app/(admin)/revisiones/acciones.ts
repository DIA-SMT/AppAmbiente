'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { conSesion, consultarConSesion } from '@db/sesion'
import { mensajeDeError } from '@/lib/datos'
import { UUID } from '@/lib/recursos'
import { exigirAdmin } from '@/lib/sesion'

export interface EstadoFusion {
  error?: string
}

/**
 * Lo que la pantalla puede contar después de cada acción. El detalle es el
 * nombre de la entidad, o el motivo cuando algo salió mal.
 */
function volver(aviso: string, detalle?: string): never {
  const parametros = new URLSearchParams({ aviso })
  if (detalle) parametros.set('detalle', detalle)
  redirect(`/revisiones?${parametros.toString()}`)
}

/** Después de tocar una entidad cambian las tres pantallas que la muestran. */
function refrescar() {
  revalidatePath('/revisiones')
  revalidatePath('/listas/entidades')
  revalidatePath('/movimientos')
}

/** Mensaje pensado para la coordinadora, no para el log. */
class ErrorDeRevision extends Error {}

// ── Confirmar ───────────────────────────────────────────────────────────

/**
 * Queda en la lista maestra como cualquier otra entidad.
 *
 * El segundo parámetro lo agrega el formulario al hacer bind con el id; no se
 * usa, pero tiene que estar declarado para que el tipo cierre.
 */
export async function confirmar(id: string, _datos?: FormData): Promise<void> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')
  if (!UUID.test(id)) volver('error', 'No se pudo identificar el alta. Recargá la pantalla.')

  let aviso = 'confirmada'
  let detalle = ''
  try {
    const filas = await consultarConSesion<{ nombre: string }>(
      sesion,
      `update entidades set pendiente_revision = false
        where id = $1 and pendiente_revision and activo
        returning nombre`,
      [id],
    )
    if (filas.length) {
      detalle = filas[0].nombre
    } else {
      aviso = 'error'
      detalle = 'Ese alta ya lo revisó otra persona. Recargá la pantalla.'
    }
  } catch (e) {
    aviso = 'error'
    detalle = mensajeDeError(e)
  }

  refrescar()
  volver(aviso, detalle)
}

// ── Fusionar ────────────────────────────────────────────────────────────

/**
 * "Don Ramón" y "don ramon" son el mismo carrero. Los movimientos que apuntan
 * al alta de la calle pasan a la entidad que ya existía, y la duplicada queda
 * desactivada: en este sistema no hay DELETE, está revocado en la base para
 * todos los roles.
 *
 * Las tres sentencias van en la misma transacción. Si reapuntáramos los
 * movimientos y fallara la baja, quedarían dos entidades vivas con la lista de
 * movimientos ya mudada, y nadie se enteraría.
 */
export async function fusionar(idOrigen: string, idDestino: string): Promise<EstadoFusion> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')

  if (!UUID.test(idOrigen)) {
    return { error: 'No se pudo identificar el alta a fusionar. Recargá la pantalla.' }
  }
  if (!UUID.test(idDestino)) {
    return { error: 'Elegí con cuál de las entidades ya confirmadas se fusiona.' }
  }
  if (idOrigen === idDestino) {
    return { error: 'Esa es la misma entidad. Elegí otra.' }
  }

  let nombres: { origen: string; destino: string } | null = null
  let error = ''

  try {
    nombres = await conSesion(sesion, async (tx) => {
      const [destino] = await tx.consultar<{ nombre: string }>(
        `select nombre from entidades
          where id = $1 and activo and not pendiente_revision`,
        [idDestino],
      )
      if (!destino) {
        throw new ErrorDeRevision('Esa entidad ya no está disponible. Recargá la pantalla y elegí otra.')
      }

      const [origen] = await tx.consultar<{ nombre: string }>(
        `select nombre from entidades
          where id = $1 and activo and pendiente_revision`,
        [idOrigen],
      )
      if (!origen) {
        throw new ErrorDeRevision('Ese alta ya lo revisó otra persona. Recargá la pantalla.')
      }

      await tx.consultar(
        `update movimientos set origen_entidad_id = $2 where origen_entidad_id = $1`,
        [idOrigen, idDestino],
      )
      await tx.consultar(
        `update movimientos set destino_entidad_id = $2 where destino_entidad_id = $1`,
        [idOrigen, idDestino],
      )
      await tx.consultar(`update entidades set activo = false where id = $1`, [idOrigen])

      return { origen: origen.nombre, destino: destino.nombre }
    })
  } catch (e) {
    error = e instanceof ErrorDeRevision ? e.message : mensajeDeError(e)
  }

  if (error || !nombres) {
    return { error: error || 'No se pudo fusionar. Probá de nuevo.' }
  }

  refrescar()
  volver('fusionada', `${nombres.origen} → ${nombres.destino}`)
}

// ── Descartar ───────────────────────────────────────────────────────────

/**
 * Baja lógica. Los movimientos que la referencian quedan apuntando a una
 * entidad inactiva: por eso la pantalla empuja a fusionar cuando ya tiene uso.
 */
export async function descartar(id: string, _datos?: FormData): Promise<void> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')
  if (!UUID.test(id)) volver('error', 'No se pudo identificar el alta. Recargá la pantalla.')

  let aviso = 'descartada'
  let detalle = ''
  try {
    const filas = await consultarConSesion<{ nombre: string }>(
      sesion,
      `update entidades set activo = false
        where id = $1 and pendiente_revision and activo
        returning nombre`,
      [id],
    )
    if (filas.length) {
      detalle = filas[0].nombre
    } else {
      aviso = 'error'
      detalle = 'Ese alta ya lo revisó otra persona. Recargá la pantalla.'
    }
  } catch (e) {
    aviso = 'error'
    detalle = mensajeDeError(e)
  }

  refrescar()
  volver(aviso, detalle)
}

// ── Conteo para la barra de navegación ──────────────────────────────────

/**
 * El número que va al lado de "Revisiones" en la barra. Vive acá y no en el
 * layout porque la barra es un componente de cliente y el layout no se toca:
 * la llama al montarse y cada vez que se cambia de sección.
 */
export async function contarPendientes(): Promise<number> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) return 0

  try {
    const [fila] = await consultarConSesion<{ total: number }>(
      sesion,
      `select count(*)::int as total from entidades where pendiente_revision and activo`,
    )
    return fila?.total ?? 0
  } catch {
    // Un número de más en la barra no justifica romper el panel entero.
    return 0
  }
}
