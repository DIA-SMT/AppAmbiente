/**
 * Conexión a la base.
 *
 * Sin DATABASE_URL corre sobre PGlite: Postgres real compilado a WASM, en una
 * carpeta del proyecto. No hace falta instalar ni levantar nada, y las mismas
 * migraciones y las mismas políticas de seguridad que van a producción se
 * ejecutan tal cual en la máquina de desarrollo.
 *
 * Con DATABASE_URL usa postgres-js contra Supabase o cualquier Postgres.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'

export interface Conexion {
  consultar<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  ejecutar(sql: string): Promise<void>
}

export interface Base extends Conexion {
  transaccion<T>(fn: (tx: Conexion) => Promise<T>): Promise<T>
  cerrar(): Promise<void>
  motor: 'pglite' | 'postgres'
}

const RUTA_PGLITE = path.join(process.cwd(), '.data', 'pglite')

async function crearPglite(): Promise<Base> {
  const { PGlite } = await import('@electric-sql/pglite')
  // PGlite crea su propia carpeta pero no las de arriba.
  mkdirSync(RUTA_PGLITE, { recursive: true })
  const pg = await PGlite.create(RUTA_PGLITE)

  const envolver = (c: { query: Function; exec: Function }): Conexion => ({
    async consultar<T>(sql: string, params: unknown[] = []) {
      const r = (await c.query(sql, params)) as { rows: T[] }
      return r.rows
    },
    async ejecutar(sql: string) {
      await c.exec(sql)
    },
  })

  const raiz = envolver(pg)
  const base: Base = {
    ...raiz,
    motor: 'pglite',
    async transaccion<T>(fn: (tx: Conexion) => Promise<T>) {
      const resultado = await pg.transaction(async (tx) => fn(envolver(tx as never)))
      return resultado as T
    },
    async cerrar() {
      await pg.close()
    },
  }

  // El servidor de desarrollo tiene su propia instancia en memoria: si la
  // migración corrió en otro proceso, éste no se entera. Migrar acá hace que
  // 'npm run dev' alcance para todo.
  const { aplicarMigraciones } = await import('./migraciones')
  await aplicarMigraciones(base, { silencioso: true })

  return base
}

async function crearPostgres(url: string): Promise<Base> {
  const { default: postgres } = await import('postgres')
  const local = url.includes('localhost') || url.includes('127.0.0.1')

  const sql = postgres(url, {
    /*
     * En Vercel cada función corre en su propia instancia y abre su propio
     * pool: diez conexiones por instancia agotan un Postgres chico apenas hay
     * algo de tráfico. Con una por instancia y el pooler del proveedor del otro
     * lado, el que reparte es el pooler, que es para lo que está.
     *
     * Fuera de serverless —un servidor propio, los comandos de db/cli— un pool
     * de verdad sí sirve.
     */
    max: process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME ? 1 : 10,
    /*
     * Las sentencias preparadas no sobreviven a un pooler en modo transacción,
     * que es como vienen Supabase y Neon por defecto.
     */
    prepare: false,
    // Cualquier Postgres remoto va por TLS; el local no lo tiene.
    ssl: local ? false : 'require',
    // Una función serverless no puede quedarse esperando una conexión colgada.
    connect_timeout: 10,
  })

  const envolver = (c: typeof sql): Conexion => ({
    async consultar<T>(texto: string, params: unknown[] = []) {
      return (await c.unsafe(texto, params as never[])) as unknown as T[]
    },
    async ejecutar(texto: string) {
      await c.unsafe(texto)
    },
  })

  const raiz = envolver(sql)
  return {
    ...raiz,
    motor: 'postgres',
    async transaccion<T>(fn: (tx: Conexion) => Promise<T>) {
      return (await sql.begin(async (tx) => fn(envolver(tx as never)))) as T
    },
    async cerrar() {
      await sql.end()
    },
  }
}

// Una sola instancia por proceso, y que sobreviva al recargado en caliente
// del servidor de desarrollo de Next.
const cache = globalThis as unknown as { __baseAmbiente?: Promise<Base> }

export function obtenerBase(): Promise<Base> {
  if (!cache.__baseAmbiente) {
    const url = process.env.DATABASE_URL?.trim()
    cache.__baseAmbiente = url ? crearPostgres(url) : crearPglite()
  }
  return cache.__baseAmbiente
}

export function describirMotor(): string {
  const url = process.env.DATABASE_URL?.trim()
  return url ? `Postgres (${new URL(url).host})` : `PGlite (${RUTA_PGLITE})`
}
