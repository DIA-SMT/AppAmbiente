/**
 * Donde se le pregunta a Migue.
 *
 *     POST /api/migue   { conversacionId, preguntaId, pregunta, dispositivoId, pendientesEnElCelular }
 *                       →  text/event-stream: un evento por línea, «data: {…}»
 *     GET  /api/migue?pregunta=<id>[&conversacion=<id>]
 *                       →  { estado: 'hecha', conversacionId, texto, enlaces }
 *                        | { estado: 'en_curso', conversacionId }
 *                        | { estado: 'no_esta' }
 *
 * Es una ruta y no una Server Action por dos motivos. El primero es el mismo de
 * /api/contadores: una acción llamada desde el navegador vuelve por la cola del
 * router y, al terminar, Next vuelve a pedir la pantalla entera. El segundo es
 * propio: la respuesta tarda entre dos y veinte segundos, y mientras tanto la
 * persona tiene que ver qué se está haciendo («Buscando en los movimientos de
 * la Planta…»). Eso es un flujo de eventos, y una acción devuelve una sola vez.
 *
 * La respuesta NO se manda de a pedazos a medida que el modelo la escribe: se
 * manda entera cuando ya pasó el control de números. Un número sin respaldo no
 * puede estar en pantalla ni un segundo, porque alguien lo lee y lo usa.
 *
 * Si el celular pierde la señal a mitad de camino, la pregunta sigue: `after()`
 * le pide a Vercel que no corte la función cuando se va el que preguntó, así el
 * turno se termina de guardar. Al volver la señal, el chat pregunta por GET
 * con el mismo id y recibe lo que se contestó, sin volver a pagarlo. El GET y
 * el POST buscan la pregunta por su id en todas las conversaciones de quien
 * pregunta, no sólo en la que dice el chat, y dicen en cuál estaba: el
 * servidor puede haberla pasado a una nueva y el aviso haberse perdido con la
 * señal.
 */
import { after, NextResponse } from 'next/server'

import { conSesion, type Sesion } from '@db/sesion'
import { buscarPregunta } from '@/lib/migue/conversacion'
import { responder } from '@/lib/migue/orquestador'
import type { EventoDeMigue, PedidoAMigue } from '@/lib/migue/tipos'
import {
  ErrorCuentaIncompleta,
  ErrorSinPermiso,
  ErrorSinSesion,
  exigirAdminCompleto,
  sesionActual,
} from '@/lib/sesion'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/**
 * 60 segundos: lo que admite cualquier plan de Vercel. Con gpt-4o-mini una
 * pregunta completa, con dos o tres consultas, tarda de dos a diez. El
 * orquestador le da a la pregunta entera 52 (PLAZO_DE_LA_PREGUNTA_MS), y cada
 * llamada al modelo con sus reintentos termina adentro: lo que sobra es para
 * guardar el turno o soltar el reclamo antes de que Vercel corte.
 */
export const maxDuration = 60

/** Más que suficiente para la pregunta más larga que acepta el chat. */
const CUERPO_MAXIMO = 4_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(cuerpo: unknown, estado = 200) {
  return NextResponse.json(cuerpo, { status: estado, headers: { 'cache-control': 'no-store' } })
}

/**
 * La sesión, con el mismo portón que el resto: el vigilador con su sesión, y la
 * coordinación con la cuenta completa. Una cuenta de coordinación a medio
 * configurar no tiene que poder usar a Migue por la puerta de atrás mientras
 * el panel la tiene retenida en /cuenta.
 */
async function sesionDeQuienPregunta(): Promise<{ sesion: Sesion } | { error: Response }> {
  const sesion = await sesionActual()
  if (!sesion) return { error: json({ error: 'Se cerró la sesión. Volvé a entrar.' }, 401) }
  if (sesion.rol === 'vigilador') return { sesion }
  try {
    return { sesion: await exigirAdminCompleto() }
  } catch (e) {
    if (e instanceof ErrorCuentaIncompleta || e instanceof ErrorSinPermiso) {
      return { error: json({ error: 'Completá tu cuenta antes de usar a Migue.' }, 403) }
    }
    if (e instanceof ErrorSinSesion) return { error: json({ error: 'Se cerró la sesión. Volvé a entrar.' }, 401) }
    throw e
  }
}

