/**
 * El control de números: Migue no produce ni un dígito. Cada cantidad, fecha
 * u hora que dice una respuesta tiene que haber salido de una consulta, y si
 * no salió, la respuesta no se muestra.
 *
 * Existe porque los modelos chicos adivinan con aplomo. «Entraron 312,5 m³»
 * hecho de memoria se lee exactamente igual que el verdadero, y con el botón
 * a /movimientos debajo parece respaldado. Lo que este control atrapa es lo
 * grave: sumas, redondeos, promedios, porcentajes y fechas que el modelo
 * calculó por su cuenta.
 *
 * Lo que NO decide es de dónde salen los permitidos. Esa lista la arma quien
 * llama, con los `numeros` de los resultados de las herramientas de consulta
 * y nada más: ni la pregunta («¿fueron 3.500?»), ni el borrador rechazado, ni
 * el aviso de control, ni los recuerdos, ni las observaciones que tipeó
 * alguien en la calle. Si esa lista se contamina, este control deja pasar lo
 * que tenía que frenar (REVISION, hallazgos 24, 31 y 41). Por eso es una
 * función pura, sin base ni estado: el reintento se verifica contra la MISMA
 * lista que el primer intento, y lo que se rechazó una vez se vuelve a
 * rechazar.
 *
 * Sigue siendo una heurística. Un «6» inventado pasa si algún resultado trajo
 * un 6 por otra razón. Lo que la hace valer es que la lista sea chica: la de
 * la conversación, no la del sistema.
 */
import { paraInputFechaHora } from '@/lib/formato'

export interface Veredicto {
  ok: boolean
  /** Los fragmentos tal como están en el texto, sin repetir, para el mensaje de control. */
  sinRespaldo: string[]
}

// Lo que se saca del texto se reemplaza por este carácter y no por espacios:
// así «tres PV-01 cuatro» no queda como «tres cuatro» y se lee como siete, y
// los índices siguen coincidiendo con el texto original para citar el
// fragmento tal cual.
const TAPADO = '\u0000'

function tapar(texto: string, patron: RegExp, alTapar?: (coincidencia: RegExpMatchArray) => void): string {
  let resultado = texto
  for (const coincidencia of texto.matchAll(patron)) {
    alTapar?.(coincidencia)
    const inicio = coincidencia.index ?? 0
    const largo = coincidencia[0].length
    resultado = resultado.slice(0, inicio) + TAPADO.repeat(largo) + resultado.slice(inicio + largo)
  }
  return resultado
}

// ── Lo que se puede citar ───────────────────────────────────────────────

// Se compara por valor y no por texto: «296,40» y «296,4» son lo mismo, y
// «2969.30» de la base es el «2.969,3» que se dice. El redondeo a seis
// decimales sólo absorbe la basura de coma flotante; «unos 300» cuando el
// dato es 296,4 sigue sin respaldo, a propósito: redondear también es una
// cuenta.
function clave(valor: number): number {
  return Math.round(valor * 1e6)
}

/**
 * Hoy y ayer en Tucumán, por componentes. Es lo único que se permite sin
 * consulta, porque es lo único que el modelo recibe como dato y no calcula:
 * «hoy, 28/09, a las 14:32 todavía no se cargó nada». No entra mañana ni la
 * semana que viene: «el 29/09» dicho un 28 es una cuenta.
 */
function componentesDeHoyYAyer(hoy: Date): number[] {
  const [fecha, hora] = paraInputFechaHora(hoy).split('T')
  const [anio, mes, dia] = fecha.split('-').map(Number)
  const [horas, minutos] = hora.split(':').map(Number)

  // La cuenta del día anterior va en UTC sobre la fecha de calendario, que no
  // se corre: el 1/10 da 30/09 sin pasar por la zona de nadie.
  const ayer = new Date(Date.UTC(anio, mes - 1, dia - 1))
  return [
    anio, mes, dia, horas, minutos,
    ayer.getUTCFullYear(), ayer.getUTCMonth() + 1, ayer.getUTCDate(),
  ]
}

