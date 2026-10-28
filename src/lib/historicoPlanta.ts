/**
 * Lectura del R-05 de la Secretaría —«Registros Operativos DINÁMICOS PVRV»—
 * para traer al sistema los ingresos a la Planta que se anotaron antes de que
 * existiera el celular.
 *
 * Como importacion.ts, este módulo no toca la base ni sabe nada de React:
 * recibe el archivo como bytes y devuelve qué filas entran, cuáles no y por
 * qué. Lo escribe la acción.
 *
 * NO HAY MAPEO DE COLUMNAS, a propósito. El R-05 es siempre la misma planilla
 * —la hoja «totalizados TRANSPORTE», que alimenta un formulario de Google— y lo
 * que cambia de un año a otro no es el encabezado sino las filas: el formulario
 * cambió de forma tres veces y la hoja no se enteró. Elegir columnas por
 * encabezado no arregla eso; hay que mirar fila por fila. Las tres formas que
 * se vieron en el archivo de octubre de 2026:
 *
 *   · normal: las columnas dicen lo que dice el encabezado.
 *
 *   · hora agregada: desde el 2 de octubre de 2026 el formulario pregunta la
 *     hora antes que la patente, y todo lo que sigue quedó corrido un lugar a
 *     la derecha. El predio aparece en OBSERVACIONES. Leídas por encabezado,
 *     91 de las 100 filas de octubre se caían.
 *
 *   · tipo corrido: unas noventa filas en papel de 2024, todas del predio
 *     «SOÑADA» (la Huerta), tienen el tipo de residuo una columna más allá, la cantidad en
 *     «pila» y el número de pila en la del vigilador.
 *
 * QUÉ NO HACE, también a propósito:
 *
 *   · No ata viajes a pilas. En 389 filas la columna «pila» repite la cantidad
 *     —«6», «10», «12»— y en otras dice «Solo poda fina» o «S/N». Un viaje de
 *     2024 colgado de la pila 12 de hoy es un dato falso que nadie va a
 *     detectar, porque no da error: se ve bien. Lo que la columna dice se
 *     guarda escrito en las observaciones.
 *
 *   · No inventa entidades ni personas. El origen y quien registró entran como
 *     texto, igual que en el CLI, y el origen se formaliza después desde
 *     Revisiones.
 *
 *   · No adivina predios ni corrientes que no reconoce. Los lista con cuántas
 *     filas tienen, y decide la persona.
 */
import 'server-only'
import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import type { Worksheet } from 'exceljs'
import { esCeldaRota } from './importacion'

// ── Lo que ve la pantalla ───────────────────────────────────────────────

export const HOJA_R05 = 'totalizados TRANSPORTE'

export type Forma = 'normal' | 'hora agregada' | 'tipo corrido'

export interface CatalogoPlanta {
  /** Los predios de la Planta: Vivero y Huerta. */
  predios: Array<{ codigo: string; nombre: string; direccion: string | null }>
  /** Las corrientes que pueden entrar a la Planta. */
  materiales: Array<{ nombre: string }>
}

/**
 * Lo que la persona decidió sobre los valores que el sistema no reconoce:
 * valor crudo → código de predio o nombre de corriente. Viaja como
 * `transformaciones` del mapeo guardado, así que el mes que viene ya viene
 * resuelto.
 */
export interface Resoluciones {
  predios: Record<string, string>
  materiales: Record<string, string>
}

export interface FilaHistorica {
  /** Número de fila en el Excel. */
  fila: number
  /** aaaa-mm-dd */
  fecha: string
  /** hh:mm, cuando la planilla la trae. */
  hora: string | null
  predioCodigo: string
  materialNombre: string
  m3: number
  origen: string
  patente: string | null
  vigilador: string | null
  observaciones: string
  forma: Forma
  /** Qué fila es por lo que dice, para no cargarla dos veces. */
  clave: string
}

export interface Rechazo {
  fila: number
  motivo: string
  dato: string
}

export interface SinResolver {
  valor: string
  veces: number
}

/** Lo que entra en un mes, por predio. */
export interface Mes {
  mes: string
  /** Código de predio → m³ y viajes que entran. */
  predios: Record<string, { m3: number; viajes: number }>
}

