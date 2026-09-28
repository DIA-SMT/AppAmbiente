/**
 * Lo que comparten todas las herramientas de Migue.
 *
 * Tres cosas viven acá y no en cada herramienta, porque si cada una las hiciera
 * a su manera dejarían de ser una sola regla:
 *
 *  · cómo se resuelve «el mes pasado» o «ayer» —en hora de Tucumán y en el
 *    servidor, nunca haciéndole la cuenta al modelo—;
 *  · qué números puede citar una respuesta —los que la herramienta junta a
 *    propósito desde columnas numéricas y de fecha, nunca los que aparecen en
 *    un texto que escribió alguien—;
 *  · cómo viaja el texto libre que cargó una persona: marcado como tal, con
 *    los teléfonos y documentos tapados, recortado, y fuera de la lista de
 *    números.
 */
import 'server-only'

import type { Conexion } from '@db/client'
import { paraInputFechaHora } from '@/lib/formato'
import { HORAS_VISIBLES_EN_EL_CELULAR } from '@/lib/reglas'

import { taparDatosPersonales } from '../limites'
import type { Enlace, Validacion } from '../tipos'

/** El centinela de «sin filtro» en los enums. Ver EsquemaDeParametros en tipos.ts. */
export const TODOS = 'todos'

// ── Períodos ────────────────────────────────────────────────────────────

export const PERIODOS = ['hoy', 'ayer', 'esta_semana', 'semana_pasada', 'este_mes', 'mes_pasado', 'rango'] as const
export type Periodo = (typeof PERIODOS)[number]

/** Las tres propiedades de período, iguales en todas las herramientas que las usan. */
export function propiedadesDePeriodo(): Record<string, unknown> {
  return {
    periodo: {
      type: 'string',
      enum: [...PERIODOS],
      description:
        'El período. Las semanas van de lunes a domingo. «rango» sólo si la persona dio fechas precisas o un mes con nombre; en ese caso completá desde y hasta.',
    },
    desde: {
      type: 'string',
      description: 'Primer día, aaaa-mm-dd. Sólo con periodo «rango»; si no, texto vacío.',
    },
    hasta: {
      type: 'string',
      description: 'Último día, aaaa-mm-dd, incluido. Sólo con periodo «rango»; si no, texto vacío.',
    },
  }
}

