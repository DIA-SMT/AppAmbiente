/**
 * Los números que van al lado de «Revisiones», «Recambios» y «Migue» en la barra.
 *
 *     GET /api/contadores  →  { "pendientes": 3, "recambios": 7, "expresiones": 2 }
 *
 * Es una ruta y no dos Server Actions porque el costo estaba en cómo se pedían,
 * no en qué se pedía. Una Server Action llamada desde el navegador vuelve por
 * la cola del router de Next, y Next aprovecha esa respuesta para revalidar: al
 * terminar, vuelve a pedir ENTERA la pantalla que acababa de llegar. Eran dos
 * acciones encadenadas más una pantalla de más, en cada cambio de sección. Un
 * fetch común no entra en esa cola y no dispara nada.
 *
 * Los conteos van dentro de una sola llamada a conSesion y lanzados juntos:
 * abrir una transacción son cuatro viajes a la base (BEGIN, identidad, consulta,
 * COMMIT) y el pool serverless tiene una sola conexión, así que dos
 * transacciones costaban el doble que una. Sobre el mismo `tx` las cuentas se
 * encauzan y viajan juntas.
 *
 * Los números no se calculan en el layout del panel a propósito: los layouts no
 * se vuelven a renderizar al navegar entre secciones hermanas, y el número
 * quedaría congelado en el que había al entrar. Que la barra los pida al montar
 * y en cada cambio de sección es justamente lo que los mantiene frescos.
 *
 * Solo coordinación, y las consultas pasan por conSesion con la identidad
 * puesta, así que las políticas de la base vuelven a filtrar.
 */
import { NextResponse } from 'next/server'
import { conSesion } from '@db/sesion'
import { migueEstaInstalado } from '@/lib/migue/configuracion'
import { ErrorCuentaIncompleta, ErrorSinPermiso, ErrorSinSesion, exigirAdminCompleto } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

interface Cuentas {
  pendientes: number
  recambios: number
  /** Las palabras que Migue propuso y nadie revisó todavía. */
  expresiones: number
}

const EN_CERO: Cuentas = { pendientes: 0, recambios: 0, expresiones: 0 }

/**
 * Nunca se guarda: son números que cambian con cada alta de la calle, con cada
 * pedido de contenedor y con cada palabra que propone Migue, y mostrarlos
 * viejos es peor que no mostrarlos.
 */
function respuesta(cuentas: Cuentas, estado = 200) {
  return NextResponse.json(cuentas, {
    status: estado,
    headers: { 'cache-control': 'no-store' },
  })
}

export async function GET() {
  let sesion
  try {
    sesion = await exigirAdminCompleto()
  } catch (e) {
    // Sin sesión o sin permiso la barra se queda sin números y sigue andando,
    // que es lo mismo que hacía antes: un contador no justifica romper el panel.
    // La cuenta a medio configurar cuenta como sin permiso: mientras esté en
    // /cuenta no tiene barra que llenar, y este camino no puede ser la rendija
    // por la que el panel igual le contesta.
    if (e instanceof ErrorCuentaIncompleta) return respuesta(EN_CERO, 403)
    if (e instanceof ErrorSinPermiso) return respuesta(EN_CERO, 403)
    if (e instanceof ErrorSinSesion) return respuesta(EN_CERO, 401)
    throw e
  }

  try {
    // Las altas de la calle sin revisar y los pedidos de recambio que todavía
    // no terminaron. Son las mismas dos cuentas de siempre: «pedido» y
    // «avisado» van juntos porque el rótulo de la barra dice «pendientes».
    const [pendientes, recambios, expresiones] = await conSesion(sesion, (tx) => Promise.all([
      tx.consultar<{ total: number }>(
        `select count(*)::int as total from entidades
          where pendiente_revision and activo`,
      ),
      tx.consultar<{ total: number }>(
        `select count(*)::int as total from pedidos_recambio
          where estado in ('pedido', 'avisado')`,
      ),
      // Sólo si la base tiene la 0025, y preguntándolo antes. Nombrar
      // migue_expresiones sin ella no rompe sólo esta cuenta: aborta la
      // transacción entera, y con ella se van a cero Revisiones y Recambios,
      // que son los números que hacen que alguien entre. Una vez que la sonda
      // dijo que sí ya no consulta, así que la cuenta sale en el mismo viaje
      // que las otras dos.
      migueEstaInstalado(tx).then((hay) => hay
        ? tx.consultar<{ total: number }>(
            `select count(*)::int as total from migue_expresiones where estado = 'propuesta'`,
          )
        : [{ total: 0 }]),
    ]))

    return respuesta({
      pendientes: pendientes[0]?.total ?? 0,
      recambios: recambios[0]?.total ?? 0,
      expresiones: expresiones[0]?.total ?? 0,
    })
  } catch (e) {
    console.error('[contadores] no se pudieron contar', e)
    return respuesta(EN_CERO)
  }
}
