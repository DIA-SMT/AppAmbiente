/**
 * Lectura y mapeo del Excel de pesos que manda la planta externa de la 9 de
 * Julio, para cruzarlo contra lo que cada punto verde registró por su cuenta.
 *
 * Este módulo no toca la base y no sabe nada de React: recibe el archivo como
 * bytes, devuelve qué filas entran, cuáles no y por qué. Lo escribe otro: acá
 * sólo se decide. Esa separación es a propósito —es lo único de la importación
 * que se puede razonar sin una conexión abierta ni una pantalla montada—.
 *
 * DOS COSAS QUE NO HACE, a propósito:
 *
 *   · No inventa. Cuando el domicilio del remito no cae solo en ningún punto
 *     verde, la fila queda afuera y el valor va a `sitiosSinResolver` con la
 *     sugerencia más parecida, para que la persona elija en la pantalla. Meter
 *     los kilos en el punto equivocado ensucia justo el número que la
 *     importación viene a controlar.
 *
 *   · No pierde la fila por no tener kilos. El archivo de agosto trae 41 filas
 *     sin peso sobre 287, y descartarlas sería tirar el dato de cuántos
 *     contenedores se retiraron ese día de ese punto. Entran con `pesoKg` 0 y
 *     se cuentan aparte en `filasSinPeso`. Un 0 que vino de una celda vacía se
 *     distingue después de un 0 real mirando `cruda`, que viaja entera a
 *     `pesos_externos.fila_origen`.
 *
 *     Ojo con el parecido: una celda vacía no es lo mismo que una celda rota
 *     (#REF!, #N/A) ni que una fórmula que el libro trae sin calcular. Esas
 *     salen por `esCeldaRota()` y son rechazo con número de fila, porque un 0
 *     que vino de un error escondido adentro de las 41 legítimas no lo
 *     encuentra nadie nunca más.
 */
import 'server-only'
import { createHash } from 'node:crypto'
// exceljs es CommonJS y reexporta desde otro archivo, así que los imports con
// nombre no se ven desde ESM. El import por defecto funciona en los dos lados.
import ExcelJS from 'exceljs'
import type { Worksheet } from 'exceljs'

// ── Lo que ve la pantalla ───────────────────────────────────────────────

export interface HojaDelLibro {
  nombre: string
  filas: number
}

/**
 * Una fila de la muestra del paso 2, con su número de fila puesto.
 *
 * El número viaja con la fila y no se reconstruye por índice del lado del
 * cliente: la muestra saltea las filas en blanco, así que `filaEncabezado + 1 +
 * i` rotula mal apenas el archivo tenga un hueco arriba. Y el paso 2 existe
 * justamente para que alguien abra el Excel en esa fila y verifique; rotularla
 * mal es peor que no numerarla.
 */
export interface FilaDeMuestra {
  fila: number
  valores: Record<string, string>
}

export interface Vistazo {
  /** Todas las hojas del libro, para el select del paso 2. */
  hojas: HojaDelLibro[]
  hoja: string
  /** 1-based, como las numera Excel: lo que se dice en pantalla se busca igual. */
  filaEncabezado: number
  columnas: string[]
  muestra: FilaDeMuestra[]
  /**
   * Filas con algo debajo del encabezado. No cuenta las totalmente en blanco
   * —ésas están en `Analisis.filasVacias`— y no descuenta las que se saltean.
   */
  totalFilas: number
}

export interface Mapeo {
  columnas: {
    fecha: string
    sitio: string
    material?: string
    peso: string
    contenedores?: string
    remito?: string
    destino?: string
  }
  transformaciones: {
    /** Valor crudo normalizado → código de sitio. */
    sitios?: Record<string, string>
    /** Valor crudo normalizado → nombre de material. */
    materiales?: Record<string, string>
    /** Valores de cualquier columna que descartan la fila entera ("TOTAL"). */
    saltear?: string[]
    /**
     * Aceptar también las filas cuya fecha cae fuera del mes que domina el
     * archivo. Apagado, el filtro de mes deja afuera un retiro real del 31 de
     * julio que la planta facturó en el archivo de agosto, y no hay forma de
     * meterlo sin editar el archivo —justo lo que la pantalla promete que no
     * hace falta—. Prendido, esas filas entran con su fecha verdadera.
     */
    aceptarOtrosMeses?: boolean
  }
}

export interface FilaMapeada {
  /** Número de fila en el Excel, para que se pueda buscar en la planilla. */
  fila: number
  /** aaaa-mm-dd */
  fecha: string
  sitioCodigo: string
  materialNombre: string | null
  pesoKg: number
  contenedores: number | null
  /** "PV-06 · RSU" cuando se conocen punto y corriente. */
  contenedorCodigo: string | null
  /** La fila entera, tal cual vino, para `fila_origen`. */
  cruda: Record<string, string>
}

export interface Rechazo {
  fila: number
  motivo: string
  dato: string
}

export interface SinResolver {
  valor: string
  veces: number
  sugerencia: string | null
}