/** Lo que la propia planilla dice que entró, según su hoja de indicadores. */
export type Indicadores = Record<string, Record<'huerta' | 'vivero', { m3: number | null; viajes: number | null }>>

export interface Analisis {
  filas: FilaHistorica[]
  rechazos: Rechazo[]
  prediosSinResolver: SinResolver[]
  materialesSinResolver: SinResolver[]
  porMes: Mes[]
  /** Cuántas filas se leyeron de cada forma. */
  formas: Record<Forma, number>
  /** Filas con fecha, entren o no. Es el total contra el que se cuenta todo. */
  filasConDatos: number
  filasVacias: number
  /** Las que tienen fecha fuera del período elegido. No son rechazo. */
  fueraDelPeriodo: number
  /** Cantidades que traían texto además del número: «6 (para un camión chico)». */
  cantidadesConTexto: number
  /** Filas donde «pila» repetía la cantidad y se ignoró. */
  pilaRepetiaCantidad: number
  desde: string | null
  hasta: string | null
  /** El mes más viejo y el más nuevo de todo el archivo, sin recortar. */
  primerMes: string | null
  ultimoMes: string | null
  totalM3: number
}

// ── Normalizar ──────────────────────────────────────────────────────────

/** Sin acentos, sin dobles espacios y en minúsculas, para comparar. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Singular aproximado: alcanza con que «naranjas» y «Naranja» caigan juntas. */
function singular(p: string): string {
  if (p.length >= 6 && p.endsWith('es')) return p.slice(0, -2)
  if (p.length >= 5 && p.endsWith('s')) return p.slice(0, -1)
  return p
}

// ── Leer el libro ───────────────────────────────────────────────────────

/** Una celda del R-05, con lo que hace falta saber de ella. */
interface Celda {
  texto: string
  fecha: Date | null
}

function leerCelda(v: unknown): Celda {
  if (v === null || v === undefined) return { texto: '', fecha: null }
  if (v instanceof Date) return { texto: v.toISOString(), fecha: v }
  if (typeof v === 'object') {
    const o = v as {
      result?: unknown; text?: unknown; error?: unknown
      formula?: unknown; sharedFormula?: unknown
      richText?: Array<{ text: string }>
    }
    if (typeof o.error === 'string') return { texto: o.error, fecha: null }
    if (o.richText) return { texto: o.richText.map((r) => r.text).join('').trim(), fecha: null }
    if (o.result !== undefined && o.result !== null) return leerCelda(o.result)
    if (o.text !== undefined && o.text !== null) return { texto: String(o.text).trim(), fecha: null }
    if (o.formula !== undefined || o.sharedFormula !== undefined) return { texto: '#SIN CALCULAR', fecha: null }
    return { texto: '', fecha: null }
  }
  return { texto: String(v).trim(), fecha: null }
}

export interface FilaCruda {
  numero: number
  /** Celdas 1 a 13, en orden. La 0 queda vacía para poder decir c[5] = columna E. */
  c: Celda[]
}

export interface LibroR05 {
  filas: FilaCruda[]
  indicadores: Indicadores | null
}

/** Más de esto no es un R-05: son unas doscientas filas por mes desde 2024. */
export const TOPE_FILAS_R05 = 40_000

const ANCHO = 13

async function abrir(datos: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook()
  // El mismo casteo que importacion.ts: es por los tipos de Buffer, no por los
  // bytes.
  await libro.xlsx.load(Buffer.from(datos) as unknown as Parameters<typeof libro.xlsx.load>[0])
  return libro
}

/**
 * Abre el libro una vez y devuelve las filas de la hoja de transporte, más los
 * totales de la hoja de indicadores si la encuentra.
 */
