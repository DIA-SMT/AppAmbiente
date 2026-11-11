/**
 * Salidas de contenedores: el contenedor lleno que se lleva la 9 de Julio,
 * anotado en el punto en el momento (0027).
 *
 * Aparte de datos.ts porque es una tabla aparte y no un movimiento: ver el
 * encabezado de la migración. Las mismas reglas: todo pasa por conSesion(), y
 * las políticas de la base vuelven a filtrar lo que se escape acá.
 *
 * La base puede no tener todavía la 0027 —se aplica DESPUÉS de subir el
 * build—, así que antes de leer o escribir se pregunta si la tabla está. En ese
 * rato el botón del punto no aparece y la pantalla de coordinación lo dice; nada
 * se rompe.
 */
import 'server-only'
import type { Conexion } from '@db/client'
import { conSesion, type Sesion } from '@db/sesion'
import { mensajeDeError } from './datos'
import { normalizarPatente } from './formato'
import type {
  DestinoSalidaContenedor, SalidaContenedor, SalidaContenedorNueva,
} from './tipos'

export const DESTINOS_CONTENEDOR: DestinoSalidaContenedor[] = ['nodo', 'san_felipe', 'huerta', 'otro']

/** Tope de materiales distintos en un contenedor: más que esto es un error de carga. */
export const MAX_ITEMS_SALIDA = 6

/** Lo mismo que un movimiento: el vigilador carga lo de las últimas 48 horas. */
const HORAS_HACIA_ATRAS = 48

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** ¿La base ya tiene la 0027? */
export async function haySalidasDeContenedorEnTx(tx: Conexion): Promise<boolean> {
  const [fila] = await tx.consultar<{ hay: boolean }>(
    `select to_regclass('public.salidas_contenedor') is not null as hay`,
  )
  return Boolean(fila?.hay)
}


/** Un nombre escrito a mano, sin espacios de más. */
function limpiar(texto: string | null | undefined, largo: number): string | null {
  const t = (texto ?? '').trim().replace(/\s+/g, ' ')
  return t ? t.slice(0, largo) : null
}

export type ResultadoSalida =
  | { ok: true; id: string; yaEstaba?: boolean }
  | { ok: false; error: string; campos?: Record<string, string> }

/**
 * Revisa lo que mandó el celular antes de abrir la transacción. Devuelve los
 * errores por campo, con las mismas claves que usa el formulario.
 */
export function validarSalida(
  datos: SalidaContenedorNueva,
  esAdmin: boolean,
  ahora = new Date(),
): Record<string, string> {
  const campos: Record<string, string> = {}

  const cuando = new Date(datos.salio_en)
  if (Number.isNaN(cuando.getTime())) {
    campos.cuando = 'Revisá la fecha y la hora.'
  } else if (cuando.getTime() > ahora.getTime() + 10 * 60_000) {
    campos.cuando = 'La hora no puede estar en el futuro.'
  } else if (!esAdmin && cuando.getTime() < ahora.getTime() - HORAS_HACIA_ATRAS * 3_600_000) {
    campos.cuando = 'Desde el punto se carga lo de las últimas 48 horas. Lo anterior lo carga la coordinación.'
  }

  const patente = normalizarPatente(datos.patente ?? '')
  if (patente.length < 2) campos.patente = 'Anotá la patente o el número de interno del camión.'
  else if (patente.length > 20) campos.patente = 'La patente o el interno va en 20 caracteres como mucho.'

  const chofer = limpiar(datos.chofer, 200)
  if (chofer && chofer.length < 2) campos.chofer = 'Escribí el nombre del chofer, o dejalo vacío.'
  else if (chofer && chofer.length > 80) campos.chofer = 'El nombre va en 80 caracteres como mucho.'

  if (!DESTINOS_CONTENEDOR.includes(datos.destino)) campos.destino = 'Elegí a dónde lo llevan.'
  else if (datos.destino === 'otro' && (limpiar(datos.destino_detalle, 120)?.length ?? 0) < 2) {
    campos.destinoDetalle = 'Escribí a dónde lo llevan.'
  }

  const items = Array.isArray(datos.items) ? datos.items : []
  if (items.length === 0) campos['material-0'] = 'Elegí qué llevaba el contenedor y cuánto.'
  if (items.length > MAX_ITEMS_SALIDA) campos['material-0'] = `Como mucho ${MAX_ITEMS_SALIDA} materiales por contenedor.`
  const vistos = new Set<string>()
  items.forEach((it, i) => {
    if (!ES_UUID.test(it.material_id ?? '')) campos[`material-${i}`] = 'Elegí qué material es.'
    else if (vistos.has(it.material_id)) campos[`material-${i}`] = 'Ese material ya está en la lista.'
    vistos.add(it.material_id)
    if (!ES_UUID.test(it.unidad_id ?? '')) campos[`cantidad-${i}`] = 'Falta la unidad.'
    const n = Number(it.cantidad)
    if (!Number.isFinite(n) || n <= 0) campos[`cantidad-${i}`] = 'Falta la cantidad.'
    else if (n > 100_000) campos[`cantidad-${i}`] = 'Esa cantidad es demasiado grande. Revisala.'
  })

  if (!ES_UUID.test(datos.client_uuid ?? '')) campos.general = 'Recargá la pantalla y probá de nuevo.'

  return campos
}

