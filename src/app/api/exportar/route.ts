/**
 * Exportación a Excel del listado y del resumen mensual.
 *
 * Es una ruta y no una Server Action porque el archivo se baja siguiendo un
 * enlace: el navegador se encarga de la descarga y la pantalla no se recarga.
 *
 * Solo coordinación. Igual, todas las consultas pasan por la capa de datos con
 * la sesión puesta, así que las políticas de la base vuelven a filtrar.
 */
import {
  buscarMovimientos, movimientosParaExportar, resumenMensual,
  materialesVisibles, sitiosVisibles,
} from '@/lib/datos'
import { consultarConSesion } from '@db/sesion'
import { hojaDeMovimientos, hojaDeResumen, type DatosDeExportacion } from '@/lib/excel'
import { ErrorSinPermiso, ErrorSinSesion, exigirAdmin } from '@/lib/sesion'
import { ETIQUETA_FLUJO, ETIQUETA_TIPO, numero, paraInputFechaHora } from '@/lib/formato'
import type {
  EstadoMovimiento, FiltrosMovimientos, Flujo, MovimientoListado, TipoMovimiento,
} from '@/lib/tipos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Arriba de esto Excel se pone lento y el pedido tarda demasiado. */
const TOPE_FILAS = 50_000
/** buscarMovimientos no devuelve más que esto por página. */
const POR_PAGINA = 500

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const FLUJOS = ['planta', 'punto_verde', 'gran_generador'] as const
const TIPOS = ['ingreso', 'salida', 'contenedor'] as const
const ESTADOS = ['vigente', 'anulado', 'todos'] as const

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function respuestaDeError(mensaje: string, estado: number) {
  return new Response(`${mensaje}\n`, {
    status: estado,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** dd/mm/aaaa a partir de 'aaaa-mm-dd', sin pasar por Date: una fecha sin hora
 *  interpretada en UTC y mostrada en Tucumán retrocede un día. */
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function leerTexto(valor: string | null, largo = 80): string | undefined {
  const limpio = valor?.trim()
  return limpio ? limpio.slice(0, largo) : undefined
}

type Lectura<T> = { ok: true; valor: T } | { ok: false; error: string }

function leerFiltros(p: URLSearchParams): Lectura<FiltrosMovimientos> {
  const flujo = leerTexto(p.get('flujo'))
  if (flujo && !FLUJOS.includes(flujo as Flujo)) return { ok: false, error: 'El flujo pedido no existe.' }

  const tipo = leerTexto(p.get('tipo'))
  if (tipo && !TIPOS.includes(tipo as TipoMovimiento)) return { ok: false, error: 'El tipo de movimiento pedido no existe.' }

  const estado = leerTexto(p.get('estado'))
  if (estado && !ESTADOS.includes(estado as EstadoMovimiento | 'todos')) {
    return { ok: false, error: 'El estado pedido no existe.' }
  }

  const sitioId = leerTexto(p.get('sitioId'))
  if (sitioId && !ES_UUID.test(sitioId)) return { ok: false, error: 'El punto pedido no es válido.' }

  const materialId = leerTexto(p.get('materialId'))
  if (materialId && !ES_UUID.test(materialId)) return { ok: false, error: 'El material pedido no es válido.' }

  const destinoId = leerTexto(p.get('destinoId'))
  if (destinoId && !ES_UUID.test(destinoId)) return { ok: false, error: 'El destino pedido no es válido.' }

  const desde = leerTexto(p.get('desde'))
  if (desde && !ES_FECHA.test(desde)) return { ok: false, error: 'La fecha "desde" tiene que ser aaaa-mm-dd.' }

  const hasta = leerTexto(p.get('hasta'))
  if (hasta && !ES_FECHA.test(hasta)) return { ok: false, error: 'La fecha "hasta" tiene que ser aaaa-mm-dd.' }

  if (desde && hasta && desde > hasta) {
    return { ok: false, error: 'La fecha "desde" quedó después de la fecha "hasta".' }
  }

  return {
    ok: true,
    valor: {
      flujo: flujo as Flujo | undefined,
      tipo: tipo as TipoMovimiento | undefined,
      sitioId, materialId, destinoId, desde, hasta,
      patente: leerTexto(p.get('patente'), 20),
      estado: (estado ?? 'vigente') as EstadoMovimiento | 'todos',
      texto: leerTexto(p.get('texto')),
    },
  }
}

function describirRango(desde?: string, hasta?: string): string {
  if (desde && hasta) return `Del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`
  if (desde) return `Desde el ${fechaCorta(desde)}`
  if (hasta) return `Hasta el ${fechaCorta(hasta)}`
  return 'Todo el período registrado'
}

function describirFiltros(
  f: FiltrosMovimientos,
  nombres: { sitio?: string; material?: string; destino?: string },
): string {
  const partes: string[] = []
  if (f.flujo) partes.push(ETIQUETA_FLUJO[f.flujo] ?? f.flujo)
  if (f.tipo) partes.push(`Solo ${(ETIQUETA_TIPO[f.tipo] ?? f.tipo).toLowerCase()}s`)
  if (f.sitioId) partes.push(`Punto: ${nombres.sitio ?? 'sin identificar'}`)
  if (f.materialId) partes.push(`Material: ${nombres.material ?? 'sin identificar'}`)
  if (f.destinoId) partes.push(`Destino: ${nombres.destino ?? 'sin identificar'}`)
  if (f.patente) partes.push(`Patente: ${f.patente}`)
  if (f.texto) partes.push(`Búsqueda: “${f.texto}”`)
  partes.push(
    f.estado === 'todos' ? 'Incluye movimientos anulados'
      : f.estado === 'anulado' ? 'Solo movimientos anulados'
        : 'Solo movimientos vigentes',
  )
  return partes.join(' · ')
}

function respuestaDeArchivo(cuerpo: ArrayBuffer, vista: string): Response {
  const hoy = paraInputFechaHora(new Date()).slice(0, 10)
  const nombre = `residuos-${vista}-${hoy}.xlsx`
  return new Response(new Uint8Array(cuerpo), {
    headers: {
      'content-type': TIPO_XLSX,
      'content-disposition': `attachment; filename="${nombre}"`,
      'cache-control': 'no-store',
    },
  })
}

export async function GET(pedido: Request) {
  let sesion
  try {
    sesion = await exigirAdmin()
  } catch (e) {
    if (e instanceof ErrorSinPermiso) return respuestaDeError('Las exportaciones son de la coordinación.', 403)
    if (e instanceof ErrorSinSesion) return respuestaDeError('Se cerró tu sesión. Entrá de nuevo y volvé a exportar.', 401)
    throw e
  }

  const parametros = new URL(pedido.url).searchParams
  const vista = parametros.get('vista') === 'resumen' ? 'resumen' : 'movimientos'
  const comun: DatosDeExportacion = { generadoPor: sesion.nombre, generadoEn: new Date() }

  try {
    if (vista === 'resumen') {
      const flujo = leerTexto(parametros.get('flujo'))
      if (flujo && !FLUJOS.includes(flujo as Flujo)) {
        return respuestaDeError('El flujo pedido no existe.', 400)
      }
      const sitioId = leerTexto(parametros.get('sitioId'))
      if (sitioId && !ES_UUID.test(sitioId)) return respuestaDeError('El punto pedido no es válido.', 400)

      const mesesPedidos = Number(leerTexto(parametros.get('meses'), 4) ?? 6)
      const meses = Number.isFinite(mesesPedidos) ? Math.min(Math.max(Math.trunc(mesesPedidos), 1), 36) : 6

      const filas = await resumenMensual(sesion, { flujo: flujo as Flujo | undefined, sitioId, meses })
      const sitio = sitioId ? (await sitiosVisibles(sesion)).find((s) => s.id === sitioId) : undefined

      const detalle = [
        flujo ? (ETIQUETA_FLUJO[flujo] ?? flujo) : 'Todos los flujos',
        sitioId ? `Punto: ${sitio?.nombre ?? 'sin identificar'}` : null,
      ].filter(Boolean).join(' · ')

      const libro = hojaDeResumen(filas, {
        ...comun,
        rango: `Últimos ${meses} ${meses === 1 ? 'mes' : 'meses'}`,
        filtros: detalle,
      })
      return respuestaDeArchivo(await libro.xlsx.writeBuffer(), 'resumen')
    }

    const lectura = leerFiltros(parametros)
    if (!lectura.ok) return respuestaDeError(lectura.error, 400)
    const filtros = lectura.valor

    // El conteo llega con la primera página: si el rango es enorme, se corta
    // antes de traer decenas de miles de filas al proceso.
    const primera = await buscarMovimientos(sesion, { ...filtros, pagina: 1, porPagina: POR_PAGINA })
    if (primera.total > TOPE_FILAS) {
      return respuestaDeError(
        `El pedido trae ${numero(primera.total, 0)} movimientos y el máximo por archivo es ${numero(TOPE_FILAS, 0)}. ` +
        'Achicá el rango de fechas o filtrá por punto o por material.',
        400,
      )
    }

    const items = await movimientosParaExportar(sesion, filtros)
    if (items.length > TOPE_FILAS) {
      return respuestaDeError(
        `El pedido trae ${numero(items.length, 0)} filas de material y el máximo por archivo es ${numero(TOPE_FILAS, 0)}. ` +
        'Achicá el rango de fechas o filtrá por punto o por material.',
        400,
      )
    }

    // v_movimiento_items no trae sitio, origen ni destino: vienen del listado
    // y se cruzan por id. El orden de buscarMovimientos es estable (fecha y
    // número), así que paginar no saltea ni repite filas.
    const porMovimiento = new Map<string, MovimientoListado>()
    for (const fila of primera.filas) porMovimiento.set(fila.id, fila)
    const paginas = Math.ceil(primera.total / POR_PAGINA)
    for (let pagina = 2; pagina <= paginas; pagina++) {
      const { filas } = await buscarMovimientos(sesion, { ...filtros, pagina, porPagina: POR_PAGINA })
      for (const fila of filas) porMovimiento.set(fila.id, fila)
    }

    // Los nombres son solo para el encabezado del archivo: que se entienda
    // qué se exportó sin tener que acordarse de los filtros que se usaron.
    const sitio = filtros.sitioId
      ? (await sitiosVisibles(sesion)).find((s) => s.id === filtros.sitioId)
      : undefined
    const material = filtros.materialId
      ? (await materialesVisibles(sesion)).find((m) => m.id === filtros.materialId)
      : undefined
    const destino = filtros.destinoId
      ? (await consultarConSesion<{ nombre: string }>(
          sesion, `select nombre from entidades_publicas where id = $1`, [filtros.destinoId],
        ))[0]
      : undefined

    const libro = hojaDeMovimientos(items, porMovimiento, {
      ...comun,
      rango: describirRango(filtros.desde, filtros.hasta),
      filtros: describirFiltros(filtros, {
        sitio: sitio?.nombre, material: material?.nombre, destino: destino?.nombre,
      }),
    })
    return respuestaDeArchivo(await libro.xlsx.writeBuffer(), 'movimientos')
  } catch (e) {
    console.error('[exportar] no se pudo generar el archivo', e)
    return respuestaDeError(
      'No se pudo generar el archivo. Probá de nuevo con un rango más chico; si sigue fallando, avisale a Sistemas.',
      500,
    )
  }
}
