/**
 * Los dos números que van al lado de «Revisiones» y «Recambios» en la barra.
 *
 *     GET /api/contadores  →  { "pendientes": 3, "recambios": 7 }
 *
 * Es una ruta y no dos Server Actions porque el costo estaba en cómo se pedían,
 * no en qué se pedía. Una Server Action llamada desde el navegador vuelve por
 * la cola del router de Next, y Next aprovecha esa respuesta para revalidar: al
 * terminar, vuelve a pedir ENTERA la pantalla que acababa de llegar. Eran dos
 * acciones encadenadas más una pantalla de más, en cada cambio de sección. Un
 * fetch común no entra en esa cola y no dispara nada.
 *
 * Los dos conteos van dentro de una sola llamada a conSesion y lanzados juntos:
 * abrir una transacción son cuatro viajes a la base (BEGIN, identidad, consulta,
 * COMMIT) y el pool serverless tiene una sola conexión, así que dos
 * transacciones costaban el doble que una. Sobre el mismo `tx` las dos cuentas
 * se encauzan y viajan juntas.
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
import { ErrorCuentaIncompleta, ErrorSinPermiso, ErrorSinSesion, exigirAdminCompleto } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

interface Cuentas {
  pendientes: number
  recambios: number
}

/**
 * Nunca se guarda: son dos números que cambian con cada alta de la calle y con
 * cada pedido de contenedor, y mostrarlos viejos es peor que no mostrarlos.
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
    if (e instanceof ErrorCuentaIncompleta) return respuesta({ pendientes: 0, recambios: 0 }, 403)
    if (e instanceof ErrorSinPermiso) return respuesta({ pendientes: 0, recambios: 0 }, 403)
    if (e instanceof ErrorSinSesion) return respuesta({ pendientes: 0, recambios: 0 }, 401)
    throw e
  }

  try {
    // Las altas de la calle sin revisar y los pedidos de recambio que todavía
    // no terminaron. Son las mismas dos cuentas de siempre: «pedido» y
    // «avisado» van juntos porque el rótulo de la barra dice «pendientes».
    const [pendientes, recambios] = await conSesion(sesion, (tx) => Promise.all([
      tx.consultar<{ total: number }>(
        `select count(*)::int as total from entidades
          where pendiente_revision and activo`,
      ),
      tx.consultar<{ total: number }>(
        `select count(*)::int as total from pedidos_recambio
          where estado in ('pedido', 'avisado')`,
      ),
    ]))

    return respuesta({
      pendientes: pendientes[0]?.total ?? 0,
      recambios: recambios[0]?.total ?? 0,
    })
  } catch (e) {
    console.error('[contadores] no se pudieron contar', e)
    return respuesta({ pendientes: 0, recambios: 0 })
  }
}