export interface Analisis {
  filas: FilaMapeada[]
  rechazos: Rechazo[]
  sitiosSinResolver: SinResolver[]
  materialesSinResolver: SinResolver[]
  desde: string | null
  hasta: string | null
  totalKg: number
  /**
   * Filas que entraron con `pesoKg` 0 porque la celda de kilos venía vacía. No
   * son un rechazo —el contenedor se retiró igual—, pero tampoco son un cero
   * real, así que se cuentan aparte para poder decirlo en pantalla.
   */
  filasSinPeso: number
  /**
   * Filas descartadas por caer en `saltear`: la de TOTAL al pie, que es lo que
   * «salteada» quiere decir en pantalla. Se cuentan para que la aritmética
   * cierre a la vista:
   * `Vistazo.totalFilas === filas.length + rechazos.length + filasSalteadas`.
   */
  filasSalteadas: number
  /**
   * Filas totalmente en blanco. Van aparte de `filasSalteadas` porque
   * `Vistazo.totalFilas` tampoco las cuenta: sumarlas a las salteadas rompía la
   * identidad de arriba apenas el Excel trajera un hueco en el medio.
   */
  filasVacias: number
  /** El mes que domina el archivo (aaaa-mm), o null si no hay uno solo. */
  mesDelArchivo: string | null
  /**
   * Filas con fecha fuera de `mesDelArchivo`. Son rechazo salvo que el mapeo
   * diga `aceptarOtrosMeses`; se cuentan siempre para poder ofrecerlo.
   */
  filasDeOtroMes: number
}

/** Lo que entra por cada punto verde, para la tabla del paso 4. */
export interface ResumenDeSitio {
  codigo: string
  filas: number
  kg: number
  contenedores: number
  /** Cuántas de esas filas entran con peso 0 porque el archivo no lo informó. */
  enCero: number
}

export interface Catalogo {
  sitios: Array<{ codigo: string; nombre: string; direccion: string | null }>
  materiales: Array<{ nombre: string }>
}

// ── Normalizar para comparar ────────────────────────────────────────────

/**
 * Sin acentos, sin dobles espacios y en minúsculas, para comparar.
 *
 * Además empareja el ordinal con el grado. "REMITO Nº" y "REMITO N°" se ven
 * iguales en pantalla pero son dos caracteres distintos, y quien rehace la
 * planilla en otra máquina escribe el que le sale: sin esto, un mapeo guardado
 * en agosto no encuentra su columna en septiembre.
 */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[º°]/g, 'o')
    .replace(/ª/g, 'a')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Las palabras que no distinguen una dirección de otra. "AV DE CIRCUNVALACION"
 * y "Circunvalación" son el mismo lugar, y "LAMADRID 3800" y "Lamadrid 3900"
 * también: la altura que anota el remito es dónde paró el camión, no dónde está
 * el punto verde, así que los números de altura se van con el resto.
 */
const RELLENO = new Set([
  'av', 'avda', 'avenida', 'calle', 'pje', 'pasaje', 'esq', 'esquina',
  'y', 'e', 'de', 'del', 'la', 'las', 'el', 'los', 'n', 'nro', 'no', 's',
])

/** Las palabras que vale la pena comparar, ya normalizadas. */
function enPalabras(s: string): string[] {
  const todas = normalizar(s).split(/[^a-z0-9]+/).filter(Boolean)
  const utiles = todas.filter((p) => !RELLENO.has(p) && !/^\d+$/.test(p))
  // "AV DE LOS ..." podría quedar en nada; antes que comparar contra un conjunto
  // vacío —que da parecido con cualquier cosa— se comparan las palabras crudas.
  return utiles.length ? utiles : todas
}

/**
 * Singular aproximado, sólo para comparar palabras entre sí. No pretende ser
 * gramática: alcanza con que "NEUMATICOS" y "Neumáticos" caigan en lo mismo.
 */
function singular(p: string): string {
  if (p.length >= 6 && p.endsWith('es')) return p.slice(0, -2)
  if (p.length >= 5 && p.endsWith('s')) return p.slice(0, -1)
  return p
}

/** Distancia de edición, cortada en `techo` para no recorrer de más. */
function distancia(a: string, b: string, techo: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > techo) return techo + 1
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const actual = [i]
    let minima = i
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1
      const valor = Math.min(actual[j - 1] + 1, previa[j] + 1, previa[j - 1] + costo)
      actual.push(valor)
      if (valor < minima) minima = valor
    }
    if (minima > techo) return techo + 1
    previa = actual
  }
  return previa[b.length]
}

/**
 * Si dos palabras son la misma escrita distinto. Tolera una letra de diferencia
 * recién desde cinco caracteres: "Garcilaso" del remito y "Garcilazo" de la base
 * son el mismo punto, pero "sur" y "sud" pueden no serlo.
 */
function mismaPalabra(a: string, b: string): boolean {
  const x = singular(a)
  const y = singular(b)
  if (x === y) return true
  return x.length >= 5 && y.length >= 5 && distancia(x, y, 1) <= 1
}

interface Parecido {
  /** Qué parte del valor del Excel explica el candidato. Manda para decidir. */
  cobertura: number
  /** Cuánto se parecen los dos en conjunto. Sólo desempata. */
  dice: number
}

const NADA: Parecido = { cobertura: 0, dice: 0 }

function parecido(crudo: string[], candidato: string): Parecido {
  const suyas = enPalabras(candidato)
  if (!crudo.length || !suyas.length) return NADA
  let aciertos = 0
  for (const p of crudo) if (suyas.some((q) => mismaPalabra(p, q))) aciertos++
  if (!aciertos) return NADA
  return {
    cobertura: aciertos / crudo.length,
    dice: (2 * aciertos) / (crudo.length + suyas.length),
  }
}

function mejorQue(a: Parecido, b: Parecido): boolean {
  if (a.cobertura !== b.cobertura) return a.cobertura > b.cobertura
  return a.dice > b.dice
}

/**
 * El candidato que mejor explica el valor crudo, o null.
 *
 * Pide dos cosas para dar por bueno un parecido automático: que el candidato
 * explique al menos la mitad del valor del Excel, y que le saque ventaja al
 * segundo. Si dos puntos verdes empatan, no elige ninguno —elegir a ojo entre
 * dos es exactamente lo que la pantalla le pregunta a la persona—.
 */
