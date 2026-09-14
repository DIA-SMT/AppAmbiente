/**
 * Armado de los dos libros de Excel que exporta el panel.
 *
 * Las fechas van como texto ya formateado en dd/mm/aaaa y no como serial de
 * Excel: la planilla se abre en máquinas con configuraciones regionales
 * distintas y un serial se muestra como 9/14/2026 o directamente como número.
 * Las cantidades sí van como número, para que se puedan sumar en la planilla.
 */
import 'server-only'
// exceljs es CommonJS y reexporta desde otro archivo, así que los imports con
// nombre no se ven desde ESM. El import por defecto funciona en los dos lados.
import ExcelJS from 'exceljs'
import type { Workbook, Worksheet } from 'exceljs'
import type { FilaResumen, ItemListado, MovimientoListado } from './tipos'
import { ETIQUETA_FLUJO, ETIQUETA_TIPO, fecha, fechaHora, hora, mesCorto, numero } from './formato'

const MUNICIPIO = 'Municipalidad de San Miguel de Tucumán'
const ORGANISMO = 'Secretaría de Ambiente y Desarrollo Sustentable'
const APLICACION = 'Residuos SMT'

const AZUL = 'FF126FF5'
const AZUL_HONDO = 'FF0D3FB0'
const BLANCO = 'FFFFFFFF'
const TINTA = 'FF10233D'
const GRIS = 'FF6B7885'
const GRIS_SUAVE = 'FF93A1B0'
const LINEA = 'FFE3E8EF'
const PANEL_2 = 'FFF8FBFF'

const DECIMALES = '#,##0.00'
const ENTEROS = '#,##0'

const ETIQUETA_ESTADO: Record<string, string> = { vigente: 'Vigente', anulado: 'Anulado' }

export interface DatosDeExportacion {
  /** Rango pedido, ya escrito para leer: "Del 01/09/2026 al 14/09/2026". */
  rango?: string
  /** Filtros aplicados, en una línea. Vacío si no hay ninguno. */
  filtros?: string
  /** Quién apretó exportar. */
  generadoPor?: string
  generadoEn?: Date
}

interface Columna {
  titulo: string
  ancho: number
  formato?: string
  alinear?: 'left' | 'center' | 'right'
}

// ── Piezas comunes ──────────────────────────────────────────────────────

function nuevoLibro(datos: DatosDeExportacion): Workbook {
  const libro = new ExcelJS.Workbook()
  libro.creator = `${APLICACION} — ${ORGANISMO}`
  libro.lastModifiedBy = datos.generadoPor ?? APLICACION
  libro.created = datos.generadoEn ?? new Date()
  libro.modified = libro.created
  return libro
}

/** Rótulo del organismo y qué se exportó. Ocupa las filas 1 a 4. */
function escribirEncabezado(
  hoja: Worksheet,
  titulo: string,
  columnas: number,
  datos: DatosDeExportacion,
) {
  const lineas: Array<{ texto: string; tamanio: number; negrita: boolean; color: string }> = [
    { texto: MUNICIPIO, tamanio: 13, negrita: true, color: TINTA },
    { texto: ORGANISMO, tamanio: 11, negrita: false, color: GRIS },
    { texto: datos.rango ? `${titulo} · ${datos.rango}` : titulo, tamanio: 12, negrita: true, color: AZUL_HONDO },
    { texto: datos.filtros ?? '', tamanio: 9, negrita: false, color: GRIS },
  ]

  lineas.forEach((linea, i) => {
    const fila = hoja.getRow(i + 1)
    fila.height = i === 0 ? 20 : 16
    const celda = fila.getCell(1)
    celda.value = linea.texto
    celda.font = { size: linea.tamanio, bold: linea.negrita, color: { argb: linea.color } }
    celda.alignment = { vertical: 'middle' }
    if (columnas > 1) hoja.mergeCells(i + 1, 1, i + 1, columnas)
  })
}

/** Fila de títulos: negrita blanca sobre el azul institucional. */
function escribirTitulos(hoja: Worksheet, numeroFila: number, titulos: string[]) {
  const fila = hoja.getRow(numeroFila)
  fila.height = 28
  titulos.forEach((titulo, i) => {
    const celda = fila.getCell(i + 1)
    celda.value = titulo
    celda.font = { bold: true, size: 10, color: { argb: BLANCO } }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    celda.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    celda.border = { bottom: { style: 'thin', color: { argb: AZUL_HONDO } } }
  })
}

