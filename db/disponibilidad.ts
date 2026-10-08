/**
 * Cuándo un error quiere decir «la base no contesta», y no «la consulta está
 * mal».
 *
 * La diferencia importa en la pantalla. Next esconde los errores del servidor
 * detrás de un digest —un hash del mensaje— y lo único que llega al navegador
 * es eso, así que error.tsx no tiene cómo saber qué pasó y muestra siempre lo
 * mismo. Pero si el error ya trae un `digest` propio, Next lo respeta y lo pasa
 * tal cual. Con eso la pantalla puede decir algo cierto en el caso más común de
 * todos: la base pausada por Supabase después de una semana sin uso, que es lo
 * que pasó el 7/10/2026.
 *
 * Sin imports a propósito: lo usan db/client.ts del lado del servidor y
 * error.tsx del lado del navegador.
 */

export const BASE_NO_DISPONIBLE = 'BASE_NO_DISPONIBLE'

/** De postgres-js y de Node: no se llegó a hablar con la base, o se cortó. */
const CODIGOS_DE_CONEXION = new Set([
  'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED',
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE',
])

/**
 * SQLSTATE del propio Postgres: la clase 08 es «excepción de conexión»; 57P01 a
 * 57P03, que se está apagando o todavía arrancando (lo que contesta mientras
 * Supabase restaura un proyecto pausado); 53300, sin conexiones libres.
 */
const ESTADOS_SQL = /^(08...|57P0[123]|53300)$/

/**
 * El pooler de Supabase (Supavisor) no siempre manda un SQLSTATE útil: cuando
 * no encuentra la base del otro lado suele contestar con un XX000 genérico y el
 * motivo en el texto. No se pudo ver el mensaje exacto de un proyecto pausado
 * —el log del 7/10 no quedó—: si algún día aparece otro, va acá.
 */
const MENSAJES_DEL_POOLER = /tenant or user not found|tenant\/user .* not found|EDBHANDLEREXITED/i

export function esBaseNoDisponible(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  if ((e as { digest?: unknown }).digest === BASE_NO_DISPONIBLE) return true

  const codigo = (e as { code?: unknown }).code
  if (typeof codigo === 'string' && (CODIGOS_DE_CONEXION.has(codigo) || ESTADOS_SQL.test(codigo))) {
    return true
  }
  const mensaje = (e as { message?: unknown }).message
  return typeof mensaje === 'string' && MENSAJES_DEL_POOLER.test(mensaje)
}

/**
 * El mismo error, con el digest que reconoce error.tsx. El mensaje original
 * queda en el texto y en `cause`, que es lo que se lee en los registros de
 * Vercel; al navegador no llega ninguno de los dos.
 */
export function marcarBaseNoDisponible(e: unknown): Error {
  const original = e instanceof Error ? e : new Error(String(e))
  const marcado = new Error(`La base no contesta: ${original.message}`, { cause: original })
  ;(marcado as Error & { digest: string }).digest = BASE_NO_DISPONIBLE
  return marcado
}