function elegir<T>(
  crudo: string, candidatos: T[], textos: (x: T) => string[],
): { elegido: T | null; sugerencia: T | null } {
  const palabras = enPalabras(crudo)
  const exacto = normalizar(crudo)
  if (!exacto) return { elegido: null, sugerencia: null }

  let mejor: T | null = null
  let marca = NADA
  let segunda = NADA

  for (const c of candidatos) {
    // Escrito igual es igual, sin más vueltas: alcanza con que alguien haya
    // pegado el código o el nombre tal cual está en la base.
    if (textos(c).some((t) => t && normalizar(t) === exacto)) {
      return { elegido: c, sugerencia: c }
    }
    let suyo = NADA
    for (const t of textos(c)) {
      const p = parecido(palabras, t)
      if (mejorQue(p, suyo)) suyo = p
    }
    if (mejorQue(suyo, marca)) {
      segunda = marca
      marca = suyo
      mejor = c
    } else if (mejorQue(suyo, segunda)) {
      segunda = suyo
    }
  }

  if (!mejor || marca.cobertura === 0) return { elegido: null, sugerencia: null }
  const seguro = marca.cobertura >= 0.5 && mejorQue(marca, segunda)
  return { elegido: seguro ? mejor : null, sugerencia: mejor }
}

// ── Leer el libro ───────────────────────────────────────────────────────

/**
 * Una fórmula que el libro trae sin resultado guardado. No es una celda vacía
 * y no puede pasar por una: hay herramientas que exportan .xlsx sin cachear
 * ningún resultado, y un libro así entraría entero con 0 kg sin más síntoma
 * que un total bajo.
 */
export const CELDA_SIN_CALCULAR = '#SIN CALCULAR'

/**
 * Si el texto de una celda es en realidad un error del Excel.
 *
 * Todos los códigos de error empiezan con almohadilla —#REF!, #N/A, #¡VALOR!,
 * #DIV/0!— y CELDA_SIN_CALCULAR también, a propósito: así una sola pregunta
 * alcanza para los dos casos.
 */
export function esCeldaRota(bruto: string): boolean {
  return bruto.trim().startsWith('#')
}

/**
 * El texto de una celda, venga como venga.
 *
 * La celda rota vuelve con su código y no como cadena vacía. En la columna de
 * kilos la diferencia es todo: vacía significa «se retiró el contenedor y no
 * lo pesaron» y entra con 0, mientras que #REF! significa «acá había un número
 * y se rompió». Si las dos llegaran igual, la segunda se guardaría como un 0
 * bueno y `fila_origen` —que la 0008 promete que es «la fila cruda, tal cual
 * vino»— dejaría de serlo justo en la celda que importa.
 */
function texto(v: unknown): string {
  if (v === null || v === undefined) return ''
  // Primero Date, que también es object y si no caería en la rama de abajo.
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as {
      result?: unknown; text?: unknown; error?: unknown
      formula?: unknown; sharedFormula?: unknown
      richText?: Array<{ text: string }>
    }
    if (typeof o.error === 'string') return o.error
    if (o.richText) return o.richText.map((r) => r.text).join('').trim()
    if (o.result instanceof Date) return o.result.toISOString().slice(0, 10)
    // Una fórmula que dio error trae el código adentro del resultado.
    if (o.result !== null && typeof o.result === 'object') {
      const error = (o.result as { error?: unknown }).error
      if (typeof error === 'string') return error
    }
    if (o.result !== undefined && o.result !== null) return String(o.result).trim()
    if (o.text !== undefined && o.text !== null) return String(o.text).trim()
    if (o.formula !== undefined || o.sharedFormula !== undefined) return CELDA_SIN_CALCULAR
    return ''
  }
  return String(v).trim()
}

async function abrir(datos: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook()
  // El CLI lee con readFile() porque tiene una ruta; acá el archivo llega por
  // el formulario y nunca toca el disco.
  //
  // El casteo es por los tipos, no por los bytes: exceljs declara su propio
  // Buffer y no cierra contra el de @types/node 22. El valor que recibe es el
  // que espera.
  await libro.xlsx.load(Buffer.from(datos) as unknown as Parameters<typeof libro.xlsx.load>[0])
  if (!libro.worksheets.length) throw new Error('El archivo no tiene ninguna hoja.')
  return libro
}

/** La última fila con algo. `rowCount` miente cuando el libro trae estilos sueltos. */
function ultimaFila(hojaExcel: Worksheet): number {
  let ultima = 0
  hojaExcel.eachRow({ includeEmpty: false }, (_fila, n) => { ultima = n })
  return ultima
}

function celdas(hojaExcel: Worksheet, n: number, ancho: number): string[] {
  const fila = hojaExcel.getRow(n)
  const valores: string[] = []
  for (let i = 1; i <= ancho; i++) valores.push(texto(fila.getCell(i).value))
  return valores
}

/**
 * Cuál es la fila de los encabezados de verdad.
 *
 * La primera cuyas celdas no vacías sean todas distintas entre sí y sean al
 * menos tres. El archivo de la 9 de Julio abre con un título repetido en las
 * ocho columnas —"RECOLECCION DIFERENCIADA…"—, que es exactamente lo que este
 * criterio deja pasar de largo para quedarse con la fila 2.
 */
