/**
 * Ejecuta consultas con la identidad del usuario puesta en la base.
 *
 * Antes de cada transacción se hace, dentro de la misma transacción:
 *     set local role authenticated
 *     set local request.jwt.claims = {"sub":…, "rol":…, "sitio_id":…}
 *
 * Es exactamente lo que hace Supabase con PostgREST, así que las políticas de
 * 0010_rls.sql se evalúan igual acá que en producción. Como el rol cambia a
 * `authenticated`, deja de ser dueño de las tablas y RLS sí se le aplica.
 *
 * `comoServicio` es la única puerta que esquiva las políticas y se usa solo
 * para el login (hay que leer el perfil antes de tener sesión), las
 * migraciones y la siembra de datos.
 */
import { obtenerBase, type Conexion } from './client'

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
    await tx.consultar(
      `select set_config('role', 'authenticated', true),
              set_config('request.jwt.claims', $1, true)`,
      [claims],
    )
    return fn(tx)
  })
}

/** Sin políticas. Solo login, migraciones y siembra. */
export async function comoServicio<T>(fn: (tx: Conexion) => Promise<T>): Promise<T> {
  const base = await obtenerBase()
  return base.transaccion(fn)
}

/** Una sola consulta con sesión, para los casos simples. */
export async function consultarConSesion<T = Record<string, unknown>>(
  sesion: Sesion,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return conSesion(sesion, (tx) => tx.consultar<T>(sql, params))
}
