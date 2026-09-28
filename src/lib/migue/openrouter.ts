/**
 * El único lugar que habla con OpenRouter.
 *
 * Es el formato de chat de OpenAI, que es el que expone OpenRouter para todos
 * los modelos: mensajes, herramientas y, en la respuesta, los pedidos de
 * consulta con sus argumentos en texto. Va con fetch y no con un paquete: es
 * un solo pedido, y lo que un paquete agregaría —reintentos, un tiempo
 * máximo— son veinte líneas que acá se ven enteras.
 *
 * Tres cosas que se le piden al proveedor en cada pedido y por qué:
 *
 *  · `provider.data_collection: "deny"`: que OpenRouter mande la pregunta sólo
 *    a proveedores que no guardan ni entrenan con lo que reciben. Es un
 *    organismo público y la pregunta puede traer datos de la operación.
 *    Probado el 28/09/2026: con esto, gpt-4o-mini sigue yendo a OpenAI.
 *  · Herramientas con `strict: true`: el proveedor garantiza que los
 *    argumentos cumplan el esquema. Probado con gpt-4o-mini.
 *  · Nada de `require_parameters`: con eso, pedir razonamiento a un modelo que
 *    no razona deja la pregunta sin ningún proveedor posible (404). Sin eso, el
 *    parámetro que el modelo no entiende se ignora.
 *
 * El costo NO se calcula acá: OpenRouter lo devuelve en cada respuesta, en
 * `usage.cost`, en créditos que valen un dólar cada uno y con el descuento de
 * la caché ya aplicado. Comprobado contra el precio publicado de gpt-4o-mini.
 */
import 'server-only'

import type { Esfuerzo } from './configuracion'
import type { DefinicionDeHerramienta, LlamadaDeHerramienta, MensajeDelModelo } from './tipos'

const URL_CHAT = 'https://openrouter.ai/api/v1/chat/completions'

/** Por intento, como mucho. Si al plazo de la pregunta le queda menos, es lo que le queda. */
const TIEMPO_MAXIMO_MS = 25_000
/** Esperas antes de cada reintento. Dos reintentos y no más: la persona está esperando. */
const ESPERAS_MS = [1_500, 4_000]
/**
 * Lo mínimo que tiene que quedar del plazo, además de la espera, para que valga
 * la pena reintentar. Con menos, el intento nuevo se cortaría antes de que el
 * modelo llegue a contestar, y sería gastar una llamada para nada.
 */
const TIEMPO_MINIMO_DE_UN_INTENTO_MS = 8_000

export interface PedidoAlModelo {
  clave: string
  modelo: string
  mensajes: MensajeDelModelo[]
  herramientas: DefinicionDeHerramienta[]
  esfuerzo: Esfuerzo | null
  maxTokens: number
  /**
   * Hasta cuándo puede tardar esta llamada con sus reintentos, en milisegundos
   * de Date.now(). Lo pone el orquestador con el plazo de la pregunta entera:
   * con 25 s por intento y dos reintentos, una sola llamada podía tardar 80 s,
   * y la función de Vercel tiene 60. Vercel la mataba con el reclamo tomado,
   * sin soltarlo ni avisar el error, y el chat se quedaba cinco minutos
   * diciendo que Migue seguía buscando.
   */
  plazo: number
}

export interface RespuestaDelModelo {
  contenido: string | null
  llamadas: LlamadaDeHerramienta[]
  /** stop, tool_calls, length, content_filter. */
  fin: string
  modeloServido: string
  proveedor: string
  /** Tokens de entrada de esta llamada, contando lo leído de la caché. */
  tokensDeEntrada: number
  costoUsd: number
  /** El `usage` entero, tal como vino, para guardarlo. */
  uso: unknown
}

/** Un error con lo que hay que decirle a la persona y si tiene sentido reintentar. */
export class ErrorDelProveedor extends Error {
  constructor(
    readonly estado: number,
    readonly paraLaPersona: string,
    readonly reintentable: boolean,
    detalle: string,
  ) {
    super(detalle)
  }
}

function errorSegunEstado(estado: number, detalle: string): ErrorDelProveedor {
  switch (estado) {
    case 401:
    case 403:
      return new ErrorDelProveedor(estado, 'Migue no puede entrar al proveedor: la clave no es válida. Avisale a la Dirección de IA.', false, detalle)
    case 402:
      return new ErrorDelProveedor(estado, 'Se terminó el crédito de OpenRouter. Hasta que lo carguen, Migue no puede contestar.', false, detalle)
    case 404:
      return new ErrorDelProveedor(estado, 'El modelo configurado no está disponible con las condiciones pedidas. Avisale a la Dirección de IA.', false, detalle)
    case 408:
    case 429:
    case 500:
    case 502:
    case 503:
    case 524:
    case 529:
      return new ErrorDelProveedor(estado, 'El proveedor está saturado. Probá de nuevo en un rato.', true, detalle)
    default:
      return new ErrorDelProveedor(estado, 'Migue no pudo contestar esta vez. Probá de nuevo.', false, detalle)
  }
}

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))