function pintarFilaDeDatos(hoja: Worksheet, numeroFila: number, columnas: Columna[], apagada: boolean) {
  const fila = hoja.getRow(numeroFila)
  columnas.forEach((columna, i) => {
    const celda = fila.getCell(i + 1)
    if (columna.formato) celda.numFmt = columna.formato
    celda.alignment = { vertical: 'middle', horizontal: columna.alinear ?? 'left' }
    celda.border = { bottom: { style: 'hair', color: { argb: LINEA } } }
    if (apagada) celda.font = { color: { argb: GRIS_SUAVE }, italic: true }
  })
}

/** De dónde salió el archivo y cuándo. Siempre la última fila. */
function escribirPie(
  hoja: Worksheet,
  numeroFila: number,
  columnas: number,
  datos: DatosDeExportacion,
  notas: string[],
) {
  const cuando = fechaHora(datos.generadoEn ?? new Date())
  const quien = datos.generadoPor ? ` por ${datos.generadoPor}` : ''
  const partes = [`Exportado desde ${APLICACION} (${ORGANISMO}, ${MUNICIPIO}) el ${cuando}${quien}.`, ...notas]

  partes.forEach((texto, i) => {
    const fila = hoja.getRow(numeroFila + i)
    fila.height = 14
    const celda = fila.getCell(1)
    celda.value = texto
    celda.font = { size: 9, italic: true, color: { argb: GRIS } }
    celda.alignment = { vertical: 'middle' }
    if (columnas > 1) hoja.mergeCells(numeroFila + i, 1, numeroFila + i, columnas)
  })
}

/** El número que se puede sumar, o null cuando no hay con qué convertir. */
function aNumero(valor: number | string | null | undefined): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

/**
 * Clave 'aaaa-mm' del mes. La columna viene como date: si se la interpretara
 * en hora de Tucumán, la medianoche UTC del día 1 caería el último día del
 * mes anterior y septiembre se mostraría como agosto.
 */
function claveMes(valor: string | Date): string {
  if (typeof valor === 'string') {
    const m = /^(\d{4})-(\d{2})/.exec(valor)
    if (m) return `${m[1]}-${m[2]}`
  }
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return 'sin-fecha'
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 'SEP 2026' a partir de la clave, sin que la zona horaria corra el mes. */
function rotuloMes(clave: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(clave)
  if (!m) return 'Sin fecha'
  const alMediodia = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1, 12))
  return `${mesCorto(alMediodia)} ${m[1]}`
}

// ── Hoja de movimientos ─────────────────────────────────────────────────

const COLUMNAS_MOVIMIENTOS: Columna[] = [
  { titulo: 'Nº', ancho: 9, formato: ENTEROS, alinear: 'right' },
  { titulo: 'Fecha', ancho: 12, alinear: 'center' },
  { titulo: 'Hora', ancho: 8, alinear: 'center' },
  { titulo: 'Flujo', ancho: 22 },
  { titulo: 'Tipo', ancho: 11, alinear: 'center' },
  { titulo: 'Sitio', ancho: 26 },
  { titulo: 'Origen', ancho: 26 },
  { titulo: 'Destino', ancho: 26 },
  { titulo: 'Material', ancho: 26 },
  { titulo: 'Cantidad', ancho: 12, formato: DECIMALES, alinear: 'right' },
  { titulo: 'Unidad', ancho: 14 },
  { titulo: 'Equivalente m³', ancho: 15, formato: DECIMALES, alinear: 'right' },
  { titulo: 'Estado', ancho: 11, alinear: 'center' },
]

const FILA_TITULOS = 5

/**
 * Una fila por material movido. Es la unidad que se puede sumar: un
 * movimiento con poda y restos de jardinería ocupa dos filas y cada cantidad
 * queda con su material, en vez de sumarse dos veces.
 *
 * `porMovimiento` trae sitio, origen y destino, que v_movimiento_items no
 * tiene. Sin ese mapa las tres columnas salen vacías, pero el resto del
 * archivo sigue siendo correcto.
 */