export async function leerR05(datos: ArrayBuffer): Promise<LibroR05> {
  const libro = await abrir(datos)
  const hoja = libro.worksheets.find((h) => normalizar(h.name) === normalizar(HOJA_R05))
  if (!hoja) {
    const hay = libro.worksheets.map((h) => `«${h.name}»`).join(', ')
    throw new Error(
      `El archivo no tiene la hoja «${HOJA_R05}», que es donde el R-05 anota los ingresos a la Planta. Tiene: ${hay}.`,
    )
  }

  // Lo único que se le pide al encabezado es que esté: si no dice «Fecha» y
  // «Predio» donde los dice el R-05, éste no es el archivo.
  const encabezado = Array.from({ length: ANCHO + 1 }, (_, i) =>
    i === 0 ? '' : normalizar(leerCelda(hoja.getRow(1).getCell(i).value).texto))
  if (encabezado[2] !== 'fecha' || encabezado[11] !== 'predio') {
    throw new Error(
      `La hoja «${hoja.name}» no tiene el encabezado del R-05: se esperaba «Fecha» en la columna B y «Predio» en la K. Fijate que sea el Excel original de la Secretaría, sin columnas agregadas ni borradas.`,
    )
  }

  let ultima = 0
  hoja.eachRow({ includeEmpty: false }, (_f, n) => { ultima = n })
  if (ultima - 1 > TOPE_FILAS_R05) {
    throw new Error(
      `La hoja «${hoja.name}» tiene ${ultima - 1} filas y de una vez se pueden leer hasta ${TOPE_FILAS_R05}.`,
    )
  }

  const filas: FilaCruda[] = []
  for (let n = 2; n <= ultima; n++) {
    const fila = hoja.getRow(n)
    const c: Celda[] = [{ texto: '', fecha: null }]
    for (let i = 1; i <= ANCHO; i++) c.push(leerCelda(fila.getCell(i).value))
    filas.push({ numero: n, c })
  }

  const hojaIndicadores = libro.worksheets.find((h) => /^indicadores/.test(normalizar(h.name)))
  return { filas, indicadores: hojaIndicadores ? leerIndicadores(hojaIndicadores) : null }
}

// ── La hoja de indicadores ──────────────────────────────────────────────

const MES_CORTO: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12,
}

/** «jul-24», «set 24», «ago-2025» o una fecha: el mes como aaaa-mm. */
function aMesDeIndicador(celda: Celda): string | null {
  if (celda.fecha) return celda.fecha.toISOString().slice(0, 7)
  const m = /^([a-z]{3})[a-z]*[\s\-/.]*(\d{2}|\d{4})$/.exec(normalizar(celda.texto))
  if (!m || !MES_CORTO[m[1]]) return null
  const anio = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])
  return `${anio}-${String(MES_CORTO[m[1]]).padStart(2, '0')}`
}

function aNumeroDeIndicador(celda: Celda): number | null {
  if (!celda.texto || esCeldaRota(celda.texto)) return null
  const n = Number(celda.texto.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Los m³ y los camiones por mes que la Secretaría informa en su propia hoja,
 * para ponerlos al lado de lo que sale de sumar los viajes.
 *
 * Es la única forma de que alguien que conoce los números vea de un vistazo si
 * la importación es fiel. Se busca por rótulo y no por número de fila porque la
 * hoja es a mano y crece; si no se encuentra, la columna no se muestra y nada
 * más.
 */
function leerIndicadores(hoja: Worksheet): Indicadores | null {
  const ancho = Math.min(Math.max(hoja.actualColumnCount, hoja.columnCount), 120)
  const celda = (n: number, i: number) => leerCelda(hoja.getRow(n).getCell(i).value)

  let filaMeses = 0
  let columnas: Array<[col: number, mes: string]> = []
  for (let n = 1; n <= 20 && !filaMeses; n++) {
    const meses: Array<[number, string]> = []
    for (let i = 1; i <= ancho; i++) {
      const mes = aMesDeIndicador(celda(n, i))
      if (mes) meses.push([i, mes])
    }
    if (meses.length >= 6) {
      filaMeses = n
      columnas = meses
    }
  }
  if (!filaMeses) return null

  const rotulo = (n: number) => {
    for (let i = 1; i <= 4; i++) {
      const t = celda(n, i).texto
      if (t && !aMesDeIndicador(celda(n, i))) return normalizar(t)
    }
    return ''
  }

  // El rótulo de los m³ y, debajo, el primer renglón que cuenta camiones.
  const buscar = (patron: RegExp): { m3: number; viajes: number } | null => {
    const ultima = Math.min(hoja.actualRowCount + 5, 200)
    for (let n = filaMeses + 1; n <= ultima; n++) {
      if (!patron.test(rotulo(n))) continue
      for (let k = n + 1; k <= n + 3; k++) {
        if (/camion/.test(rotulo(k))) return { m3: n, viajes: k }
      }
      return { m3: n, viajes: 0 }
    }
    return null
  }
  const huerta = buscar(/volumen ingresado a\s*pvrv/)
  const vivero = buscar(/ingresado para acopio.*vivero/)
  if (!huerta && !vivero) return null

  const salida: Indicadores = {}
  for (const [col, mes] of columnas) {
    const leer = (f: { m3: number; viajes: number } | null) => ({
      m3: f ? aNumeroDeIndicador(celda(f.m3, col)) : null,
      viajes: f && f.viajes ? aNumeroDeIndicador(celda(f.viajes, col)) : null,
    })
    // Si una columna repite el mes —pasa con las que se agregan a mano—, vale
    // la primera.
    if (!salida[mes]) salida[mes] = { huerta: leer(huerta), vivero: leer(vivero) }
  }
  return salida
}

// ── Interpretar cada celda ──────────────────────────────────────────────

/** La fecha de calendario de la celda, como aaaa-mm-dd. */
function aFecha(celda: Celda): string | null {
  if (celda.fecha) {
    const iso = celda.fecha.toISOString().slice(0, 10)
    return iso >= '2000-01-01' ? iso : null
  }
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(celda.texto)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])))
  if (d.getUTCDate() !== Number(m[1])) return null
  return d.toISOString().slice(0, 10)
}

