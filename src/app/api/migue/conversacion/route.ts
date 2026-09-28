/**
 * La conversación con Migue que está en pantalla: leerla, empezar otra y
 * olvidarla.
 *
 *     GET  /api/migue/conversacion?dispositivo=<uuid>
 *            → { conversacionId, cerrada, mensajes, anteriores }
 *     POST /api/migue/conversacion   { accion: 'nueva' | 'olvidar', conversacionId }
 *            → { ok: true } | { ok: false, error }
 *
 * Es una ruta y no algo que arme la página por el celular. La conversación del
 * punto es del punto Y del teléfono, y el teléfono se reconoce por un uuid que
 * vive en su localStorage: el servidor no lo ve cuando arma la pantalla, así
 * que la conversación se pide después de montar, desde el navegador. En el
 * panel la página ya la trae armada y esto se usa para releerla después de
 * empezar otra o de olvidarla.
 *
 * Y el POST es una ruta y no una Server Action por lo mismo que explica
 * /api/contadores: la acción vuelve por la cola del router, y Next aprovecha
 * para volver a pedir ENTERA la pantalla que la llamó. En el celular eso es
 * bajar de nuevo la página, con 3G y en la calle, para tocar una sola fila; el
 * chat ya sabe qué cambió y el panel refresca su columna cuando hace falta.
 *
 * Las dos cosas del POST pasan por las funciones de la 0025, con la sesión de
 * quien pide: app.migue_cerrar y app.migue_olvidar_conversacion miran que la
 * conversación sea suya antes de tocar nada, y con una ajena contestan lo
 * mismo que con una que no existe.
 */
import { NextResponse } from 'next/server'
import { conSesion } from '@db/sesion'
import { migueEstaInstalado } from '@/lib/migue/configuracion'
import { duenoDeLaSesion, esUuid, estadoDeLaConversacion } from '@/lib/migue/historial'
import {
  ErrorCuentaIncompleta, ErrorSinPermiso, ErrorSinSesion, exigirAdminCompleto, sesionActual, type Sesion,
} from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * Nunca se guarda: es la charla de una persona, cambia con cada pregunta, y un
 * proxy que la sirviera vieja —o a otra cuenta— es justo lo que no puede
 * pasar.
 */
function respuesta(cuerpo: unknown, estado = 200) {
  return NextResponse.json(cuerpo, {
    status: estado,
    headers: { 'cache-control': 'no-store' },
  })
}

const SIN_SESION = 'Se cerró la sesión. Volvé a entrar.'

/**
 * Quién pide, o la respuesta que corresponde si no puede.
 *
 * El vigilador entra con su sesión y nada más. La coordinación, además, con la
 * cuenta completa: es el mismo portón que exigirPanel() en las pantallas, y
 * esta ruta no puede ser la rendija por la que una cuenta a medio configurar
 * lee lo que el panel todavía no le muestra.
 */
async function quienPide(): Promise<{ sesion: Sesion } | { corte: NextResponse }> {
  const sesion = await sesionActual()
  if (!sesion) return { corte: respuesta({ ok: false, error: SIN_SESION }, 401) }
  if (sesion.rol !== 'admin') return { sesion }

  try {
    return { sesion: await exigirAdminCompleto() }
  } catch (e) {
    if (e instanceof ErrorCuentaIncompleta) {
      return { corte: respuesta({ ok: false, error: 'Terminá de configurar tu cuenta en «Mi cuenta».' }, 403) }
    }
    if (e instanceof ErrorSinPermiso) return { corte: respuesta({ ok: false, error: 'No tenés permiso.' }, 403) }
    if (e instanceof ErrorSinSesion) return { corte: respuesta({ ok: false, error: SIN_SESION }, 401) }
    throw e
  }
}

export async function GET(pedido: Request) {
  const quien = await quienPide()
  if ('corte' in quien) return quien.corte

  const dispositivo = new URL(pedido.url).searchParams.get('dispositivo')
  const dueno = duenoDeLaSesion(quien.sesion, dispositivo)
  if (!dueno) {
    // Sólo le pasa al celular: sin el uuid del teléfono no hay forma de saber
    // cuál de las conversaciones del punto es la suya.
    return respuesta({ ok: false, error: 'Falta el identificador de este celular. Recargá la pantalla.' }, 400)
  }

  try {
    const estado = await estadoDeLaConversacion(quien.sesion, dueno)
    if (!estado) return respuesta({ ok: false, error: 'Migue todavía no está instalado.' }, 404)
    return respuesta(estado)
  } catch (e) {
    console.error('[migue/conversacion] no se pudo leer la conversación', e)
    return respuesta({ ok: false, error: 'No se pudo traer la conversación. Probá de nuevo en un rato.' }, 500)
  }
}

interface PedidoDeAccion {
  accion: 'nueva' | 'olvidar'
  conversacionId: string
}

function leerAccion(cuerpo: unknown): PedidoDeAccion | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null
  const { accion, conversacionId } = cuerpo as Record<string, unknown>
  if (accion !== 'nueva' && accion !== 'olvidar') return null
  if (!esUuid(conversacionId)) return null
  return { accion, conversacionId }
}

/** El SQLSTATE que ponen los dos drivers, PGlite y postgres-js, en el error. */
function codigoDeLaBase(e: unknown): string | null {
  const codigo = (e as { code?: unknown } | null)?.code
  return typeof codigo === 'string' ? codigo : null
}

/** Para salir de la transacción sin tocar nada cuando la 0025 no está. */
class MigueNoInstalado extends Error {
  constructor() { super('Migue no está instalado'); this.name = 'MigueNoInstalado' }
}

export async function POST(pedido: Request) {
  const quien = await quienPide()
  if ('corte' in quien) return quien.corte

  const leido = leerAccion(await pedido.json().catch(() => null))
  if (!leido) return respuesta({ ok: false, error: 'El pedido llegó incompleto. Recargá la pantalla.' }, 400)

  try {
    await conSesion(quien.sesion, async (tx) => {
      if (!(await migueEstaInstalado(tx))) throw new MigueNoInstalado()
      // Las dos son idempotentes: cerrar una cerrada o olvidar una olvidada no
      // cambia nada, así que el doble toque de un pulgar con guantes no rompe.
      await tx.consultar(
        leido.accion === 'nueva'
          ? `select app.migue_cerrar($1, 'nueva')`
          : 'select app.migue_olvidar_conversacion($1)',
        [leido.conversacionId],
      )
    })
    return respuesta({ ok: true })
  } catch (e) {
    if (e instanceof MigueNoInstalado) return respuesta({ ok: false, error: 'Migue todavía no está instalado.' }, 404)
    // insufficient_privilege es la guarda de la 0025: la sesión se cerró, o la
    // conversación no es de quien pide. El texto ya viene escrito para la
    // persona y no distingue «no es tuya» de «no está», a propósito.
    if (codigoDeLaBase(e) === '42501') {
      return respuesta({ ok: false, error: e instanceof Error ? e.message : 'Esa conversación no está.' }, 404)
    }
    console.error(`[migue/conversacion] no se pudo ${leido.accion === 'nueva' ? 'cerrar' : 'olvidar'}`, e)
    return respuesta({ ok: false, error: 'No se pudo. Probá de nuevo en un rato.' }, 500)
  }
}