export function hojaDeMovimientos(
  items: ItemListado[],
  porMovimiento: Map<string, MovimientoListado> = new Map(),
  datos: DatosDeExportacion = {},
): Workbook {
  const libro = nuevoLibro(datos)
  const hoja = libro.addWorksheet('Movimientos', {
    views: [{ state: 'frozen', ySplit: FILA_TITULOS, topLeftCell: `A${FILA_TITULOS + 1}` }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  hoja.columns = COLUMNAS_MOVIMIENTOS.map((c) => ({ width: c.ancho }))
  escribirEncabezado(hoja, 'Movimientos de residuos', COLUMNAS_MOVIMIENTOS.length, datos)
  escribirTitulos(hoja, FILA_TITULOS, COLUMNAS_MOVIMIENTOS.map((c) => c.titulo))

  let numeroFila = FILA_TITULOS
  for (const item of items) {
    const movimiento = porMovimiento.get(item.movimiento_id)
    numeroFila += 1
    hoja.getRow(numeroFila).values = [
      Number(item.numero),
      fecha(item.ocurrido_en),
      hora(item.ocurrido_en),
      ETIQUETA_FLUJO[item.flujo] ?? item.flujo,
      ETIQUETA_TIPO[item.tipo] ?? item.tipo,
      movimiento?.sitio_nombre ?? null,
      movimiento?.origen_nombre ?? null,
      movimiento?.destino_nombre ?? null,
      item.material_nombre,
      aNumero(item.cantidad),
      item.unidad_plural ?? item.unidad_nombre,
      // Sin factor de conversión el equivalente no existe: mejor vacío que un
      // cero que se sumaría como si fuera un dato.
      item.factor_m3 === null ? null : aNumero(item.equivalente_m3),
      ETIQUETA_ESTADO[item.estado] ?? item.estado,
    ]
    pintarFilaDeDatos(hoja, numeroFila, COLUMNAS_MOVIMIENTOS, item.estado === 'anulado')
  }

  if (items.length) {
    hoja.autoFilter = {
      from: { row: FILA_TITULOS, column: 1 },
      to: { row: numeroFila, column: COLUMNAS_MOVIMIENTOS.length },
    }
  }

  const anulados = items.filter((i) => i.estado === 'anulado').length
  const notas = [
    `${numero(items.length, 0)} fila${items.length === 1 ? '' : 's'}, una por cada material movido.` +
      (anulados ? ` ${numero(anulados, 0)} en gris: movimientos anulados.` : ''),
  ]
  if (!items.length) notas.push('No hubo movimientos con los filtros pedidos.')
  escribirPie(hoja, numeroFila + 2, COLUMNAS_MOVIMIENTOS.length, datos, notas)

  return libro
}

// ── Hoja de resumen ─────────────────────────────────────────────────────

interface FilaMaterial {
  material: string
  unidad: string
  /** clave de mes → cantidad, separada por tipo. */
  ingreso: Map<string, number>
  salida: Map<string, number>
  totalIngreso: number
  totalSalida: number
}

function sumar(mapa: Map<string, number>, clave: string, valor: number) {
  mapa.set(clave, (mapa.get(clave) ?? 0) + valor)
}

/**
 * Materiales en filas, meses en columnas, ingreso y salida separados.
 *
 * Un material se abre en dos filas si se cargó con dos unidades distintas:
 * sumar kilos con metros cúbicos en la misma celda daría un número que no
 * significa nada.
 */
export function hojaDeResumen(filas: FilaResumen[], datos: DatosDeExportacion = {}): Workbook {
  const meses: string[] = []
  const porMaterial = new Map<string, FilaMaterial>()
  const m3Ingreso = new Map<string, number>()
  const m3Salida = new Map<string, number>()
  let contenedores = 0

  for (const fila of filas) {
    if (fila.tipo !== 'ingreso' && fila.tipo !== 'salida') { contenedores += 1; continue }

    const mes = claveMes(fila.mes)
    if (!meses.includes(mes)) meses.push(mes)

    const clave = `${fila.material_id}|${fila.unidad_codigo}`
    let material = porMaterial.get(clave)
    if (!material) {
      material = {
        material: fila.material_nombre,
        unidad: fila.unidad_plural ?? fila.unidad_codigo,
        ingreso: new Map(), salida: new Map(),
        totalIngreso: 0, totalSalida: 0,
      }
      porMaterial.set(clave, material)
    }

    const cantidad = aNumero(fila.cantidad) ?? 0
    const m3 = aNumero(fila.equivalente_m3) ?? 0
    if (fila.tipo === 'ingreso') {
      sumar(material.ingreso, mes, cantidad)
      material.totalIngreso += cantidad
      sumar(m3Ingreso, mes, m3)
    } else {
      sumar(material.salida, mes, cantidad)
      material.totalSalida += cantidad
      sumar(m3Salida, mes, m3)
    }
  }

  meses.sort()
  const materiales = [...porMaterial.values()].sort((a, b) =>
    a.material.localeCompare(b.material, 'es-AR') || a.unidad.localeCompare(b.unidad, 'es-AR'))

  const columnas: Columna[] = [
    { titulo: 'Material', ancho: 30 },
    { titulo: 'Unidad', ancho: 14 },
    ...meses.flatMap<Columna>(() => [
      { titulo: 'Ingreso', ancho: 12, formato: DECIMALES, alinear: 'right' },
      { titulo: 'Salida', ancho: 12, formato: DECIMALES, alinear: 'right' },
    ]),
    { titulo: 'Ingreso', ancho: 14, formato: DECIMALES, alinear: 'right' },
    { titulo: 'Salida', ancho: 14, formato: DECIMALES, alinear: 'right' },
  ]

  const libro = nuevoLibro(datos)
  const filaMeses = 5
  const filaTipos = 6
  const primeraDeDatos = 7
  const hoja = libro.addWorksheet('Resumen mensual', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: filaTipos, topLeftCell: `C${primeraDeDatos}` }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  hoja.columns = columnas.map((c) => ({ width: c.ancho }))

  escribirEncabezado(hoja, 'Resumen mensual por material', columnas.length, datos)

  // Fila de meses: cada mes tapa sus dos columnas; Material y Unidad se
  // estiran hacia abajo para que el título se lea una sola vez.
  const cabeceraMeses = hoja.getRow(filaMeses)
  cabeceraMeses.height = 22
  const pintarCabecera = (fila: number, columna: number, texto: string) => {
    const celda = hoja.getRow(fila).getCell(columna)
    celda.value = texto
    celda.font = { bold: true, size: 10, color: { argb: BLANCO } }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    celda.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    celda.border = { bottom: { style: 'thin', color: { argb: AZUL_HONDO } } }
    return celda
  }

  pintarCabecera(filaMeses, 1, 'Material')
  pintarCabecera(filaTipos, 1, '')
  hoja.mergeCells(filaMeses, 1, filaTipos, 1)
  pintarCabecera(filaMeses, 2, 'Unidad')
  pintarCabecera(filaTipos, 2, '')
  hoja.mergeCells(filaMeses, 2, filaTipos, 2)

  meses.forEach((mes, i) => {
    const columna = 3 + i * 2
    pintarCabecera(filaMeses, columna, rotuloMes(mes))
    pintarCabecera(filaMeses, columna + 1, '')
    hoja.mergeCells(filaMeses, columna, filaMeses, columna + 1)
    pintarCabecera(filaTipos, columna, 'Ingreso')
    pintarCabecera(filaTipos, columna + 1, 'Salida')
  })

  const columnaTotal = 3 + meses.length * 2
  pintarCabecera(filaMeses, columnaTotal, 'Total del período')
  pintarCabecera(filaMeses, columnaTotal + 1, '')
  hoja.mergeCells(filaMeses, columnaTotal, filaMeses, columnaTotal + 1)
  pintarCabecera(filaTipos, columnaTotal, 'Ingreso')
  pintarCabecera(filaTipos, columnaTotal + 1, 'Salida')
  hoja.getRow(filaTipos).height = 18

  let numeroFila = filaTipos
  for (const material of materiales) {
    numeroFila += 1
    const valores: Array<string | number | null> = [material.material, material.unidad]
    for (const mes of meses) {
      valores.push(material.ingreso.get(mes) ?? null, material.salida.get(mes) ?? null)
    }
    valores.push(material.totalIngreso || null, material.totalSalida || null)
    hoja.getRow(numeroFila).values = valores
    pintarFilaDeDatos(hoja, numeroFila, columnas, false)
  }

  // Los totales por columna van en m³: sumar kilos con bolsones no daría nada.
  const filaTotales = numeroFila + 1
  const totales: Array<string | number | null> = ['Total equivalente', 'm³']
  let granIngreso = 0
  let granSalida = 0
  for (const mes of meses) {
    const i = m3Ingreso.get(mes) ?? 0
    const s = m3Salida.get(mes) ?? 0
    granIngreso += i
    granSalida += s
    totales.push(i || null, s || null)
  }
  totales.push(granIngreso || null, granSalida || null)
  hoja.getRow(filaTotales).values = totales
  pintarFilaDeDatos(hoja, filaTotales, columnas, false)
  columnas.forEach((_, i) => {
    const celda = hoja.getRow(filaTotales).getCell(i + 1)
    celda.font = { bold: true, color: { argb: TINTA } }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PANEL_2 } }
    celda.border = { top: { style: 'thin', color: { argb: AZUL } } }
  })

  const notas = [
    'Solo movimientos vigentes. El total en m³ suma únicamente los materiales que tienen factor de conversión.',
  ]
  if (!materiales.length) notas.push('No hubo movimientos en el período pedido.')
  if (contenedores) {
    notas.push(
      `${numero(contenedores, 0)} ${contenedores === 1 ? 'registro quedó' : 'registros quedaron'} afuera: ` +
      'son movimientos de contenedor, no ingresos ni salidas de material.',
    )
  }
  escribirPie(hoja, filaTotales + 2, columnas.length, datos, notas)

  return libro
}