/**
 * La hora, si la celda es una hora y nada más. Excel guarda las horas como un
 * día del 30/12/1899, y exceljs las entrega en UTC con la hora de reloj tal
 * cual se escribió.
 */
function aHora(celda: Celda): string | null {
  if (!celda.fecha) return null
  const iso = celda.fecha.toISOString()
  if (!iso.startsWith('1899-12-30')) return null
  const hhmm = iso.slice(11, 16)
  // La medianoche justa es una celda de hora que quedó vacía, no un viaje a
  // las cero horas.
  return hhmm === '00:00' ? null : hhmm
}

/** Más que esto no lo trae ningún vehículo: la batea, que es lo más grande, son 20. */
const TOPE_M3 = 200

/**
 * Los m³ de la celda de cantidad.
 *
 * Acepta el número solo y también el número con lo que el formulario agregaba
 * al lado —«6 (para un camión chico)», «6m3», «0,10 m3 verdura descarte»—,
 * porque el número está ahí y tirar la fila sería perder un viaje que pasó.
 * Lo que no sea un volumen claro no entra: «1000 kilo de Tarima» está en kilos,
 * «Menos 1m3» no dice cuánto, «Poda media» es la columna equivocada.
 */
function aMetros(bruto: string): { m3: number; conTexto: boolean } | null {
  const s = bruto.trim()
  if (!s || /kg|kilo/i.test(s)) return null
  const m = /^(\d+(?:[.,]\d+)?|\d+\/\d+)\s*(m3|m³|mts?|metros?|metos?|m)?\.?(?=\s|\(|$)(.*)$/i.exec(s)
  if (!m) return null
  let n: number
  if (m[1].includes('/')) {
    const [a, b] = m[1].split('/').map(Number)
    n = b ? a / b : NaN
  } else {
    n = Number(m[1].replace(',', '.'))
  }
  if (!Number.isFinite(n) || n <= 0 || n > TOPE_M3) return null
  // «6m3» no agrega nada que valga la pena guardar; «6 (para un camión chico)» sí.
  return { m3: Math.round(n * 100) / 100, conTexto: Boolean(m[3].trim()) }
}

/** La patente, si lo es. «Carro verde» y «DNI 564» no lo son. */
function aPatente(bruto: string): string | null {
  const s = bruto.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (/^[A-Z]{3}\d{3}$/.test(s)) return s
  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(s)) return s
  return null
}

const SIN_PILA = /^(s\/?n|sn|sin novedad(es)?\.?|-|_)$/i

/** Lo que dice la primera columna, cuando no es la marca del formulario. */
const MARCAS: Record<string, string> = {
  'registro papel': 'Registro en papel',
  'reg viv': 'Registro del Vivero',
  estimado: 'Estimado en la planilla',
}