export async function registrarSalidaContenedor(
  sesion: Sesion,
  datos: SalidaContenedorNueva,
): Promise<ResultadoSalida> {
  const campos = validarSalida(datos, sesion.rol === 'admin')
  if (Object.keys(campos).length) {
    return { ok: false, error: 'Revisá lo marcado.', campos }
  }
  if (!sesion.sitioId) {
    return { ok: false, error: 'Esta cuenta no tiene un punto asignado.' }
  }

  try {
    return await conSesion(sesion, async (tx): Promise<ResultadoSalida> => {
      if (!(await haySalidasDeContenedorEnTx(tx))) {
        return { ok: false, error: 'Todavía no se puede anotar esto: falta actualizar la base. Avisale a la coordinación.' }
      }

      const [sitio] = await tx.consultar<{ tipo: string }>(
        'select tipo from sitios where id = $1',
        [sesion.sitioId],
      )
      if (sitio?.tipo !== 'punto_verde') {
        return { ok: false, error: 'Las salidas de contenedores se anotan desde un punto verde.' }
      }

      // Cada material tiene que ser del punto verde, estar activo y venir en
      // una de sus unidades: el celular puede tener una lista vieja.
      const ids = datos.items.map((i) => i.material_id)
      const materiales = await tx.consultar<{ id: string; nombre: string; unidades_permitidas: string[] }>(
        `select id, nombre, unidades_permitidas from materiales
          where id = any($1::uuid[]) and activo and 'punto_verde' = any(flujos)`,
        [ids],
      )
      const porId = new Map(materiales.map((m) => [m.id, m]))
      const camposItems: Record<string, string> = {}
      datos.items.forEach((it, i) => {
        const m = porId.get(it.material_id)
        if (!m) camposItems[`material-${i}`] = 'Ese material ya no está en la lista. Recargá la pantalla.'
        else if (!(m.unidades_permitidas ?? []).includes(it.unidad_id)) {
          camposItems[`cantidad-${i}`] = `${m.nombre} no se carga en esa unidad. Recargá la pantalla.`
        }
      })
      if (Object.keys(camposItems).length) {
        return { ok: false, error: 'Revisá lo marcado.', campos: camposItems }
      }

      // El mismo envío dos veces —doble toque, o la red que reintenta— no
      // anota dos salidas: la segunda devuelve la primera.
      const [nueva] = await tx.consultar<{ id: string }>(
        `insert into salidas_contenedor
           (sitio_id, salio_en, patente, chofer, destino, destino_detalle,
            observaciones, cargado_por_id, client_uuid)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (client_uuid) do nothing
         returning id`,
        [
          sesion.sitioId,
          new Date(datos.salio_en).toISOString(),
          normalizarPatente(datos.patente),
          limpiar(datos.chofer, 80),
          datos.destino,
          datos.destino === 'otro' ? limpiar(datos.destino_detalle, 120) : null,
          limpiar(datos.observaciones, 300),
          sesion.perfilId,
          datos.client_uuid,
        ],
      )
      if (!nueva) {
        const [previa] = await tx.consultar<{ id: string }>(
          'select id from salidas_contenedor where client_uuid = $1',
          [datos.client_uuid],
        )
        return previa
          ? { ok: true, id: previa.id, yaEstaba: true }
          : { ok: false, error: 'No se pudo guardar. Probá de nuevo.' }
      }

      for (const it of datos.items) {
        await tx.consultar(
          `insert into salidas_contenedor_items (salida_id, material_id, cantidad, unidad_id)
           values ($1, $2, $3, $4)`,
          [nueva.id, it.material_id, Number(it.cantidad), it.unidad_id],
        )
      }
      return { ok: true, id: nueva.id }
    })
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) }
  }
}

