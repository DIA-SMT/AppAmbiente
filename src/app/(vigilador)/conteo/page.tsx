import Link from 'next/link'
import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import { conteosRecientesEnTx } from '@/lib/datos'
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

/**
 * OJO ANTES DE AGREGAR UN loading.tsx QUE ALCANCE A ESTA PANTALLA.
 *
 * Con un límite de Suspense por encima —da igual si está en (vigilador) o acá
 * mismo— esta pantalla nunca termina de aparecer: el servidor manda el HTML
 * completo, 42 KB con todo el contenido adentro, y el navegador se queda
 * mostrando el esqueleto para siempre. Sin errores en la consola, sin nada en
 * los registros del servidor, y con un 200 en el pedido.
 *
 * Comprobado: sacando el loading.tsx anda; con un loading.tsx de una sola línea
 * se cuelga igual, así que es el límite en sí y no lo que se dibuja. Las otras
 * seis pantallas del vigilador no tienen el problema, y /cargar/[tipo], que
 * también usa useActionState, tampoco.
 *
 * No se encontró la causa. Por eso el esqueleto quedó sólo en el panel de
 * coordinación y en /cargar/[tipo], que son los dos verificados. Una pantalla
 * que nunca carga es peor que una sin esqueleto.
 */
export default async function ConteoDelDia() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  // Una sola transacción para las dos consultas. Abrir una cuesta cuatro viajes
  // a la base (BEGIN, poner la identidad, la consulta, COMMIT) y el pool
  // serverless tiene una conexión sola, así que dos conSesion se hacen uno
  // después del otro aunque los envuelva un Promise.all. Sobre el mismo `tx`
  // viajan juntas y la pantalla paga el peaje una vez.
  const [sitios, conteos] = await conSesion(sesion, (tx) => Promise.all([
    sesion.sitioId
      ? tx.consultar<{ nombre: string; tipo: string; carga_detallada: boolean }>(
          'select nombre, tipo, carga_detallada from sitios where id = $1',
          [sesion.sitioId],
        )
      : Promise.resolve([]),
    conteosRecientesEnTx(tx, sesion, { dias: DIAS_ATRAS }),
  ]))

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