// ── El número de un movimiento ──────────────────────────────────────────
// «el movimiento Nº 482», «#482». Se trata aparte pero NO se exime: la
// numeración es una secuencia global del 1 al último, así que un número
// inventado es siempre un movimiento que existe —otro—, y el botón manda a la
// persona a mirarlo. Tiene que estar en los permitidos como cualquier otro.
//
// Aparte porque es un entero y nada más: «Nº 1.482» no tiene la lectura
// «uno coma cuatro ocho dos» que sí tiene «1.482 m³», y el «°» de «N°» no es
// el de un ordinal ni el de una temperatura.

const NUMERO_DE_MOVIMIENTO = /(?:#|(?<!\p{L})(?:N[º°]|Nro\.?|n[úu]mero)) ?(\d+(?:\.\d{3})*)(?!\d|,\d)/giu

// ── Identificadores que no son cantidades ───────────────────────────────
// Llevan dígitos y no dicen cuánto de nada. Se sacan antes de buscar números
// porque, si no, «PV-03» aportaría un 3 que ninguna consulta devolvió y la
// respuesta más inocente —«PV-03 sólo carga el conteo»— se rechazaría.
//
// Son formas exactas y en mayúscula a propósito. Todo lo que se saca acá se
// escapa del control, así que cuanto más ancha la forma, más fácil esconder
// un número detrás: en minúscula, «del 123» ya sería una patente.

const IDENTIFICADORES: RegExp[] = [
  // Los formularios de la Secretaría: R-05-01, R-05-02, R-05-06…
  /(?<![\p{L}\d])R-\d{2}-\d{2}(?![\p{L}\d])/gu,
  // Los puntos verdes, con guion o sin él. PVRV-VIV y PVRV-HUE no llevan
  // dígitos y no hace falta nombrarlos. Los contenedores se llaman con el
  // código del punto («PV-02 · Cartón») y quedan cubiertos por esto.
  /(?<![\p{L}\d])PV[- ]?\d{1,2}(?![\p{L}\d])/gu,
  // Las pilas sembradas en local (P-01…P-13). Las de producción se llaman
  // con el número pelado de la planilla —«la pila 3»— y ese sí se verifica.
  /(?<![\p{L}\d])P-\d{1,3}(?![\p{L}\d])/gu,
  // Patentes: la del Mercosur (AB 123 CD) y la vieja (ABC 123), con espacio,
  // guion o pegadas, que es como se escriben en la planilla. Se descartan las
  // siglas de moneda: «USD 150» es una cantidad.
  /(?<![\p{L}\d])(?!USD|ARS)[A-Z]{2}[ -]?\d{3}[ -]?[A-Z]{2}(?![\p{L}\d])/gu,
  /(?<![\p{L}\d])(?!USD|ARS)[A-Z]{3}[ -]?\d{3}(?![\p{L}\d])/gu,
  // Calles con número. «La 9 de Julio» es la planta externa de donde vienen
  // las importaciones, no una fecha. Con el mes en mayúscula, que es como se
  // escribe el nombre; «el 9 de julio» sigue siendo una fecha y se verifica.
  /(?<![\p{L}\d])(?:9 de Julio|24 de Septiembre|25 de Mayo)(?!\p{L})/gu,
  // El nombre de un recipiente: en «3 tambores de 200 L» el 3 es la cantidad
  // y el 200 es cómo se llama la cosa.
  /(?<!\p{L})tambor(?:es)? de 200 ?(?:L|l|litros)(?!\p{L})/gu,
  // La unidad escrita sin superíndice: «296,4 m3» o «296,4m3». Sin esto el
  // 3 de la unidad se leería como un número.
  /(?<!\p{L})[mM][23](?![\p{L}\d])/gu,
  // Los números de una lista numerada, al principio del renglón: «1. PV-02»
  // ordena, no cuenta.
  /^[ \t]*\d{1,2}[.)](?=[ \t])/gmu,
]

// ── Proporciones y aproximaciones ───────────────────────────────────────
// Siempre sin respaldo, lleven o no un dígito al lado. «La mitad de las
// salidas no declara pila», cuando la consulta dijo 38 %, no tiene ningún
// número que comparar y es una cuenta hecha por el modelo; «el doble que en
// julio», lo mismo. Y «decenas de», «cientos de» son un redondeo con otro
// nombre. Si una herramienta quiere que se diga una proporción, la devuelve
// ya calculada, como número.

