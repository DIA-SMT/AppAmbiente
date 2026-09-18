/**
 * Formato argentino: fecha dd/mm/aaaa, coma decimal, punto de miles.
 * Todo el sistema muestra hora local de Tucumán (UTC-3, sin horario de verano).
 */

export const ZONA = 'America/Argentina/Tucuman'

const fFecha = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric',
})
const fFechaHora = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
})
const fHora = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false,
})
const fMesLargo = new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, month: 'long', year: 'numeric' })
const fMesCorto = new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, month: 'short' })
const fDiaSemana = new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long' })

function aFecha(v: Date | string | number | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export const fecha      = (v: Date | string | null | undefined) => { const d = aFecha(v); return d ? fFecha.format(d) : '—' }
export const fechaHora  = (v: Date | string | null | undefined) => { const d = aFecha(v); return d ? fFechaHora.format(d).replace(', ', ' · ') : '—' }
export const hora       = (v: Date | string | null | undefined) => { const d = aFecha(v); return d ? fHora.format(d) : '—' }
export const diaSemana  = (v: Date | string | null | undefined) => { const d = aFecha(v); return d ? fDiaSemana.format(d) : '—' }

export function mesLargo(v: Date | string | null | undefined) {
  const d = aFecha(v)
  if (!d) return '—'
  const t = fMesLargo.format(d)
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function mesCorto(v: Date | string | null | undefined) {
  const d = aFecha(v)
  if (!d) return '—'
  return fMesCorto.format(d).replace('.', '').toUpperCase()
}

/**
 * Una columna `date` de Postgres, formateada como fecha argentina.
 *
 * Un `date` es una fecha de calendario: no tiene hora ni zona. El driver la
 * entrega como un Date a medianoche UTC, y formatearla en hora de Tucumán
 * (UTC−3) la corre al día anterior — el 1 de septiembre se lee como 31 de
 * agosto. Hay que leer las partes en UTC y recién ahí armar la fecha.
 *
 * Para columnas `timestamptz` —que sí son un instante— va fecha() o fechaHora(),
 * que convierten a hora de Tucumán como corresponde.
 */
export function fechaDeCalendario(v: Date | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
  }
  if (Number.isNaN(v.getTime())) return '—'
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(v.getUTCDate())}/${dos(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`
}

/** La misma fecha de calendario, como clave aaaa-mm-dd para agrupar. */
export function claveDeCalendario(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string') return v.slice(0, 10) || null
  if (Number.isNaN(v.getTime())) return null
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${v.getUTCFullYear()}-${dos(v.getUTCMonth() + 1)}-${dos(v.getUTCDate())}`
}

/** Números con coma decimal. Los decimales se piden según la unidad. */
export function numero(v: number | string | null | undefined, decimales = 0): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(n)
}

export function cantidad(
  valor: number | string | null | undefined,
  unidad: { nombre?: string; nombre_plural?: string; decimales?: number } | null,
): string {
  const n = typeof valor === 'string' ? Number(valor) : valor
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const dec = unidad?.decimales ?? 0
  const texto = numero(n, dec)
  if (!unidad) return texto
  const etiqueta = n === 1 ? (unidad.nombre ?? '') : (unidad.nombre_plural ?? unidad.nombre ?? '')
  return etiqueta ? `${texto} ${etiqueta}` : texto
}

/**
 * Lo que va en la columna "cantidad" de un listado de movimientos.
 *
 * Si el movimiento mezcla unidades (2 m³ de poda y 1 camión de chipeo), sumar
 * no significa nada: en ese caso se dice cuántos materiales tiene y el detalle
 * queda para la ficha.
 */
export function cantidadDeMovimiento(m: {
  items: number
  cantidad_total: number | string | null
  unidad_nombre: string | null
  unidad_plural: string | null
  unidad_decimales: number | null
}): string {
  if (!m.items) return '—'
  if (m.unidad_plural === null) return `${m.items} materiales`
  return cantidad(m.cantidad_total, {
    nombre: m.unidad_nombre ?? undefined,
    nombre_plural: m.unidad_plural,
    decimales: m.unidad_decimales ?? 0,
  })
}

/** "hace 5 min", "hace 2 h", "ayer" — para el listado del turno. */
export function haceCuanto(v: Date | string | null | undefined, ahora = new Date()): string {
  const d = aFecha(v)
  if (!d) return '—'
  const seg = Math.round((ahora.getTime() - d.getTime()) / 1000)
  if (seg < 60) return 'recién'
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`
  if (seg < 172800) return 'ayer'
  return fecha(d)
}

/**
 * Valor para <input type="datetime-local">, en hora de Tucumán.
 * El input no maneja zonas: hay que darle el instante ya corrido.
 */
export function paraInputFechaHora(v: Date | string = new Date()): string {
  const d = aFecha(v) ?? new Date()
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}

/** Vuelta: lo que escribió el usuario (hora de Tucumán) al instante real. */
export function desdeInputFechaHora(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(texto)
  if (!m) return null
  const [, a, me, d, h, mi] = m
  // Tucumán es UTC-3 todo el año.
  return new Date(`${a}-${me}-${d}T${h}:${mi}:00-03:00`)
}

export const ETIQUETA_TIPO: Record<string, string> = {
  ingreso: 'Ingreso',
  salida: 'Salida',
  contenedor: 'Contenedor',
}

export const ETIQUETA_FLUJO: Record<string, string> = {
  planta: 'Planta de Valorización',
  punto_verde: 'Punto Verde',
  gran_generador: 'Gran generador',
}

/**
 * Para qué se entrega el material, con las palabras de cada formulario de
 * entrega: R-05-06 en la Planta y R-05-08 en el punto verde. Las dos listas
 * viven juntas acá porque una etiqueta es una etiqueta; cuál se ofrece en cada
 * pantalla lo decide valorizacionesDeFlujo(), en recursos.ts.
 *
 * Reemplazan a reutilizacion / venta / emprendimiento / otro, que eran un
 * supuesto nuestro de la fase 1: la Secretaría nunca usó esas cuatro palabras.
 */
export const ETIQUETA_VALORIZACION: Record<string, string> = {
  // R-05-06 · Entrega de chips, compost y leña (Planta)
  uso_interno_huerta: 'Uso interno · Huerta',
  uso_interno_plazas: 'Uso interno · Plazas',
  uso_interno_transforma: 'Uso interno · TRANSFORMA',
  vecino: 'Vecino',
  ecocanje: 'Ecocanje',
  aserradero: 'Aserradero',
  cic: 'CIC',
  // R-05-08 · Entrega para reutilizar (Punto Verde)
  manualidades: 'Manualidades, artesanías y emprendimientos',
  venta: 'Venta',
  asfalto: 'Proceso de asfalto de la Planta de Asfalto Municipal',
  // En los dos
  otro: 'Otro',
}

export const ETIQUETA_ENTIDAD: Record<string, string> = {
  empresa: 'Empresa',
  emprendimiento: 'Emprendimiento',
  organizacion: 'Organización',
  carrero: 'Carrero',
  dependencia_municipal: 'Dependencia municipal',
  planta_externa: 'Planta externa',
  otro: 'Otro',
}
