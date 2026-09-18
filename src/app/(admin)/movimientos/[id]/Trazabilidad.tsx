import Link from 'next/link'
import { fecha, numero, paraInputFechaHora } from '@/lib/formato'
import type { TrazaDeSalida } from '@/lib/tipos'

/**
 * De dónde salió este camión.
 *
 * Es la pregunta que hoy la Secretaría no puede contestar, así que la respuesta
 * se escribe como una frase y no como una tabla de campos: lo que tiene que
 * quedar es "compost de la poda que levantó tal cuadrilla en abril", no seis
 * rótulos con seis valores sueltos. Si un dato falta, la frase se acomoda; un
 * hueco o un guión no dicen nada.
 */

const DIA = 86_400_000

/**
 * Las columnas `date` llegan como Date a medianoche UTC. Hay que leerlas en UTC:
 * con los getters locales, en Tucumán (UTC−3) el 3 de abril se lee como el 2 y
 * toda la frase queda corrida un día.
 */
function dia(valor: string | Date | null | undefined): string | null {
  if (!valor) return null
  if (valor instanceof Date) {
    const dos = (n: number) => String(n).padStart(2, '0')
    return `${valor.getUTCFullYear()}-${dos(valor.getUTCMonth() + 1)}-${dos(valor.getUTCDate())}`
  }
  return String(valor).slice(0, 10) || null
}

/** dd/mm/aaaa de un día de calendario, leído al mediodía para que ninguna zona lo corra. */
const enDia = (clave: string) => fecha(`${clave}T12:00:00-03:00`)

const enM3 = (valor: number) => `${numero(valor, Number.isInteger(valor) ? 0 : 1)} m³`

function diasEntre(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split('-').map(Number)
  const [a2, m2, d2] = hasta.split('-').map(Number)
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / DIA)
}

/** Menos de mes y medio en días: "maduró 40 días" se entiende; "maduró 1 mes", no. */
function duracion(dias: number): string {
  if (dias < 45) return `${numero(dias)} ${dias === 1 ? 'día' : 'días'}`
  const meses = Math.round(dias / 30.44)
  return `${numero(meses)} ${meses === 1 ? 'mes' : 'meses'}`
}

/**
 * Las procedencias vienen pegadas con ' · ' desde la vista. En una frase se leen
 * mejor separadas por comas, y arriba de cuatro se cortan: la lista completa
 * está en la ficha de la pila.
 */
function listar(crudo: string | null): string {
  const partes = (crudo ?? '')
    .split('·')
    .map((p) => p.trim())
    .filter(Boolean)
  if (partes.length === 0) return ''
  if (partes.length === 1) return partes[0]
  if (partes.length > 4) {
    const resto = partes.length - 3
    return `${partes.slice(0, 3).join(', ')} y ${numero(resto)} orígenes más`
  }
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

function unir(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? ''
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

const capitalizar = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

export default function Trazabilidad({ traza }: { traza: TrazaDeSalida | null }) {
  if (!traza) {
    return (
      <p className="menor gris" style={{ margin: 0 }}>
        Esta salida no dice de qué pila salió. La pila se elige al cargar el movimiento.
      </p>
    )
  }

  const armado = dia(traza.fecha_armado)
  const cierre = dia(traza.fecha_cierre)
  const madurez = dia(traza.madurez)
  const salida = paraInputFechaHora(traza.ocurrido_en).slice(0, 10)

  const m3 = Number(traza.m3_que_la_formaron)
  const tieneM3 = Number.isFinite(m3) && m3 > 0
  const volteos = Number(traza.volteos) || 0
  const origenes = listar(traza.procedencias)

  // ── Cómo se formó ─────────────────────────────────────────────────────
  let formacion = ''
  if (armado && cierre) {
    formacion = armado === cierre
      ? `que se armó y se cerró el ${enDia(armado)}`
      : `que se armó entre el ${enDia(armado)} y el ${enDia(cierre)}`
  } else if (armado) {
    formacion = `que se armó el ${enDia(armado)}`
  } else if (cierre) {
    formacion = `que se cerró el ${enDia(cierre)}`
  }

  const conQue = tieneM3 && origenes
    ? `con ${enM3(m3)} de ${origenes}`
    : tieneM3
      ? `con ${enM3(m3)} de material`
      : origenes
        ? `con material de ${origenes}`
        : ''

  const frases: string[] = []

  // Sin fechas, el volumen no puede colgarse de "que se armó": queda suelto y
  // parece que el camión llevó esos m³.
  const cola = formacion
    ? `, ${formacion}${conQue ? ` ${conQue}` : ''}.`
    : '.'
  if (!formacion && conQue) frases.push(`La pila se armó ${conQue}.`)

  // ── Cómo se la trató ──────────────────────────────────────────────────
  const partes: string[] = []
  if (!cierre) partes.push('cuando salió este camión la pila todavía no estaba cerrada')
  partes.push(
    volteos > 0
      ? `se volteó ${numero(volteos)} ${volteos === 1 ? 'vez' : 'veces'}`
      : 'no se le registró ningún volteo',
  )
  const maduracion = cierre ? diasEntre(cierre, salida) : 0
  if (cierre && maduracion > 0) partes.push(`maduró ${duracion(maduracion)}`)
  frases.push(`${capitalizar(unir(partes))}.`)

  // Un camión que salió antes de la fecha de madurez es un dato, no un error:
  // la coordinadora tiene que verlo acá y no deducirlo de dos fechas sueltas.
  const salioAntes = madurez !== null && salida < madurez

  return (
    <section className="tarjeta pila-chica">
      <h2>De dónde salió</h2>

      <p style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
        Este compost salió de la pila <span className="mono fuerte">{traza.pila}</span>
        {cola}
        {frases.length > 0 && ` ${frases.join(' ')}`}
      </p>

      {salioAntes && madurez && (
        <p className="menor" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          <span className="fuerte">Salió antes de la madurez estimada</span>, que caía el{' '}
          {enDia(madurez)}.
        </p>
      )}

      <div>
        <Link className="boton secundario" href={`/pilas/${traza.pila_id}`}>
          Ver la ficha de la pila
        </Link>
      </div>
    </section>
  )
}