function adivinarEncabezado(hojaExcel: Worksheet, ancho: number, hasta: number): number {
  const tope = Math.min(hasta, 20)
  for (let n = 1; n <= tope; n++) {
    const valores = celdas(hojaExcel, n, ancho).filter(Boolean)
    if (valores.length < 3) continue
    const distintas = new Set(valores.map((v) => normalizar(v)))
    if (distintas.size === valores.length) return n
  }
  return 1
}

/**
 * Los nombres de columna, uno por columna y sin repetir.
 *
 * Las filas viajan como objetos con el encabezado de clave, así que dos
 * columnas con el mismo título se pisarían y una desaparecería sin aviso. Una
 * columna sin título tampoco se puede elegir en el select del paso 3. Por eso
 * el título vacío pasa a "Columna N" y el repetido lleva sufijo; las últimas
 * columnas sin título se descartan, que es el ruido habitual de un Excel con
 * bordes de más a la derecha.
 */
function nombresDeColumna(hojaExcel: Worksheet, filaEncabezado: number, ancho: number): string[] {
  const crudos = celdas(hojaExcel, filaEncabezado, ancho)
  while (crudos.length && !crudos[crudos.length - 1]) crudos.pop()

  const usados = new Set<string>()
  return crudos.map((bruto, i) => {
    const base = bruto || `Columna ${i + 1}`
    let nombre = base
    let vuelta = 2
    while (usados.has(normalizar(nombre))) nombre = `${base} (${vuelta++})`
    usados.add(normalizar(nombre))
    return nombre
  })
}

function filaVacia(r: Record<string, string>): boolean {
  return Object.values(r).every((v) => !v)
}

export interface Hoja {
  vistazo: Vistazo
  /**
   * Una entrada por cada fila del Excel desde la siguiente al encabezado,
   * incluidas las vacías. Se ven de más a propósito: así el índice del arreglo
   * alcanza para reconstruir el número de fila real —`filaEncabezado + 1 +
   * índice`— y el rechazo que se muestra en pantalla se puede buscar en la
   * planilla sin contar filas con el dedo.
   */
  filas: Array<Record<string, string>>
}

/**
 * Abre el libro una sola vez y devuelve las dos cosas que hacen falta: lo
 * suficiente para que la persona confirme que se está leyendo la hoja
 * correcta, y todas las filas ya leídas.
 *
 * Una sola apertura y no dos. Antes previsualizar() llamaba a un lector para la
 * vista y a otro para las filas, o sea que parseaba el mismo archivo dos veces
 * en la misma llamada: cuatro segundos y medio de más por vuelta, y el doble de
 * memoria en el peor momento.
 *
 * `topeFilas` corta por cantidad de filas antes de armar una sola en memoria.
 * El tamaño en bytes no alcanza como defensa —un .xlsx comprime demasiado
 * bien— y el proceso que se queda sin memoria no devuelve un error: se muere.
 */
export async function leerHoja(
  datos: ArrayBuffer,
  hoja?: string | null,
  filaEncabezado?: number | null,
  topeFilas?: number | null,
): Promise<Hoja> {
  const libro = await abrir(datos)
  const hojas = libro.worksheets.map((h) => ({ nombre: h.name, filas: h.actualRowCount }))

  const elegida = hoja
    ? libro.worksheets.find((h) => normalizar(h.name) === normalizar(hoja))
    : libro.worksheets[0]
  if (!elegida) {
    throw new Error(
      `El archivo no tiene la hoja «${hoja}». Tiene: ${hojas.map((h) => `«${h.nombre}»`).join(', ')}.`,
    )
  }

  const ancho = Math.max(elegida.columnCount, elegida.actualColumnCount, 1)
  const ultima = ultimaFila(elegida)
  const encabezado = filaEncabezado && filaEncabezado >= 1
    ? Math.min(filaEncabezado, Math.max(ultima, 1))
    : adivinarEncabezado(elegida, ancho, ultima)

  if (topeFilas && ultima - encabezado > topeFilas) {
    throw new Error(
      `La hoja «${elegida.name}» tiene ${ultima - encabezado} filas debajo del encabezado y de `
      + `una vez se pueden leer hasta ${topeFilas}. La planta manda unas 300 por mes: si el `
      + 'archivo trae más de tres años juntos, partilo y subí un período por vez.',
    )
  }

  const columnas = nombresDeColumna(elegida, encabezado, ancho)

  const filas: Array<Record<string, string>> = []
  const muestra: FilaDeMuestra[] = []
  let totalFilas = 0
  for (let n = encabezado + 1; n <= ultima; n++) {
    const valores = celdas(elegida, n, columnas.length)
    const registro = Object.fromEntries(columnas.map((c, i) => [c, valores[i] ?? '']))
    filas.push(registro)
    if (filaVacia(registro)) continue
    totalFilas++
    // La muestra lleva su número de fila: es el que alguien va a buscar en el
    // Excel, y reconstruirlo por índice del otro lado lo daría corrido cuando
    // haya un renglón en blanco arriba.
    if (muestra.length < 8) muestra.push({ fila: n, valores: registro })
  }

  return {
    vistazo: { hojas, hoja: elegida.name, filaEncabezado: encabezado, columnas, muestra, totalFilas },
    filas,
  }
}

/** Para `archivo_hash`: sha-256 del contenido, en hexa, primeros 16. */
export function huella(datos: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(datos)).digest('hex').slice(0, 16)
}

// ── Interpretar cada celda ──────────────────────────────────────────────

const MESES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function fechaValida(a: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  const bisiesto = m === 2 && (a % 4 === 0 && (a % 100 !== 0 || a % 400 === 0))
  return d <= (bisiesto ? 29 : m === 2 ? 28 : MESES[m - 1])
}