async function unIntento(pedido: PedidoAlModelo): Promise<RespuestaDelModelo> {
  const tiempo = Math.min(TIEMPO_MAXIMO_MS, pedido.plazo - Date.now())
  if (tiempo <= 0) throw tiempoAgotado()
  let respuesta: Response
  try {
    respuesta = await fetch(URL_CHAT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${pedido.clave}`,
        'content-type': 'application/json',
        // Sólo para que en el panel de OpenRouter se vea qué aplicación gastó.
        'x-title': 'Migue - Residuos SMT',
      },
      body: JSON.stringify({
        model: pedido.modelo,
        messages: pedido.mensajes,
        tools: pedido.herramientas,
        tool_choice: 'auto',
        max_tokens: pedido.maxTokens,
        provider: { data_collection: 'deny' },
        ...(pedido.esfuerzo ? { reasoning: { effort: pedido.esfuerzo } } : {}),
      }),
      signal: AbortSignal.timeout(tiempo),
    })
  } catch (e) {
    // Sin respuesta: corte de red o tiempo agotado. Se puede reintentar.
    if (e instanceof Error && e.name === 'TimeoutError') throw tiempoAgotado()
    throw new ErrorDelProveedor(0, 'No se pudo hablar con el proveedor. Probá de nuevo en un rato.', true, String(e))
  }

  const cuerpo = (await respuesta.json().catch(() => null)) as {
    error?: { code?: number; message?: string }
    model?: string
    provider?: string
    choices?: Array<{
      finish_reason?: string
      message?: { content?: string | null; tool_calls?: LlamadaDeHerramienta[] }
    }>
    usage?: { prompt_tokens?: number; cost?: number }
  } | null

  if (!respuesta.ok || !cuerpo || cuerpo.error) {
    const estado = cuerpo?.error?.code ?? respuesta.status
    throw errorSegunEstado(respuesta.ok ? estado : respuesta.status, cuerpo?.error?.message ?? `HTTP ${respuesta.status}`)
  }

  const eleccion = cuerpo.choices?.[0]
  if (!eleccion?.message) {
    throw new ErrorDelProveedor(502, 'El proveedor devolvió una respuesta vacía. Probá de nuevo.', true, 'sin choices')
  }

  return {
    contenido: eleccion.message.content ?? null,
    llamadas: eleccion.message.tool_calls ?? [],
    fin: eleccion.finish_reason ?? '',
    modeloServido: cuerpo.model ?? pedido.modelo,
    proveedor: cuerpo.provider ?? '',
    tokensDeEntrada: cuerpo.usage?.prompt_tokens ?? 0,
    // Si algún día no viene, se cuenta como caro y no como gratis: el tope
    // tiene que frenar de más antes que de menos.
    costoUsd: typeof cuerpo.usage?.cost === 'number' ? cuerpo.usage.cost : 0.05,
    uso: cuerpo.usage ?? null,
  }
}

/**
 * El mismo mensaje sea el tiempo de un intento o el de la pregunta entera: para
 * la persona es lo mismo, y el detalle 'tiempo agotado' es el que el
 * orquestador no manda al registro de errores, porque no es un error de nadie.
 */
function tiempoAgotado(): ErrorDelProveedor {
  return new ErrorDelProveedor(0, 'Tardé demasiado en armar la respuesta. Probá de nuevo en un rato.', true, 'tiempo agotado')
}

export async function preguntarAlModelo(pedido: PedidoAlModelo): Promise<RespuestaDelModelo> {
  for (let intento = 0; ; intento++) {
    try {
      return await unIntento(pedido)
    } catch (e) {
      if (!(e instanceof ErrorDelProveedor) || !e.reintentable || intento >= ESPERAS_MS.length) throw e
      // Sin tiempo para esperar y probar otra vez, no se empieza: mejor avisar
      // ahora que dejar que Vercel corte la función a mitad del intento.
      if (pedido.plazo - Date.now() < ESPERAS_MS[intento] + TIEMPO_MINIMO_DE_UN_INTENTO_MS) throw e
      await esperar(ESPERAS_MS[intento])
    }
  }
}