// ── Resolver predio y corriente ─────────────────────────────────────────

/**
 * Otros nombres con que la planilla llama a un predio. «La Soñada» es como
 * algunos le dicen a la Huerta: lo confirmó la Secretaría el 28/10/2026, y son
 * 124 viajes de julio a octubre de 2024.
 */
const APODOS: Record<string, string> = {
  sonada: 'huerta',
  'la sonada': 'huerta',
}

/**
 * El predio que el valor nombra sin dudas, o null. «Huerta» es el que tiene
 * Huerta en el nombre; si dos lo tuvieran, no es ninguno.
 */
function predioSolo(crudo: string, c: CatalogoPlanta): string | null {
  const normal = normalizar(crudo)
  const v = APODOS[normal] ?? normal
  if (!v) return null
  const candidatos = c.predios.filter((p) => {
    if (normalizar(p.codigo) === v) return true
    const palabras = normalizar(`${p.nombre} ${p.direccion ?? ''}`).split(/[^a-z0-9]+/)
    return palabras.includes(v)
  })
  return candidatos.length === 1 ? candidatos[0].codigo : null
}

/**
 * La corriente que el valor nombra sin dudas. Además del nombre exacto acepta
 * el plural y el nombre sin lo que va entre paréntesis: «Jardineria» es
 * «Jardinería (pasto y hojas)», y «naranjas» es «Naranja».
 */
function materialSolo(crudo: string, c: CatalogoPlanta): string | null {
  const v = normalizar(crudo)
  if (!v) return null
  for (const m of c.materiales) {
    const n = normalizar(m.nombre)
    if (n === v || singular(n) === singular(v)) return m.nombre
    const corto = n.replace(/\s*\(.*\)\s*$/, '')
    if (corto !== n && corto === v) return m.nombre
  }
  return null
}

function resolver(
  crudo: string,
  elegidos: Record<string, string>,
  solo: (v: string) => string | null,
  validos: Set<string>,
): string | null {
  const elegido = elegidos[crudo] ?? elegidos[normalizar(crudo)]
  if (elegido !== undefined) return validos.has(elegido) ? elegido : null
  return solo(crudo)
}

/** El predio de la Planta que se llama así. Sirve para atar los indicadores de la planilla a un predio. */
export function predioPorNombre(nombre: 'huerta' | 'vivero', c: CatalogoPlanta): string | null {
  return predioSolo(nombre, c)
}

// ── El análisis ─────────────────────────────────────────────────────────

/** Las columnas de cada campo según la forma de la fila. */
interface Posiciones {
  hora: number
  patente: number
  origen: number
  tipo: number
  cantidad: number
  pila: number
  vigilador: number
  predio: number
  observaciones: number
}

const POSICIONES: Record<Forma, Posiciones> = {
  normal: { hora: 5, patente: 5, origen: 6, tipo: 7, cantidad: 8, pila: 9, vigilador: 10, predio: 11, observaciones: 12 },
  'hora agregada': { hora: 5, patente: 6, origen: 7, tipo: 8, cantidad: 9, pila: 10, vigilador: 11, predio: 12, observaciones: 0 },
  'tipo corrido': { hora: 5, patente: 5, origen: 6, tipo: 8, cantidad: 9, pila: 10, vigilador: 0, predio: 11, observaciones: 12 },
}

const PREDIO_CONOCIDO = /^(huerta|vivero)$/

/**
 * De qué forma es la fila. Se decide por dónde está el predio y por dónde está
 * el tipo de residuo, que son las dos cosas que no se confunden con nada.
 */
function formaDe(c: Celda[], catalogo: CatalogoPlanta): Forma {
  const predio11 = normalizar(c[11].texto)
  const predio12 = normalizar(c[12].texto)
  if (!PREDIO_CONOCIDO.test(predio11) && PREDIO_CONOCIDO.test(predio12)) return 'hora agregada'
  if (!c[7].texto && materialSolo(c[8].texto, catalogo) && aMetros(c[9].texto)) return 'tipo corrido'
  return 'normal'
}

function vacia(c: Celda[]): boolean {
  // La 3 y la 4 son Mes y Año, que la hoja calcula con una fórmula y en las
  // filas vacías dan 1 y 1900.
  return c.every((x, i) => i === 3 || i === 4 || !x.texto)
}