function armar(a: number, m: number, d: number): string | null {
  if (a < 1900 || a > 2100 || !fechaValida(a, m, d)) return null
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * La fecha como aaaa-mm-dd, o null.
 *
 * Las celdas con formato de fecha ya llegan acá como aaaa-mm-dd, porque
 * `texto()` las corta en UTC —que es el criterio correcto para una fecha de
 * calendario: interpretarla en hora de Tucumán la correría al día anterior—.
 * Las otras dos formas son por si el mes que viene la planta exporta distinto:
 * dd/mm/aaaa escrito a mano, y el serial de Excel cuando la columna perdió el
 * formato. El año de cuatro dígitos no se negocia: "23/08/20265" es un error de
 * tipeo y tiene que salir por pantalla con el número de fila, no colarse como
 * el año 20265 ni corregirse a ojo.
 */
function aFecha(bruto: string): string | null {
  const s = bruto.trim()
  if (!s) return null

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]|$)/.exec(s)
  if (iso) return armar(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const criollo = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s)
  if (criollo) return armar(Number(criollo[3]), Number(criollo[2]), Number(criollo[1]))

  // Serial de Excel. El rango arranca en 20000 (1954) para que ningún año
  // suelto escrito en la celda pase por número de serie.
  if (/^\d{5}$/.test(s)) {
    const serie = Number(s)
    if (serie >= 20000 && serie <= 60000) {
      // Excel cuenta desde el 31/12/1899 y arrastra el 29/02/1900 que no existió.
      const ms = Date.UTC(1899, 11, 30) + (serie - (serie >= 60 ? 1 : 0) + 1) * 86400000
      return new Date(ms).toISOString().slice(0, 10)
    }
  }
  return null
}

/**
 * Más kilos de los que puede traer un viaje.
 *
 * El tope no lo pone la base —`peso_kg` es numeric(12,2) y aguanta diez mil
 * millones— sino el mundo: un camión de contenedores no trae mil toneladas. Sin
 * techo, un dedo de más en una celda pasa la previsualización como fila buena,
 * infla el total del mes y recién revienta al confirmar con un «numeric field
 * overflow» que no dice qué fila es. Acá sí se sabe cuál es.
 */
export const TOPE_PESO_KG = 1_000_000

/**
 * Los kilos. Devuelve null cuando no hay con qué convertir y 0 cuando la celda
 * viene vacía, que no es lo mismo: lo primero es un rechazo y lo segundo no.
 *
 * Con punto y coma juntos manda el último como separador decimal, que es lo que
 * hace Excel en cualquier configuración regional. Con punto solo hay que
 * decidir: "3.800" es tres mil ochocientos y no tres kilos con ocho, porque
 * agrupado de a tres es miles. Un neto nunca viene con un decimal en esa forma.
 */
function aPeso(bruto: string): number | null {
  const s = bruto.replace(/\s/g, '').replace(/kg\.?$/i, '')
  if (!s) return 0

  let limpio = s
  const coma = s.lastIndexOf(',')
  const punto = s.lastIndexOf('.')
  if (coma >= 0 && punto >= 0) {
    const decimal = Math.max(coma, punto)
    limpio = s.slice(0, decimal).replace(/[.,]/g, '') + '.' + s.slice(decimal + 1)
  } else if (coma >= 0) {
    limpio = s.replace(/,/g, '.')
  } else if (punto >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    limpio = s.replace(/\./g, '')
  }

  if (!/^-?\d+(\.\d+)?$/.test(limpio)) return null
  const n = Number(limpio)
  if (!Number.isFinite(n)) return null
  // `pesos_externos.peso_kg` es numeric(12,2): más decimales los redondearía la
  // base en silencio, y el total de la pantalla no daría con el de la base.
  return Math.round(n * 100) / 100
}

/** Un conteo chico y entero, como los contenedores del remito. */
function aEntero(bruto: string): number | null {
  const s = bruto.trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null
  return n
}

// ── Qué columna es cuál ─────────────────────────────────────────────────

type Campo = keyof Mapeo['columnas']

/**
 * Cómo se llama cada campo en las planillas que se vieron hasta ahora. Sirve
 * sólo para la primera vez: apenas la persona confirma el mapeo, el nombre
 * queda guardado en `mapeos_importacion` y esto no se usa más.
 */
const SINONIMOS: Record<Campo, string[]> = {
  fecha: ['fecha', 'fecha retiro', 'fecha de retiro', 'dia'],
  sitio: ['domicilio', 'punto verde', 'punto', 'direccion', 'lugar'],
  material: ['tipo de residuo', 'tipo de residuos', 'residuo', 'material', 'corriente', 'tipo'],
  peso: ['kilos neto', 'kilos netos', 'kg neto', 'peso neto', 'kilos', 'peso', 'neto'],
  contenedores: ['tot de cont', 'total de contenedores', 'contenedores', 'cant de cont', 'cont'],
  remito: ['remito', 'nro remito', 'numero de remito'],
  destino: ['destino', 'planta destino'],
}

const ORDEN: Campo[] = ['fecha', 'sitio', 'material', 'peso', 'contenedores', 'remito', 'destino']
const OBLIGATORIAS: Campo[] = ['fecha', 'sitio', 'peso']

/**
 * De nombre de campo a nombre de columna real de esta hoja.
 *
 * El mapeo guardado nombra la columna por su título. Si el título cambió de una
 * exportación a la otra —un espacio de más, "Nº" por "N°"— se busca igual
 * normalizando, que es lo que evita rehacer el mapeo todos los meses. Si la
 * columna se nombró y no está, corta: seguir mapearía todo contra la nada y la
 * pantalla mostraría 287 rechazos sin decir por qué.
 */