const PROPORCIONES: RegExp[] = [
  // «A mitad de mes» es un momento, no una proporción.
  /(?<!\p{L})(?:(?:la|una) )?mitad(?!\p{L})(?! (?:del?|de la) (?:mes|semana|d[ií]a|año|mañana|tarde|turno|jornada))/giu,
  // Con artículo: «doble turno» no es una proporción, «el doble» sí.
  /(?<!\p{L})(?:el|al|del|un|casi el|más del|menos del) (?:doble|triple|cu[aá]druple)(?!\p{L})/giu,
  /(?<!\p{L})(?:dupli|tripli|cuadrupli)c\p{L}*/giu,
  /(?<!\p{L})(?:un|dos|el|los) tercios?(?!\p{L})/giu,
  // «el cuarto» es un ordinal («el cuarto punto»): sólo «un cuarto», «tres cuartos».
  /(?<!\p{L})(?:un|tres) cuartos?(?!\p{L})/giu,
  /(?<!\p{L})(?:tercera|cuarta|quinta|d[eé]cima) parte(?!\p{L})/giu,
  /(?<!\p{L})por ciento(?!\p{L})/giu,
  /(?<![\p{L}\d])(?:\p{L}+|\d+) de cada (?:\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|cien|mil)(?![\p{L}\d])/giu,
  /(?<!\p{L})(?:decenas?|docenas?|centenar(?:es)?|millar(?:es)?)(?!\p{L})/giu,
  /(?<!\p{L})(?:cientos|miles) de(?!\p{L})/giu,
]

// ── Números escritos en palabras ────────────────────────────────────────
// «Quedan cinco pilas madurando» cuando la consulta devolvió 4 no tiene un
// solo dígito, y es igual de falso. Se leen y se verifican como los dígitos.
//
// Salvo «un», «uno», «una» y «dos» solos: son demasiado comunes en castellano
// —«los dos predios», «cada uno», «una vez»— y exigirles respaldo rechazaría
// media respuesta. Dentro de un número compuesto sí cuentan: «dos mil»,
// «treinta y dos».

// Un Map y no un objeto: en un objeto, «constructor» también sería una clave.
const PALABRAS = new Map<string, number>(Object.entries({
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21,
  veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
  veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100,
  doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500,
  seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
  mil: 1000,
}))

const DEMASIADO_COMUNES = new Set(['un', 'uno', 'una', 'dos'])
const DECENAS = new Set(['treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'])