/**
 * Lee todas las filas, las interpreta y las resuelve.
 *
 * `periodo` recorta por fecha: lo de afuera no es un rechazo, sólo no se
 * importa esta vez. `hoy` deja afuera lo que todavía no pasó.
 */
export function analizarR05(
  libro: LibroR05,
  resoluciones: Resoluciones,
  catalogo: CatalogoPlanta,
  periodo: { desde: string | null; hasta: string | null },
  hoy: string,
  archivoNombre: string,
): Analisis {
  const prediosValidos = new Set(catalogo.predios.map((p) => p.codigo))
  const materialesValidos = new Set(catalogo.materiales.map((m) => m.nombre))

  const filas: FilaHistorica[] = []
  const rechazos: Rechazo[] = []
  const prediosFlojos = new Map<string, number>()
  const materialesFlojos = new Map<string, number>()
  const formas: Record<Forma, number> = { normal: 0, 'hora agregada': 0, 'tipo corrido': 0 }
  const ocurrencias = new Map<string, number>()
  const meses = new Map<string, Mes>()

  let filasConDatos = 0
  let filasVacias = 0
  let fueraDelPeriodo = 0
  let cantidadesConTexto = 0
  let pilaRepetiaCantidad = 0
  let primerMes: string | null = null
  let ultimoMes: string | null = null
  let desde: string | null = null
  let hasta: string | null = null
  let totalM3 = 0

  for (const { numero: fila, c } of libro.filas) {
    if (vacia(c)) {
      filasVacias++
      continue
    }
    filasConDatos++

    const fecha = aFecha(c[2])
    if (!fecha) {
      rechazos.push({ fila, motivo: c[2].texto ? 'fecha ilegible' : 'sin fecha', dato: c[2].texto })
      continue
    }
    const mesDeLaFila = fecha.slice(0, 7)
    if (!primerMes || mesDeLaFila < primerMes) primerMes = mesDeLaFila
    if (!ultimoMes || mesDeLaFila > ultimoMes) ultimoMes = mesDeLaFila

    if (fecha > hoy) {
      rechazos.push({ fila, motivo: 'fecha futura', dato: fecha })
      continue
    }

    const forma = formaDe(c, catalogo)
    const p = POSICIONES[forma]
    const celda = (i: number) => (i ? c[i].texto : '')

    // La clave se calcula antes de recortar por período y con lo crudo, no con
    // lo resuelto: así la misma fila da la misma clave aunque cambie el período
    // elegido o lo que se decidió sobre su predio.
    const identidad = [
      fecha, aHora(c[p.hora]) ?? '', c[1].texto,
      ...[p.patente, p.origen, p.tipo, p.cantidad, p.vigilador, p.predio].map((i) => normalizar(celda(i))),
    ].join('|')
    const vez = (ocurrencias.get(identidad) ?? 0) + 1
    ocurrencias.set(identidad, vez)

    if ((periodo.desde && fecha < periodo.desde) || (periodo.hasta && fecha > periodo.hasta)) {
      fueraDelPeriodo++
      continue
    }

    const predioCrudo = celda(p.predio)
    const predioCodigo = resolver(predioCrudo, resoluciones.predios, (v) => predioSolo(v, catalogo), prediosValidos)
    if (!predioCodigo) {
      if (predioCrudo) prediosFlojos.set(predioCrudo, (prediosFlojos.get(predioCrudo) ?? 0) + 1)
      rechazos.push({ fila, motivo: predioCrudo ? 'predio sin resolver' : 'sin predio', dato: predioCrudo })
      continue
    }

    const tipoCrudo = celda(p.tipo)
    const materialNombre = resolver(tipoCrudo, resoluciones.materiales, (v) => materialSolo(v, catalogo), materialesValidos)
    if (!materialNombre) {
      if (tipoCrudo) materialesFlojos.set(tipoCrudo, (materialesFlojos.get(tipoCrudo) ?? 0) + 1)
      rechazos.push({ fila, motivo: tipoCrudo ? 'tipo de residuo sin resolver' : 'sin tipo de residuo', dato: tipoCrudo })
      continue
    }

    const cantidadCruda = celda(p.cantidad)
    if (esCeldaRota(cantidadCruda)) {
      rechazos.push({ fila, motivo: 'la celda de cantidad está rota en el Excel', dato: cantidadCruda })
      continue
    }
    const metros = aMetros(cantidadCruda)
    if (!metros) {
      rechazos.push({ fila, motivo: cantidadCruda ? 'cantidad ilegible' : 'sin cantidad', dato: cantidadCruda })
      continue
    }
    if (metros.conTexto) cantidadesConTexto++

    // Lo que la planilla dice y el modelo no tiene dónde guardar queda
    // escrito: la patente que no es patente, la pila que no se ata, la
    // cantidad tal cual se anotó.
    const notas: string[] = []
    const observacion = celda(p.observaciones)
    if (observacion) notas.push(observacion)
    const marca = MARCAS[normalizar(c[1].texto)]
    if (marca) notas.push(marca)

    // En las filas de 2024 la columna «Patente» trae la hora: una fecha nunca es
    // una patente, y la hora ya se tomó arriba.
    const patenteCruda = c[p.patente].fecha ? '' : celda(p.patente)
    const patente = aPatente(patenteCruda)
    if (patenteCruda && !patente) notas.push(`Transporte: ${patenteCruda}`)

    const pila = celda(p.pila)
    if (pila && pila === cantidadCruda) pilaRepetiaCantidad++
    else if (pila && !SIN_PILA.test(pila) && normalizar(pila) !== 'acopio') notas.push(`Pila anotada: ${pila}`)

    if (metros.conTexto) notas.push(`Cantidad anotada: ${cantidadCruda}`)

    let vigilador: string | null = celda(p.vigilador) || null
    if (vigilador && normalizar(vigilador) === 'acopio') {
      notas.push('Acopio')
      vigilador = null
    }
    // El nombre va a `registrado_por`, pero hoy ninguna pantalla muestra esa
    // columna: escrito acá, quien abre el viaje ve quién lo anotó.
    if (vigilador) notas.push(`Registró: ${vigilador}`)
    notas.push(`Importado de ${archivoNombre}, fila ${fila}`)

    formas[forma]++
    const clave = `r05:${createHash('sha256').update(`${identidad}#${vez}`).digest('hex').slice(0, 32)}`

    filas.push({
      fila,
      fecha,
      hora: aHora(c[p.hora]),
      predioCodigo,
      materialNombre,
      m3: metros.m3,
      origen: celda(p.origen) || 'Sin origen anotado',
      patente,
      vigilador,
      observaciones: notas.join(' · '),
      forma,
      clave,
    })

    const mes = meses.get(mesDeLaFila) ?? { mes: mesDeLaFila, predios: {} }
    const acumulado = mes.predios[predioCodigo] ?? { m3: 0, viajes: 0 }
    acumulado.m3 += metros.m3
    acumulado.viajes += 1
    mes.predios[predioCodigo] = acumulado
    meses.set(mesDeLaFila, mes)

    totalM3 += metros.m3
    if (!desde || fecha < desde) desde = fecha
    if (!hasta || fecha > hasta) hasta = fecha
  }

  // Los m³ se suman de a uno y se redondean al final, como los kilos de la
  // otra importación: así el total de la pantalla da con el de la base.
  for (const mes of meses.values()) {
    for (const r of Object.values(mes.predios)) r.m3 = Math.round(r.m3 * 100) / 100
  }

  const aLista = (m: Map<string, number>): SinResolver[] =>
    [...m.entries()]
      .map(([valor, veces]) => ({ valor, veces }))
      .sort((a, b) => b.veces - a.veces || a.valor.localeCompare(b.valor, 'es'))

  return {
    filas,
    rechazos,
    prediosSinResolver: aLista(prediosFlojos),
    materialesSinResolver: aLista(materialesFlojos),
    porMes: [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes)),
    formas,
    filasConDatos,
    filasVacias,
    fueraDelPeriodo,
    cantidadesConTexto,
    pilaRepetiaCantidad,
    desde,
    hasta,
    primerMes,
    ultimoMes,
    totalM3: Math.round(totalM3 * 100) / 100,
  }
}