/**
 * Que el pedido venga de esta misma aplicación. Es un POST que viaja con la
 * cookie de sesión, así que otra página podría intentar mandarlo en nombre de
 * quien la visita. Dos barandas: el navegador manda siempre el Origin en un
 * POST, y un formulario de otra página no puede mandar JSON sin que el
 * navegador pida permiso antes, cosa que esta ruta nunca da.
 */
function vieneDeAca(pedido: Request): boolean {
  const tipo = pedido.headers.get('content-type') ?? ''
  if (!tipo.toLowerCase().startsWith('application/json')) return false
  const origen = pedido.headers.get('origin')
  if (!origen) return true
  const anfitrion = pedido.headers.get('x-forwarded-host') ?? pedido.headers.get('host')
  try {
    return new URL(origen).host === anfitrion
  } catch {
    return false
  }
}

export async function POST(pedido: Request) {
  if (!vieneDeAca(pedido)) return json({ error: 'Pedido rechazado.' }, 403)

  const quien = await sesionDeQuienPregunta()
  if ('error' in quien) return quien.error
  const { sesion } = quien

  const texto = await pedido.text().catch(() => '')
  if (texto.length > CUERPO_MAXIMO) return json({ error: 'La pregunta es demasiado larga.' }, 413)

  let cuerpo: Partial<PedidoAMigue>
  try {
    cuerpo = JSON.parse(texto) as Partial<PedidoAMigue>
  } catch {
    return json({ error: 'El pedido llegó mal armado. Recargá la página.' }, 400)
  }

  const datos: PedidoAMigue = {
    conversacionId: typeof cuerpo.conversacionId === 'string' ? cuerpo.conversacionId : null,
    preguntaId: typeof cuerpo.preguntaId === 'string' ? cuerpo.preguntaId : '',
    pregunta: typeof cuerpo.pregunta === 'string' ? cuerpo.pregunta : '',
    dispositivoId: typeof cuerpo.dispositivoId === 'string' ? cuerpo.dispositivoId : null,
    pendientesEnElCelular: typeof cuerpo.pendientesEnElCelular === 'number' ? cuerpo.pendientesEnElCelular : 0,
  }

  const codificador = new TextEncoder()
  let abierto = true

  const flujo = new ReadableStream<Uint8Array>({
    start(controlador) {
      const emitir = (evento: EventoDeMigue) => {
        if (!abierto) return
        try {
          controlador.enqueue(codificador.encode(`data: ${JSON.stringify(evento)}\n\n`))
        } catch {
          // Se fue el que preguntaba. La pregunta sigue: ver el encabezado.
          abierto = false
        }
      }

      const trabajo = responder(datos, sesion, emitir)
        .catch((e) => {
          console.error('[migue] la pregunta terminó con un error no previsto', e)
          emitir({ tipo: 'error', texto: 'Algo falló de mi lado. Probá de nuevo.', reintentar: true })
        })
        .finally(() => {
          if (!abierto) return
          abierto = false
          try {
            controlador.close()
          } catch {
            // Ya estaba cerrado.
          }
        })

      after(trabajo)
    },
    cancel() {
      abierto = false
    },
  })

  return new Response(flujo, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      // Para que ningún proxy en el medio junte los eventos y los mande todos al final.
      'x-accel-buffering': 'no',
    },
  })
}

export async function GET(pedido: Request) {
  const quien = await sesionDeQuienPregunta()
  if ('error' in quien) return quien.error

  // `conversacion` se acepta y no se usa: la pregunta se busca en todas las
  // del dueño, porque el servidor puede haberla pasado a otra sin que el chat
  // se entere (ver buscarPregunta). Lo que se devuelve dice dónde estaba.
  const preguntaId = new URL(pedido.url).searchParams.get('pregunta') ?? ''
  if (!UUID.test(preguntaId)) return json({ estado: 'no_esta' })

  try {
    const encontrada = await conSesion(quien.sesion, (tx) => buscarPregunta(tx, preguntaId, null))
    return json(encontrada ?? { estado: 'no_esta' })
  } catch (e) {
    console.error('[migue] no se pudo recuperar la pregunta', e)
    return json({ estado: 'no_esta' })
  }
}