function resolverColumnas(v: Vistazo, m: Mapeo): Record<Campo, string | null> {
  const porNormal = new Map(v.columnas.map((c) => [normalizar(c), c]))
  const salida = {} as Record<Campo, string | null>
  const tomadas = new Set<string>()

  for (const campo of ORDEN) {
    const pedida = (m.columnas?.[campo] ?? '').trim()
    if (pedida) {
      const real = v.columnas.includes(pedida) ? pedida : porNormal.get(normalizar(pedida))
      if (!real) {
        throw new Error(
          `La columna «${pedida}» no está en la hoja «${v.hoja}». Revisá el paso 3.`,
        )
      }
      salida[campo] = real
      tomadas.add(real)
      continue
    }
    salida[campo] = null
  }

  // Lo que la persona todavía no eligió se adivina, para que el paso 3 abra con
  // algo puesto en vez de siete selects en blanco.
  for (const campo of ORDEN) {
    if (salida[campo]) continue
    let hallada: string | null = null
    for (const sinonimo of SINONIMOS[campo]) {
      hallada = v.columnas.find(
        (c) => !tomadas.has(c) && (normalizar(c) === sinonimo || normalizar(c).startsWith(`${sinonimo} `)),
      ) ?? null
      if (hallada) break
    }
    salida[campo] = hallada
    if (hallada) tomadas.add(hallada)
  }

  for (const campo of OBLIGATORIAS) {
    if (!salida[campo]) {
      throw new Error(
        `No se sabe qué columna tiene ${ETIQUETA[campo]}. Elegila en el paso 3.`,
      )
    }
  }
  return salida
}

const ETIQUETA: Record<Campo, string> = {
  fecha: 'la fecha',
  sitio: 'el punto verde',
  material: 'la corriente',
  peso: 'los kilos',
  contenedores: 'los contenedores',
  remito: 'el remito',
  destino: 'el destino',
}

/**
 * Un mapeo de arranque para la primera subida: qué columna parece ser cada
 * campo, mirando nada más que los títulos.
 *
 * No hace falta para analizar —`analizar()` adivina igual lo que el mapeo deja
 * en blanco—, pero sí para que el paso 3 abra con los selects puestos en vez de
 * en blanco. Lo que adivine se corrige ahí mismo y recién se guarda al
 * confirmar.
 */
export function sugerirMapeo(v: Vistazo): Mapeo {
  const enBlanco: Mapeo = { columnas: { fecha: '', sitio: '', peso: '' }, transformaciones: {} }
  let col: Record<Campo, string | null>
  try {
    col = resolverColumnas(v, enBlanco)
  } catch {
    // Si no se reconoce ni lo obligatorio, se devuelve todo vacío y elige la
    // persona: para eso está el paso 3, y una adivinanza a medias confunde más
    // que un select en blanco.
    col = {
      fecha: null, sitio: null, material: null, peso: null,
      contenedores: null, remito: null, destino: null,
    }
  }
  return {
    columnas: {
      fecha: col.fecha ?? '',
      sitio: col.sitio ?? '',
      material: col.material ?? '',
      peso: col.peso ?? '',
      contenedores: col.contenedores ?? '',
      remito: col.remito ?? '',
      destino: col.destino ?? '',
    },
    transformaciones: { saltear: [...SALTEAR_POR_DEFECTO] },
  }
}

/**
 * Los alias guardados, con la clave normalizada de los dos lados. La pantalla
 * escribe la clave con el valor tal cual lo mostró —"AV DE CIRCUNVALACION"— y
 * acá se busca por el normalizado; emparejar en el medio evita que un alias que
 * la persona ya eligió se pierda por una mayúscula.
 */
function mapaDeAlias(crudo: Record<string, string> | undefined): Map<string, string> {
  return new Map(Object.entries(crudo ?? {}).map(([k, valor]) => [normalizar(k), valor]))
}

/** Una fila de totales al pie es tan universal como inútil: sumarla duplica el mes. */
const SALTEAR_POR_DEFECTO = ['TOTAL', 'TOTALES']

/**
 * Si la fila se descarta antes de mirarla, y por cuál de las dos razones.
 *
 * Son dos cosas distintas y se cuentan aparte: la fila de TOTAL al pie es lo
 * que en pantalla se lee como «salteada», mientras que un renglón en blanco en
 * el medio no lo cuenta nadie —`Vistazo.totalFilas` tampoco—. Metidas en el
 * mismo contador, la cuenta que el paso 4 muestra con todas las letras deja de
 * cerrar apenas el Excel traiga un hueco.
 */
function descartar(
  cruda: Record<string, string>, saltear: Set<string>,
): { descartar: boolean; vacia: boolean } {
  if (filaVacia(cruda)) return { descartar: true, vacia: true }
  const salteada = Object.values(cruda).some((x) => saltear.has(normalizar(x)))
  return { descartar: salteada, vacia: false }
}

/**
 * El mes que cubre el archivo, cuando cubre uno solo.
 *
 * La planta manda un remito por mes y los tipea a mano, así que una fecha
 * suelta tres meses atrás es un error de tipeo y no un retiro de mayo. El
 * archivo de agosto trae uno: la fila 46 dice 05/05/2026 entre dos remitos
 * correlativos del 5 de agosto. Importarla tal cual mandaría esos kilos a un
 * cruce de mayo que nadie va a mirar nunca —el peor final posible para un dato,
 * porque no se pierde: queda mal—. Así que se deja afuera con el número de
 * fila, y quien corrige la planilla es la planta.
 *
 * El criterio pide mayoría amplia y un archivo grande para no morder cuando
 * alguna vez manden un trimestre entero: ahí no hay mes dominante y no se
 * descarta nada.
 *
 * Es una sugerencia, no una sentencia. El remito de fin de mes que la planta
 * factura en el archivo siguiente es un retiro real y bien tipeado, y hasta que
 * `aceptarOtrosMeses` existió no había forma de importarlo sin editar el
 * archivo de la planta. Ahora la pantalla cuenta cuántas son y deja decidir.
 */
