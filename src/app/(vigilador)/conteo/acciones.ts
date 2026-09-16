'use server'

/**
 * Guardar el conteo de vecinos de un día.
 *
 * Es un solo número por día y por punto: volver a cargar el mismo día corrige
 * lo que había, no agrega una segunda verdad sobre lo mismo. Eso lo resuelve
 * `guardarConteo`; acá solo se valida lo que llega del formulario y se arma la
 * frase que el vigilador lee después de tocar el botón.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { guardarConteo, mensajeDeError } from '@/lib/datos'
import { desdeInputFechaHora, diaSemana, numero, paraInputFechaHora } from '@/lib/formato'
import { sesionActual } from '@/lib/sesion'

export interface EstadoConteo {
  ok?: boolean
  /** Qué quedó guardado, para mostrarlo debajo del botón. */
  aviso?: string
  error?: string
  /** El día al que se refiere la respuesta: si el vigilador ya cambió de día, no se muestra. */
  fecha?: string
}

/** Hasta dónde para atrás deja la base cargar o corregir. Igual que en 0017. */
const DIAS_ATRAS = 7

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Hoy en Tucumán, como aaaa-mm-dd: el servidor puede estar en UTC. */
function hoyEnTucuman(): string {
  return paraInputFechaHora().slice(0, 10)
}

/**
 * El mediodía de una fecha de calendario en Tucumán.
 *
 * Un `aaaa-mm-dd` suelto se parsea como medianoche UTC, y visto desde Tucumán
 * (UTC−3) eso es el día anterior a las 21. Al mediodía no hay forma de que se
 * corra.
 */
function alMediodia(iso: string): Date | null {
  return desdeInputFechaHora(`${iso}T12:00`)
}

export async function guardarConteoDelDia(
  _previo: EstadoConteo,
  datos: FormData,
): Promise<EstadoConteo> {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  const fecha = String(datos.get('fecha') ?? '').trim()
  if (!FECHA.test(fecha)) {
    return { error: 'No se entendió qué día se está cargando. Recargá la pantalla.' }
  }

  const hoy = hoyEnTucuman()
  const mediodia = alMediodia(hoy)
  const masViejo = mediodia
    ? paraInputFechaHora(new Date(mediodia.getTime() - DIAS_ATRAS * 86_400_000)).slice(0, 10)
    : hoy

  // La base rechaza los dos casos, pero con un "no tenés permiso" que no
  // explica nada. Pasa de verdad cuando la pantalla quedó abierta desde ayer.
  if (fecha > hoy) return { error: 'Ese día todavía no pasó.', fecha }
  if (fecha < masViejo) {
    return {
      error: 'Solo se puede cargar o corregir hasta siete días para atrás. Pedile a la coordinadora que lo cargue.',
      fecha,
    }
  }

  const escrito = String(datos.get('vecinos') ?? '').trim()
  if (!escrito) {
    return { error: 'Escribí cuántos vecinos vinieron. Si no vino nadie, cargá 0.', fecha }
  }
  const vecinos = Number(escrito)
  if (!Number.isInteger(vecinos)) {
    return { error: 'La cantidad de vecinos tiene que ser un número entero.', fecha }
  }

  let guardado
  try {
    guardado = await guardarConteo(sesion, {
      fecha,
      vecinos,
      observaciones: String(datos.get('observaciones') ?? ''),
    })
  } catch (e) {
    return { error: mensajeDeError(e), fecha }
  }
  if (!guardado.ok) return { error: guardado.error, fecha }

  revalidatePath('/conteo')

  const cuenta = `${numero(vecinos)} ${vecinos === 1 ? 'vecino' : 'vecinos'}`
  // Los días viejos se cargan seguido —ayer quedó pendiente— y ahí el aviso
  // tiene que nombrar el día, o no se sabe qué se acaba de tocar.
  const cuando = fecha === hoy ? '' : ` del ${diaSemana(alMediodia(fecha)).replace(',', '')}`

  return {
    ok: true,
    fecha,
    aviso: guardado.corregido
      ? `Corregido: quedó en ${cuenta}${cuando}.`
      : `Guardado: ${cuenta}${cuando}.`,
  }
}
