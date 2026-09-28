/**
 * Ejecuta consultas con la identidad del usuario puesta en la base.
 *
 * Antes de cada transacción se hace, dentro de la misma transacción:
 *     set local role authenticated
 *     set local request.jwt.claims = {"sub":…, "rol":…, "sitio_id":…}
 *     set local timezone = 'America/Argentina/Tucuman'
 *
 * Es exactamente lo que hace Supabase con PostgREST, así que las políticas de
 * 0010_rls.sql se evalúan igual acá que en producción. Como el rol cambia a
 * `authenticated`, deja de ser dueño de las tablas y RLS sí se le aplica.
 *
 * La zona no es de PostgREST: la pone esta app, y es la que decide dónde
 * termina un día. Supabase y PGlite corren en UTC, y todo lo que la base corta
 * por día o por mes —`::date`, `date_trunc`, `current_date`, un 'aaaa-mm-dd'
 * pasado a timestamptz, las vistas de la 0011 a la 0020— lo cortaba a la
 * medianoche de UTC, que en Tucumán son las 21 del día anterior. Una salida del
 * 31/08 a las 22:00 contaba en septiembre en el tablero y en /movimientos, y de
 * las 21 en adelante `current_date` ya era mañana: una pila que maduraba al día
 * siguiente ya decía «Madura hoy». Con la zona puesta, cada uno de esos cortes
 * cae a la medianoche de Tucumán sin tocar una sola consulta.
 *
 * Va con `true`, local a la transacción, porque es lo único que sobrevive al
 * pooler de Supabase en modo transacción (puerto 6543). Ahí cada transacción
 * puede caer en una conexión distinta: un `SET` de sesión se queda en la
 * conexión donde se hizo, que el próximo pedido capaz no agarra. El pooler
 * reparte transacciones, no sesiones, y lo único que se puede dar por puesto es
 * lo que dura lo mismo que una.
 *
 * `comoServicio` es la única puerta que esquiva las políticas. La usan el
 * login y la sesión de cada pedido (hay que leer el perfil antes de tener
 * sesión), /api/salud y los comandos de db/cli, y la zona la pone igual: esos
 * también tienen que cortar los días como las pantallas.
 *
 * Las migraciones no pasan por ninguna de las dos: corren con la zona del
 * servidor, lo mismo que cuando se pegan en el editor del proveedor. Una
 * migración que corte días tiene que escribir la zona ella misma.
 */
import { obtenerBase, type Conexion } from './client'
import { ZONA } from '../src/lib/formato'

export interface Sesion {
  perfilId: string
  rol: 'admin' | 'vigilador'
  sitioId: string | null
  nombre: string
}

export async function conSesion<T>(
  sesion: Sesion,
  fn: (tx: Conexion) => Promise<T>,
): Promise<T> {
  const base = await obtenerBase()
  const claims = JSON.stringify({
    sub: sesion.perfilId,
    rol: sesion.rol,
    sitio_id: sesion.sitioId ?? '',
  })

  return base.transaccion(async (tx) => {
    // En el mismo select que la identidad: la zona no agrega un viaje.
    await tx.consultar(
      `select set_config('role', 'authenticated', true),
              set_config('request.jwt.claims', $1, true),
              set_config('TimeZone', $2, true)`,
      [claims, ZONA],
    )
    return fn(tx)
  })
}

/** Sin políticas: el login, la sesión de cada pedido, /api/salud y db/cli. */
export async function comoServicio<T>(fn: (tx: Conexion) => Promise<T>): Promise<T> {
  const base = await obtenerBase()
  return base.transaccion(async (tx) => {
    // Primera sentencia, pero sin esperarla: sesionActual() pasa por acá en
    // cada pedido del panel y del celular, y esperar la respuesta de un
    // set_config sería un viaje más a la base en todas las pantallas. Mandada
    // primero viaja encauzada con la consulta que sigue —los dos motores
    // respetan el orden adentro de una transacción, que es lo mismo que
    // aprovechan las lecturas del tablero—, y el Promise.all hace que un error
    // de cualquiera de las dos llegue igual.
    const zona = tx.consultar(`select set_config('TimeZone', $1, true)`, [ZONA])
    const [, resultado] = await Promise.all([zona, fn(tx)])
    return resultado
  })
}

/** Una sola consulta con sesión, para los casos simples. */
export async function consultarConSesion<T = Record<string, unknown>>(
  sesion: Sesion,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return conSesion(sesion, (tx) => tx.consultar<T>(sql, params))
}