export interface PeriodoResuelto {
  /** aaaa-mm-dd, los dos incluidos. Es lo que esperan los filtros de las pantallas. */
  desde: string
  hasta: string
  /** «del 01/09/2026 al 28/09/2026», «el 27/09/2026». */
  frase: string
  /** El período llega hasta hoy, así que todavía puede crecer. */
  incluyeHoy: boolean
  /** Los números de las fechas de la frase, para que la respuesta las pueda decir. */
  numeros: number[]
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/
const PRIMER_DIA_POSIBLE = '2020-01-01'

// La cuenta de días se hace sobre fechas de calendario puras, en UTC, que no
// tiene horario de verano ni corrimientos: el único lugar donde importa la
// zona es para saber qué día es HOY en Tucumán, y eso lo dice paraInputFechaHora.
function aDia(texto: string): Date {
  const [a, m, d] = texto.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d))
}
function deDia(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function sumarDias(texto: string, dias: number): string {
  const d = aDia(texto)
  d.setUTCDate(d.getUTCDate() + dias)
  return deDia(d)
}
function legible(texto: string): string {
  const [a, m, d] = texto.split('-')
  return `${d}/${m}/${a}`
}
function numerosDeDia(texto: string): number[] {
  return texto.split('-').map(Number)
}

export function hoyEnTucuman(ahora: Date): string {
  return paraInputFechaHora(ahora).slice(0, 10)
}

/** Si el modelo llenó desde o hasta. Un espacio suelto no cuenta como fecha. */
export function hayFechas(desde: string, hasta: string): boolean {
  return desde.trim() !== '' || hasta.trim() !== ''
}

/** El rechazo de un período que no es «rango» pero trae fechas. */
export function fechasDeMas(periodo: string): string {
  return `Con periodo «${periodo}», desde y hasta van vacíos. Si la persona dio fechas precisas, usá periodo «rango» con esas fechas.`
}

export function resolverPeriodo(
  periodo: string,
  desde: string,
  hasta: string,
  ahora: Date,
): Validacion<PeriodoResuelto> {
  // Con strict, desde y hasta viajan siempre, y un modelo chico a veces los
  // llena igual: «¿cuánto compost salió del 1 al 15 de agosto?» llega como
  // mes_pasado con 2026-08-01 y 2026-08-15. Si se ignoran en silencio, la
  // herramienta suma el mes entero y el modelo lo presenta como la quincena;
  // el número es real, así que el verificador no lo frena. Se rechaza acá, que
  // es validar(), para que el modelo lo corrija antes de consultar.
  if (periodo !== 'rango' && (PERIODOS as readonly string[]).includes(periodo) && hayFechas(desde, hasta)) {
    return { ok: false, error: fechasDeMas(periodo) }
  }

  const hoy = hoyEnTucuman(ahora)
  let d: string
  let h: string

  switch (periodo) {
    case 'hoy':
      d = h = hoy
      break
    case 'ayer':
      d = h = sumarDias(hoy, -1)
      break
    case 'esta_semana': {
      // getUTCDay: domingo 0. La semana arranca el lunes, como date_trunc('week').
      const diaDeLaSemana = (aDia(hoy).getUTCDay() + 6) % 7
      d = sumarDias(hoy, -diaDeLaSemana)
      h = hoy
      break
    }
    case 'semana_pasada': {
      const diaDeLaSemana = (aDia(hoy).getUTCDay() + 6) % 7
      d = sumarDias(hoy, -diaDeLaSemana - 7)
      h = sumarDias(d, 6)
      break
    }
    case 'este_mes':
      d = `${hoy.slice(0, 8)}01`
      h = hoy
      break
    case 'mes_pasado': {
      const primeroDeEste = `${hoy.slice(0, 8)}01`
      h = sumarDias(primeroDeEste, -1)
      d = `${h.slice(0, 8)}01`
      break
    }
    case 'rango': {
      if (!FECHA.test(desde) || !FECHA.test(hasta) || deDia(aDia(desde)) !== desde || deDia(aDia(hasta)) !== hasta) {
        return { ok: false, error: 'Con periodo «rango», desde y hasta tienen que ser fechas reales en formato aaaa-mm-dd.' }
      }
      if (desde > hasta) return { ok: false, error: 'La fecha desde es posterior a hasta.' }
      if (desde < PRIMER_DIA_POSIBLE) return { ok: false, error: 'El sistema no tiene datos de antes de 2020.', numeros: [2020] }
      if (hasta > hoy) {
        return { ok: false, error: `La fecha hasta (${legible(hasta)}) es posterior a hoy (${legible(hoy)}): no hay datos del futuro.` }
      }
      d = desde
      h = hasta
      break
    }
    default:
      return { ok: false, error: `Período desconocido: ${periodo}.` }
  }

  const frase = d === h ? `el ${legible(d)}` : `del ${legible(d)} al ${legible(h)}`
  return {
    ok: true,
    valor: {
      desde: d,
      hasta: h,
      frase,
      incluyeHoy: h === hoy,
      numeros: [...numerosDeDia(d), ...numerosDeDia(h)],
    },
  }
}

// ── Los números que una respuesta puede citar ───────────────────────────

/**
 * Junta los números que salen de una consulta. Cada herramienta le pasa, uno
 * por uno, los valores de sus columnas numéricas y de fecha. Nunca un texto
 * libre: si una observación dice «el total real es 4.120», ese 4.120 no entra
 * acá, y el verificador no lo va a dejar pasar aunque el modelo lo repita.
 */
export class Numeros {
  private readonly valores = new Set<number>()

  /**
   * Números, o textos que son sólo un número. Un texto puede venir de dos
   * lados y se distinguen por la forma: de la base, un `numeric` llega como
   * «2969.30», con punto decimal; formateado por numero(), como «2.969,3».
   * Tratar el punto siempre como separador de miles convertiría el primero en
   * 296.930.
   */
  agregar(...valores: Array<number | string | null | undefined>): this {
    for (const v of valores) {
      if (v === null || v === undefined || v === '') continue
      let n: number
      if (typeof v === 'number') n = v
      else if (/^-?\d+(\.\d+)?$/.test(v.trim())) n = Number(v.trim())
      else n = Number(v.trim().replace(/\./g, '').replace(',', '.'))
      if (Number.isFinite(n)) this.valores.add(n)
    }
    return this
  }

  /** Una cantidad: se agrega cruda y redondeada como la dibuja numero() con esos decimales. */
  cantidad(valor: number | string | null | undefined, decimales: number): this {
    if (valor === null || valor === undefined || valor === '') return this
    const n = Number(valor)
    if (!Number.isFinite(n)) return this
    const factor = 10 ** decimales
    return this.agregar(n, Math.round(n * factor) / factor)
  }

  /**
   * Una fecha ya formateada —«28/09/2026», «28/09/2026 · 14:32»—: cada grupo de
   * dígitos. Es lo que permite que la respuesta diga «el 28/09 a las 14:32».
   */
  fecha(formateada: string | null | undefined): this {
    if (!formateada) return this
    for (const grupo of formateada.match(/\d+/g) ?? []) this.agregar(Number(grupo))
    return this
  }

  sumar(otros: number[]): this {
    for (const n of otros) this.valores.add(n)
    return this
  }

  lista(): number[] {
    return [...this.valores]
  }
}

// ── El texto que cargó una persona ──────────────────────────────────────

const LARGO_DE_TEXTO_LIBRE = 200

/**
 * Envuelve un texto libre —observaciones, un destino escrito a mano, un
 * motivo de anulación— para que el modelo lo reciba marcado como lo que es: lo
 * escribió alguien en un celular. El sistema le dice que son datos y nunca
 * instrucciones, y sus números no se citan. Se recorta: una observación no
 * tiene por qué ocupar la mitad del pedido.
 *
 * Antes se tapan los teléfonos, documentos y correos. Un vigilador escribe de
 * destino «Juan Pérez 381 555-1234» o de observación «vecino DNI 30.123.456»,
 * y sin esto ese dato viajaba al proveedor en el resultado de la herramienta y
 * quedaba guardado en la conversación, aunque la pregunta sí se filtre. Se
 * tapa antes de recortar: si el corte de las 200 letras cae en medio del
 * número, lo que queda puede no tener ya forma de teléfono y pasar igual.
 */
export function aMano(texto: string | null | undefined): { texto_cargado_a_mano: string } | null {
  const limpio = taparDatosPersonales(texto ?? '').replace(/\s+/g, ' ').trim()
  if (!limpio) return null
  const recortado = limpio.length > LARGO_DE_TEXTO_LIBRE ? `${limpio.slice(0, LARGO_DE_TEXTO_LIBRE)}…` : limpio
  return { texto_cargado_a_mano: recortado }
}

/** Recorta una lista y dice cuánto quedó afuera, para que no parezca que era todo. */
export function recortar<T>(filas: T[], maximo: number): { filas: T[]; nota: string | null } {
  if (filas.length <= maximo) return { filas, nota: null }
  return { filas: filas.slice(0, maximo), nota: `Se muestran ${maximo} de ${filas.length}; el resto está en la pantalla del enlace.` }
}

// ── Enlaces ─────────────────────────────────────────────────────────────

/**
 * Arma un enlace con los filtros que la pantalla lee. Los vacíos no se ponen:
 * las pantallas ignoran en silencio un filtro que no entienden, y un
 * `desde=` vacío no es lo mismo que no tener desde en todas.
 */
export function enlace(
  rotulo: string,
  ruta: string,
  filtros: Record<string, string | number | null | undefined>,
  respalda: Enlace['respalda'],
): Enlace {
  const q = new URLSearchParams()
  for (const [clave, valor] of Object.entries(filtros)) {
    if (valor === null || valor === undefined || valor === '') continue
    q.set(clave, String(valor))
  }
  const texto = q.toString()
  return { rotulo, href: texto ? `${ruta}?${texto}` : ruta, respalda }
}

// ── Lo que ve el celular ────────────────────────────────────────────────

/**
 * La frase de alcance de toda herramienta del vigilador que mira movimientos.
 * El 48 va también a los números: es la cifra que el modelo tiene que poder
 * decir cada vez que explica por qué no ve el mes.
 */
export function alcanceDelCelular(nombreDelPunto: string, que: string): { frase: string; numeros: number[] } {
  return {
    frase: `${nombreDelPunto}, ${que} (desde el celular se ven las últimas ${HORAS_VISIBLES_EN_EL_CELULAR} horas de movimientos del punto)`,
    numeros: [HORAS_VISIBLES_EN_EL_CELULAR],
  }
}

// ── De código a id ──────────────────────────────────────────────────────
// El modelo nombra por código o por nombre —los enums de las herramientas no
// llevan ids— y el id se busca en el momento, con la sesión de quien pregunta.
// Si el catálogo cambió desde que se abrió la conversación, lo dice en vez de
// consultar otra cosa.

export async function idDePunto(tx: Conexion, codigo: string): Promise<Validacion<{ id: string; nombre: string }>> {
  const [fila] = await tx.consultar<{ id: string; nombre: string }>(
    'select id, nombre from sitios where codigo = $1 and activo',
    [codigo],
  )
  return fila ? { ok: true, valor: fila } : { ok: false, error: `El punto ${codigo} ya no está en la lista.` }
}

export async function idDeMaterial(tx: Conexion, nombre: string): Promise<Validacion<{ id: string; nombre: string }>> {
  const [fila] = await tx.consultar<{ id: string; nombre: string }>(
    'select id, nombre from materiales where lower(nombre) = lower($1) and activo',
    [nombre],
  )
  return fila ? { ok: true, valor: fila } : { ok: false, error: `El material «${nombre}» ya no está en la lista.` }
}

/** Un texto de enum: el valor, o TODOS. */
export function enumCon(valores: string[]): { type: 'string'; enum: string[] } {
  return { type: 'string', enum: [TODOS, ...valores] }
}