function mesDominante(porMes: Map<string, number>): string | null {
  let total = 0
  let mejor = ''
  let veces = 0
  for (const [mes, n] of porMes) {
    total += n
    if (n > veces) { veces = n; mejor = mes }
  }
  if (total < 20) return null
  return veces / total >= 0.8 ? mejor : null
}

// ── El análisis ─────────────────────────────────────────────────────────

/**
 * Aplica el mapeo a todas las filas.
 *
 * Resuelve punto verde y corriente en dos pasos: primero el alias explícito de
 * `transformaciones`, y si no hay, un parecido automático contra el catálogo.
 * Lo que no resuelve no lo inventa.
 *
 * Los dos casos sin resolver no terminan igual, y la diferencia es el modelo:
 * sin punto verde no hay contra qué cruzar los kilos, así que la fila queda
 * afuera; sin corriente los kilos siguen siendo los kilos que entraron a ese
 * punto ese día, así que la fila entra con `materialNombre` en null. Las dos
 * cosas aparecen igual en la pantalla para que la persona las resuelva.
 */
export function analizar(
  v: Vistazo, filas: Array<Record<string, string>>, m: Mapeo, c: Catalogo,
): Analisis {
  const col = resolverColumnas(v, m)
  const aliasSitio = mapaDeAlias(m.transformaciones?.sitios)
  const aliasMaterial = mapaDeAlias(m.transformaciones?.materiales)

  const porCodigo = new Map(c.sitios.map((s) => [normalizar(s.codigo), s]))
  const porNombre = new Map(c.materiales.map((x) => [normalizar(x.nombre), x]))

  const saltear = new Set(
    (m.transformaciones?.saltear ?? SALTEAR_POR_DEFECTO).map((s) => normalizar(s)).filter(Boolean),
  )

  // Primera pasada, sólo para saber de qué mes es el archivo. Cuesta una
  // recorrida de más y evita meter una fecha mal tipeada en el mes equivocado.
  const porMes = new Map<string, number>()
  for (const cruda of filas) {
    if (descartar(cruda, saltear).descartar) continue
    const f = aFecha(cruda[col.fecha!] ?? '')
    if (f) porMes.set(f.slice(0, 7), (porMes.get(f.slice(0, 7)) ?? 0) + 1)
  }
  const mesDelArchivo = mesDominante(porMes)
  const filtrarPorMes = !m.transformaciones?.aceptarOtrosMeses

  const mapeadas: FilaMapeada[] = []
  const rechazos: Rechazo[] = []
  const sitiosFlojos = new Map<string, { valor: string; veces: number }>()
  const materialesFlojos = new Map<string, { valor: string; veces: number }>()
  const sugerenciaSitio = new Map<string, string | null>()
  const sugerenciaMaterial = new Map<string, string | null>()
  // El parecido automático es caro y los valores se repiten setenta veces: se
  // resuelve una vez por valor distinto y se reusa.
  const cacheSitio = new Map<string, string | null>()
  const cacheMaterial = new Map<string, string | null>()

  let salteadas = 0
  let vacias = 0
  let sinPeso = 0
  let deOtroMes = 0
  let desde: string | null = null
  let hasta: string | null = null
  let totalKg = 0

  filas.forEach((cruda, i) => {
    const fila = v.filaEncabezado + 1 + i

    const afuera = descartar(cruda, saltear)
    if (afuera.descartar) {
      if (afuera.vacia) vacias++
      else salteadas++
      return
    }

    const brutoFecha = cruda[col.fecha!] ?? ''
    if (!brutoFecha) {
      rechazos.push({ fila, motivo: 'sin fecha', dato: '' })
      return
    }
    const fecha = aFecha(brutoFecha)
    if (!fecha) {
      rechazos.push({ fila, motivo: 'fecha ilegible', dato: brutoFecha })
      return
    }
    if (mesDelArchivo && fecha.slice(0, 7) !== mesDelArchivo) {
      deOtroMes++
      if (filtrarPorMes) {
        rechazos.push({ fila, motivo: 'fecha de otro mes', dato: fecha })
        return
      }
    }

    const brutoSitio = cruda[col.sitio!] ?? ''
    if (!brutoSitio) {
      rechazos.push({ fila, motivo: 'sin punto verde', dato: '' })
      return
    }
    const llaveSitio = normalizar(brutoSitio)
    if (!cacheSitio.has(llaveSitio)) {
      const alias = aliasSitio.get(llaveSitio)
      const pedido = alias ? porCodigo.get(normalizar(alias)) ?? null : null
      const auto = pedido ? null : elegir(brutoSitio, c.sitios, (s) => [s.codigo, s.nombre, s.direccion ?? ''])
      // Un alias que apunta a un punto que ya no está no se reemplaza por una
      // adivinanza: alguien eligió una vez y esa elección dejó de valer, así que
      // se vuelve a preguntar. La sugerencia del select se calcula igual.
      const elegido = pedido ?? (alias ? null : auto?.elegido ?? null)
      cacheSitio.set(llaveSitio, elegido?.codigo ?? null)
      if (!elegido) {
        sitiosFlojos.set(llaveSitio, { valor: brutoSitio, veces: 0 })
        sugerenciaSitio.set(llaveSitio, (auto?.sugerencia ?? auto?.elegido)?.codigo ?? null)
      }
    }
    const sitioCodigo = cacheSitio.get(llaveSitio) ?? null
    if (!sitioCodigo) {
      const flojo = sitiosFlojos.get(llaveSitio)
      if (flojo) flojo.veces++
      rechazos.push({ fila, motivo: 'punto verde sin resolver', dato: brutoSitio })
      return
    }

    const brutoPeso = cruda[col.peso!] ?? ''
    // Antes que nada: una celda rota no es una celda vacía, y si pasara por
    // una entraría con 0 kg escondida adentro de las que legítimamente vienen
    // sin pesar. Esto es lo único que la distingue.
    if (esCeldaRota(brutoPeso)) {
      rechazos.push({ fila, motivo: 'la celda de kilos está rota en el Excel', dato: brutoPeso })
      return
    }
    const pesoKg = aPeso(brutoPeso)
    if (pesoKg === null) {
      rechazos.push({ fila, motivo: 'kilos ilegibles', dato: brutoPeso })
      return
    }
    if (pesoKg < 0) {
      rechazos.push({ fila, motivo: 'kilos en negativo', dato: brutoPeso })
      return
    }
    if (pesoKg > TOPE_PESO_KG) {
      rechazos.push({ fila, motivo: 'kilos fuera de escala', dato: brutoPeso })
      return
    }
    if (!brutoPeso.trim()) sinPeso++

    let materialNombre: string | null = null
    const brutoMaterial = col.material ? (cruda[col.material] ?? '') : ''
    if (brutoMaterial) {
      const llave = normalizar(brutoMaterial)
      if (!cacheMaterial.has(llave)) {
        const alias = aliasMaterial.get(llave)
        const pedido = alias ? porNombre.get(normalizar(alias)) ?? null : null
        const auto = pedido ? null : elegir(brutoMaterial, c.materiales, (x) => [x.nombre])
        const elegido = pedido ?? (alias ? null : auto?.elegido ?? null)
        cacheMaterial.set(llave, elegido?.nombre ?? null)
        if (!elegido) {
          materialesFlojos.set(llave, { valor: brutoMaterial, veces: 0 })
          sugerenciaMaterial.set(llave, (auto?.sugerencia ?? auto?.elegido)?.nombre ?? null)
        }
      }
      materialNombre = cacheMaterial.get(llave) ?? null
      if (!materialNombre) {
        const flojo = materialesFlojos.get(llave)
        if (flojo) flojo.veces++
      }
    }

    mapeadas.push({
      fila,
      fecha,
      sitioCodigo,
      materialNombre,
      pesoKg,
      contenedores: col.contenedores ? aEntero(cruda[col.contenedores] ?? '') : null,
      // El remito no trae el contenedor, así que el par punto + corriente es lo
      // más fino que se puede decir de dónde salieron estos kilos.
      contenedorCodigo: materialNombre ? `${sitioCodigo} · ${materialNombre}` : null,
      cruda,
    })

    totalKg += pesoKg
    if (!desde || fecha < desde) desde = fecha
    if (!hasta || fecha > hasta) hasta = fecha
  })

  const aSinResolver = (
    flojos: Map<string, { valor: string; veces: number }>,
    sugerencias: Map<string, string | null>,
  ): SinResolver[] =>
    [...flojos.entries()]
      .map(([llave, x]) => ({ valor: x.valor, veces: x.veces, sugerencia: sugerencias.get(llave) ?? null }))
      .sort((a, b) => b.veces - a.veces || a.valor.localeCompare(b.valor, 'es'))

  return {
    filas: mapeadas,
    rechazos,
    sitiosSinResolver: aSinResolver(sitiosFlojos, sugerenciaSitio),
    materialesSinResolver: aSinResolver(materialesFlojos, sugerenciaMaterial),
    desde,
    hasta,
    // Los kilos se suman de a centavos y se redondean al final: sumar flotantes
    // de a uno deja un resto que no cuadra con el total de la base.
    totalKg: Math.round(totalKg * 100) / 100,
    filasSinPeso: sinPeso,
    filasSalteadas: salteadas,
    filasVacias: vacias,
    mesDelArchivo,
    filasDeOtroMes: deOtroMes,
  }
}

/**
 * Lo que entra por punto verde. Se calcula del lado del servidor porque es todo
 * lo que la pantalla necesita de `Analisis.filas`: mandar las filas enteras al
 * navegador —cada una con su fila cruda adentro— son decenas de megas de
 * payload para dibujar una tabla de ocho renglones.
 */
export function resumirPorSitio(filas: FilaMapeada[]): ResumenDeSitio[] {
  const por = new Map<string, ResumenDeSitio>()
  for (const f of filas) {
    const acumulado = por.get(f.sitioCodigo)
      ?? { codigo: f.sitioCodigo, filas: 0, kg: 0, contenedores: 0, enCero: 0 }
    acumulado.filas += 1
    acumulado.kg += f.pesoKg
    acumulado.contenedores += f.contenedores ?? 0
    if (f.pesoKg === 0) acumulado.enCero += 1
    por.set(f.sitioCodigo, acumulado)
  }
  // Los kilos se redondean recién acá, por el mismo motivo que el total: sumar
  // flotantes de a uno deja un resto que no cuadra con lo que guarda la base.
  for (const r of por.values()) r.kg = Math.round(r.kg * 100) / 100
  return [...por.values()].sort((a, b) => b.kg - a.kg)
}