// Sin tildes y en minúscula, para que «dieciséis» y «dieciseis» sean la misma
// palabra: el modelo escribe las dos.
function normalizar(palabra: string): string {
  return palabra.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

interface NumeroEnPalabras {
  inicio: number
  fin: number
  palabras: string[]
}

function valorEnPalabras(palabras: string[]): number {
  let total = 0
  let actual = 0
  for (const palabra of palabras) {
    if (palabra === 'mil') {
      total += (actual || 1) * 1000
      actual = 0
    } else {
      actual += PALABRAS.get(palabra) ?? 0
    }
  }
  return total + actual
}

/**
 * Agrupa las palabras de número seguidas —«dos mil veintiséis», «treinta y
 * cinco»— en un solo valor. La «y» une sólo después de una decena: en «tres
 * y cuatro pilas» son dos números, no siete.
 */
function numerosEnPalabras(texto: string): NumeroEnPalabras[] {
  const encontrados: NumeroEnPalabras[] = []
  let actual: NumeroEnPalabras | null = null
  // Hasta dónde se leyó el número en curso: su última palabra, o la «y» que
  // la sigue. Lo que venga después tiene que estar pegado a eso.
  let hastaAca = 0
  let despuesDeY = false

  for (const coincidencia of texto.matchAll(/\p{L}+/gu)) {
    const palabra = normalizar(coincidencia[0])
    const inicio = coincidencia.index ?? 0
    const fin = inicio + coincidencia[0].length
    const valor = PALABRAS.get(palabra)
    const pegada = actual !== null && /^\s+$/.test(texto.slice(hastaAca, inicio))

    if (actual && pegada && palabra === 'y' && !despuesDeY && DECENAS.has(actual.palabras[actual.palabras.length - 1])) {
      despuesDeY = true
      hastaAca = fin
      continue
    }

    if (actual && pegada && valor !== undefined && (!despuesDeY || valor < 10)) {
      actual.palabras.push(palabra)
      actual.fin = fin
      hastaAca = fin
      despuesDeY = false
      continue
    }

    if (actual) encontrados.push(actual)
    actual = valor === undefined ? null : { inicio, fin, palabras: [palabra] }
    hastaAca = fin
    despuesDeY = false
  }
  if (actual) encontrados.push(actual)

  return encontrados.filter((numero) => !numero.palabras.every((palabra) => DEMASIADO_COMUNES.has(palabra)))
}

// ── Números escritos con dígitos ────────────────────────────────────────

/**
 * Las lecturas posibles de un grupo de dígitos con puntos y comas.
 *
 * El sistema escribe en formato argentino —«2.969,3»—, pero el modelo a veces
 * escribe en inglés —«2969.3»— y hay un caso que no se puede decidir: «1.482»
 * es mil cuatrocientos ochenta y dos o uno coma cuatro ocho dos. Valen las dos
 * lecturas; si cualquiera está permitida el número pasa, porque en los dos
 * casos los dígitos salieron de la consulta.
 *
 * null cuando la forma no es un número sino varios: «28.09.2026», «3,4,5».
 */
function lecturas(grupo: string): number[] | null {
  const separadores = grupo.match(/[.,]/g) ?? []
  const partes = grupo.split(/[.,]/)
  if (separadores.length === 0) return [Number(grupo)]

  if (separadores.length === 1) {
    const [entera, decimal] = partes
    const puedeSerDeMiles = decimal.length === 3 && entera.length <= 3 && Number(entera) !== 0
    const comoDecimal = Number(`${entera}.${decimal}`)
    return puedeSerDeMiles ? [Number(entera + decimal), comoDecimal] : [comoDecimal]
  }

  const deATres = (grupos: string[]) => grupos[0].length <= 3 && grupos.slice(1).every((parte) => parte.length === 3)

  // Más de un separador, todos iguales: son de miles, «1.234.567».
  if (separadores.every((separador) => separador === separadores[0])) {
    return deATres(partes) ? [Number(partes.join(''))] : null
  }

  // Mezclados: el último es el decimal y los demás, de miles y todos del otro
  // tipo. «2.969,3» o «2,969.3».
  const ultimo = separadores[separadores.length - 1]
  if (separadores.slice(0, -1).some((separador) => separador === ultimo)) return null
  const enteras = partes.slice(0, -1)
  if (!deATres(enteras)) return null
  return [Number(`${enteras.join('')}.${partes[partes.length - 1]}`)]
}

// Un número, o varios pegados por «/», «:» o un guion: fechas (28/09/2026),
// horas (14:32), rangos (3-5). Cada componente se verifica solo, y si uno
// falla se cita el conjunto, que es como el modelo lo va a reconocer.
const NUMERO_CON_DIGITOS = /[-−]?\d+(?:[.,]\d+)*(?:[/:\-–]\d+(?:[.,]\d+)*)*/gu

interface NumeroConDigitos {
  inicio: number
  fin: number
  /** Las lecturas de cada componente: «28/09» son dos, «1.482» es uno con dos lecturas. */
  valores: number[][]
}

function numerosConDigitos(texto: string): NumeroConDigitos[] {
  const encontrados: NumeroConDigitos[] = []

  for (const coincidencia of texto.matchAll(NUMERO_CON_DIGITOS)) {
    let inicio = coincidencia.index ?? 0
    let cuerpo = coincidencia[0]
    let signo = 1

    // Un menos es un signo si está suelto delante del número: «−12 %», «de
    // -3». Pegado a una palabra es un guion: «COVID-19». Entre dos números la
    // expresión ya lo tomó como rango.
    if (/^[-−]/.test(cuerpo)) {
      cuerpo = cuerpo.slice(1)
      if (/\p{L}/u.test(texto[inicio - 1] ?? '')) inicio += 1
      else signo = -1
    }

    const valores: number[][] = []
    cuerpo.split(/[/:\-–]/).forEach((componente, indice) => {
      const conSigno = (valor: number) => (indice === 0 ? signo * valor : valor)
      const leidas = lecturas(componente)
      if (leidas) valores.push(leidas.map(conSigno))
      else for (const parte of componente.split(/[.,]/)) valores.push([conSigno(Number(parte))])
    })

    // Se cita con su porcentaje, si lo tiene: en el aviso de control, «12 %»
    // se entiende mejor que «12».
    let fin = (coincidencia.index ?? 0) + coincidencia[0].length
    fin += /^ ?%/.exec(texto.slice(fin))?.[0].length ?? 0
    encontrados.push({ inicio, fin, valores })
  }

  return encontrados
}

// ── El veredicto ────────────────────────────────────────────────────────

/**
 * Busca en la respuesta cada número —con dígitos o en palabras— y cada
 * proporción, y devuelve los que no están entre los permitidos.
 *
 * `permitidos` es la unión de los `numeros` de los resultados de consulta de
 * la conversación. `hoy` es el momento de la pregunta: suma la fecha y la
 * hora de Tucumán, y la fecha de ayer.
 */
export function verificarNumeros(texto: string, permitidos: number[], hoy: Date): Veredicto {
  const respaldados = new Set([...permitidos, ...componentesDeHoyYAyer(hoy)].map(clave))
  const estaPermitido = (valor: number) => respaldados.has(clave(valor))

  // Lo que no pasa, con dónde empieza: el aviso se lee en el orden del texto,
  // y así el modelo reconoce qué tiene que reescribir.
  const rechazados: Array<{ inicio: number; fragmento: string }> = []
  const rechazar = (inicio: number, fin: number) => {
    rechazados.push({ inicio, fragmento: texto.slice(inicio, fin) })
  }

  // Las piezas se van tapando en orden —primero lo que se verifica aparte o
  // no es cantidad— para que la búsqueda de números no las vuelva a
  // encontrar. Los índices no cambian, así que se cita del texto original.
  let resto = tapar(texto, NUMERO_DE_MOVIMIENTO, (coincidencia) => {
    const inicio = coincidencia.index ?? 0
    if (!estaPermitido(Number(coincidencia[1].replace(/\./g, '')))) rechazar(inicio, inicio + coincidencia[0].length)
  })
  for (const patron of IDENTIFICADORES) resto = tapar(resto, patron)
  for (const patron of PROPORCIONES) {
    resto = tapar(resto, patron, (coincidencia) => {
      const inicio = coincidencia.index ?? 0
      rechazar(inicio, inicio + coincidencia[0].length)
    })
  }

  for (const numero of numerosEnPalabras(resto)) {
    if (!estaPermitido(valorEnPalabras(numero.palabras))) rechazar(numero.inicio, numero.fin)
  }
  for (const numero of numerosConDigitos(resto)) {
    if (!numero.valores.every((leidas) => leidas.some(estaPermitido))) rechazar(numero.inicio, numero.fin)
  }

  const sinRespaldo: string[] = []
  for (const { fragmento } of rechazados.sort((a, b) => a.inicio - b.inicio)) {
    const limpio = fragmento.trim()
    if (limpio && !sinRespaldo.includes(limpio)) sinRespaldo.push(limpio)
  }
  return { ok: sinRespaldo.length === 0, sinRespaldo }
}

/**
 * «No, no fueron 3.000: en agosto entraron 442,0 m³». El 3.000 lo escribió la
 * persona y la respuesta lo NIEGA: no es un dato, y rechazarlo hacía que un
 * modelo que insiste en contestar la pregunta tal como se la hicieron —pasó
 * con gpt-4.1-mini, aun después del control— terminara en la respuesta sin
 * números. Antes de verificar se saca sólo un número de la pregunta que va
 * negado («no fueron», «no son», «no hubo», «no entraron»…) y nada más: «sí,
 * fueron 3.000» o «fueron unos 3.000» se siguen rechazando.
 */
export function sinLoNegadoDeLaPregunta(texto: string, pregunta: string): string {
  let resultado = texto
  for (const numero of pregunta.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    const escapado = numero.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const negado = new RegExp(
      `\\bno\\s+(?:fue|fueron|es|son|era|eran|hubo|entr[oó]|entraron|sali[oó]|salieron|lleg[oó]|llegaron)\\s+` +
        `(?:de\\s+|a\\s+)?${escapado}(?![\\d.,]*\\d)`,
      'gi',
    )
    resultado = resultado.replace(negado, (tramo) => tramo.slice(0, tramo.length - numero.length))
  }
  return resultado
}
