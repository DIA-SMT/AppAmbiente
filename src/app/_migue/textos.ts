import 'server-only'
/**
 * Lo que la conversación con Migue dice según quién la usa: las preguntas de
 * ejemplo, qué se guarda y por cuánto, y qué se muestra cuando no contesta.
 *
 * Está escrito una vez porque la conversación se arma en dos lugares por rol:
 * la pantalla entera (/migue, /preguntar) y la burbuja que flota en las demás.
 * Dos copias de la frase de privacidad terminan diciendo dos plazos distintos.
 */
import type { Conexion } from '@db/client'
import { numero } from '@/lib/formato'
import { leerConfiguracion } from '@/lib/migue/configuracion'
import { DIAS_DE_CONVERSACION_DE_COORDINACION, HORAS_DE_CONVERSACION_DEL_PUNTO } from '@/lib/reglas'
import type { PropsDeConversacion } from './Conversacion'

type Apagado = PropsDeConversacion['apagado']

// ── Coordinación ────────────────────────────────────────────────────────

/**
 * Preguntas para arrancar. Son de las que el relevamiento encontró que la
 * coordinación hace de verdad, y cada una cae en una pantalla que ya existe:
 * un ejemplo que Migue no puede contestar enseña, de entrada, a no creerle.
 */
export const EJEMPLOS_DEL_PANEL = [
  '¿Qué puntos hace días que no cargan nada?',
  '¿Cuánto entró a la Planta el mes pasado?',
  '¿Qué pedidos de recambio están demorados?',
  '¿Cuántas salidas no dicen de qué pila salieron?',
]

export const PRIVACIDAD_DEL_PANEL =
  `Tus conversaciones son sólo tuyas y se borran solas a los ${numero(DIAS_DE_CONVERSACION_DE_COORDINACION)} días.`

/**
 * Apagado no es escondido: sin clave o con el tope de gasto mal puesto,
 * Migue no contesta, pero lo que ya se habló se sigue viendo y se puede
 * olvidar. La coordinación es quien lo puede arreglar, así que acá sí se
 * dice qué falta con el nombre de la variable.
 */
export function apagadoDelPanel(): Apagado {
  const { problemas } = leerConfiguracion()
  return problemas.length > 0
    ? { titulo: 'Migue no está contestando. Falta arreglar esto en la configuración:', detalle: problemas }
    : null
}

// ── El celular ──────────────────────────────────────────────────────────

export interface SitioDelPunto {
  id: string
  tipo: 'planta' | 'punto_verde'
  carga_detallada: boolean
}

export async function sitioDelPuntoEnTx(tx: Conexion, sitioId: string): Promise<SitioDelPunto | null> {
  const [sitio] = await tx.consultar<SitioDelPunto>(
    'select id, tipo, carga_detallada from sitios where id = $1',
    [sitioId],
  )
  return sitio ?? null
}

/**
 * Las preguntas de ejemplo de un celular recién estrenado, según qué se hace
 * en ese punto.
 *
 * Salen de cómo pregunta de verdad el vigilador (relevamiento, preguntas V1 a
 * V18) y cada una tiene con qué contestarse desde el celular. Ninguna pide lo
 * del mes: el celular ve 48 horas, y un ejemplo que termina en «eso no lo
 * puedo ver desde acá» enseña a no preguntar. Tampoco las pilas: los volteos
 * que se anotan desde el celular todavía no llegan al tablero de pilas.
 */
export function ejemplosDelPunto(sitio: SitioDelPunto): string[] {
  if (sitio.tipo === 'planta') {
    return [
      '¿Qué cargué hoy?',
      '¿Cuál fue el número del último que cargué?',
      'Me equivoqué en la última carga, ¿la puedo deshacer?',
      '¿Cuántos metros cúbicos es un camión?',
    ]
  }
  // Donde no se carga de a un vecino, el conteo del día es lo que se hace con
  // el sistema, y el recambio lo otro (el mismo orden que en /turno).
  if (!sitio.carga_detallada) {
    return [
      '¿Cuántos vecinos puse en el conteo de ayer?',
      'Me equivoqué en el conteo de ayer, ¿lo puedo corregir?',
      '¿Ya pedí el recambio del cartón?',
      '¿Qué contenedores tengo acá?',
    ]
  }
  return [
    '¿Qué cargué hoy?',
    '¿Ya pedí el recambio del cartón?',
    'Me equivoqué en la última carga, ¿la puedo deshacer?',
    '¿Qué contenedores tengo acá?',
  ]
}

export const PRIVACIDAD_DEL_PUNTO =
  `Lo que escribas lo ve cualquiera que use la cuenta del punto, durante ${HORAS_DE_CONVERSACION_DEL_PUNTO} horas. ` +
  'No pongas datos de vecinos.'

/**
 * Al vigilador no le sirve el nombre de una variable de entorno: le sirve
 * saber que lo suyo, cargar, anda igual. El motivo exacto lo ve la
 * coordinación en su pantalla y en /api/salud.
 */
export function apagadoDelPunto(): Apagado {
  return leerConfiguracion().problemas.length > 0
    ? {
        titulo: 'Migue no está contestando por ahora.',
        detalle: ['Cargar anda igual que siempre. Si sigue así, avisale a la coordinación.'],
      }
    : null
}