export interface FiltrosSalidas {
  /** aaaa-mm-dd, inclusive, en hora de Tucumán. */
  desde?: string
  /** aaaa-mm-dd, inclusive. */
  hasta?: string
  sitioId?: string
  /** Por defecto sólo las vigentes. */
  conAnuladas?: boolean
  limite?: number
}

export async function salidasDeContenedorEnTx(
  tx: Conexion,
  f: FiltrosSalidas = {},
): Promise<SalidaContenedor[]> {
  const donde: string[] = []
  const params: unknown[] = []
  const p = (v: unknown) => { params.push(v); return `$${params.length}` }

  // La transacción ya tiene la zona de Tucumán: el día corta donde lo ve la
  // pantalla.
  if (f.desde) donde.push(`salio_en >= ${p(f.desde)}::date`)
  if (f.hasta) donde.push(`salio_en < ${p(f.hasta)}::date + 1`)
  if (f.sitioId) donde.push(`sitio_id = ${p(f.sitioId)}`)
  if (!f.conAnuladas) donde.push('anulada_en is null')

  const limite = Math.min(Math.max(f.limite ?? 500, 1), 5000)
  return tx.consultar<SalidaContenedor>(
    `select * from v_salidas_contenedor
      ${donde.length ? `where ${donde.join(' and ')}` : ''}
      order by salio_en desc
      limit ${limite}`,
    params,
  )
}

export async function salidasDeContenedor(
  sesion: Sesion,
  f: FiltrosSalidas = {},
): Promise<{ hayTabla: boolean; salidas: SalidaContenedor[] }> {
  return conSesion(sesion, async (tx) => {
    if (!(await haySalidasDeContenedorEnTx(tx))) return { hayTabla: false, salidas: [] }
    return { hayTabla: true, salidas: await salidasDeContenedorEnTx(tx, f) }
  })
}

export async function anularSalidaContenedor(
  sesion: Sesion,
  id: string,
  motivo: string,
): Promise<{ ok: boolean; error?: string }> {
  const limpio = motivo.trim()
  if (limpio.length < 3) return { ok: false, error: 'Decí por qué se anula.' }
  if (!ES_UUID.test(id)) return { ok: false, error: 'No se pudo identificar la salida.' }
  try {
    return await conSesion(sesion, async (tx) => {
      const filas = await tx.consultar<{ id: string }>(
        `update salidas_contenedor
            set anulada_en = now(), anulada_por_id = $2, motivo_anulacion = $3
          where id = $1 and anulada_en is null
          returning id`,
        [id, sesion.perfilId, limpio.slice(0, 200)],
      )
      return filas.length ? { ok: true } : { ok: false, error: 'Esa salida ya estaba anulada.' }
    })
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) }
  }
}
