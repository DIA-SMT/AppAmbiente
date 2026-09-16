import Link from 'next/link'
import { redirect } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import { conteosRecientes } from '@/lib/datos'
import {
  claveDeCalendario, desdeInputFechaHora, diaSemana, fecha, numero, paraInputFechaHora,
} from '@/lib/formato'
import { sesionActual } from '@/lib/sesion'
import FormularioConteo, { type DiaDelConteo } from './FormularioConteo'

export const dynamic = 'force-dynamic'

/**
 * Hasta dónde para atrás deja la base cargar o corregir (0017). La lista de
 * abajo muestra exactamente esa ventana: un día que todavía se puede completar
 * tiene que estar a la vista, y uno que ya no, no tiene por qué prometerse.
 */
const DIAS_ATRAS = 7

/** Hoy en Tucumán, como aaaa-mm-dd: el servidor puede estar en UTC. */
function hoyEnTucuman(): string {
  return paraInputFechaHora().slice(0, 10)
}

/**
 * "miércoles 16 de septiembre".
 *
 * Intl en es-AR mete una coma después del día de la semana, y acá el texto se
 * lee adentro de una frase: "Hoy, miércoles 16 de septiembre".
 */
function diaEscrito(cuando: Date): string {
  return diaSemana(cuando).replace(',', '')
}

function conMayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export default async function ConteoDelDia() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  const [sitios, conteos] = await Promise.all([
    sesion.sitioId
      ? consultarConSesion<{ nombre: string; tipo: string; carga_detallada: boolean }>(
          sesion,
          'select nombre, tipo, carga_detallada from sitios where id = $1',
          [sesion.sitioId],
        )
      : Promise.resolve([]),
    conteosRecientes(sesion, { dias: DIAS_ATRAS }),
  ])

  const sitio = sitios[0]
  // El conteo es de vecinos que llegan a un punto verde. En la Planta no hay
  // ninguno que contar, y por eso tampoco aparece el botón que lleva hasta acá.
  if (!sitio || sitio.tipo === 'planta') redirect('/turno')

  // Las columnas `date` vuelven como Date a medianoche UTC: la clave sale de
  // leerlas en UTC, no de formatearlas en hora de Tucumán.
  const cargados = new Map(conteos.map((c) => [claveDeCalendario(c.fecha), c]))

  const hoy = hoyEnTucuman()
  const mediodia = desdeInputFechaHora(`${hoy}T12:00`) ?? new Date()

  const dias: DiaDelConteo[] = []
  for (let atras = 0; atras <= DIAS_ATRAS; atras++) {
    // Tucumán no cambia de hora en todo el año: restarle un día al mediodía cae
    // siempre al mediodía del día anterior, lejos de cualquier borde.
    const cuando = new Date(mediodia.getTime() - atras * 86_400_000)
    const clave = paraInputFechaHora(cuando).slice(0, 10)
    const escrito = diaEscrito(cuando)
    const corto = escrito.split(' de ')[0]
    const relativo = atras === 0 ? 'Hoy' : atras === 1 ? 'Ayer' : null

    const cargado = cargados.get(clave)
    const vecinos = cargado ? Number(cargado.vecinos) : null

    dias.push({
      clave,
      titulo: relativo ? `${relativo}, ${escrito}` : conMayuscula(escrito),
      etiqueta: relativo ? `${relativo}, ${corto}` : conMayuscula(corto),
      mencion: relativo ?? `El ${corto}`,
      fecha: fecha(cuando),
      vecinos,
      resumen: vecinos === null ? null : `${numero(vecinos)} ${vecinos === 1 ? 'vecino' : 'vecinos'}`,
      observaciones: cargado?.observaciones ?? '',
    })
  }

  return (
    <div className="pila">
      <div className="fila-entre">
        <h1>Conteo del día</h1>
        <Link href="/turno" className="boton fantasma chico">Volver</Link>
      </div>

      <p className="menor gris" style={{ margin: 0 }}>{sitio.nombre}</p>

      <div className="aviso">
        {sitio.carga_detallada
          ? 'Para el día que no se pudo cargar de a un vecino: anotás el total en papel y lo cargás una sola vez al cerrar.'
          : 'Acá el conteo se lleva en papel durante el día y se carga una sola vez al cerrar: el total de vecinos que vinieron.'}
      </div>

      <FormularioConteo dias={dias} />
    </div>
  )
}
