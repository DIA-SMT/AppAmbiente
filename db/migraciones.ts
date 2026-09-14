/**
 * Aplicador de migraciones.
 *
 * Vive separado del CLI porque también lo usa db/client.ts: con PGlite, el
 * servidor de desarrollo tiene su propia instancia en memoria y no se entera de
 * una migración que corrió en otro proceso. Migrar al abrir la conexión hace que
 * `npm run dev` alcance para todo y evita que dos procesos escriban la misma
 * carpeta de datos.
 *
 * Contra un Postgres de verdad esto NO corre solo: migrar producción es una
 * decisión, no un efecto secundario de levantar la app.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Base } from './client'

const CARPETA = path.join(process.cwd(), 'db', 'migrations')

export async function aplicarMigraciones(
  base: Base,
  { silencioso = false } = {},
): Promise<number> {
  const decir = (m: string) => { if (!silencioso) console.log(m) }

  const archivos = readdirSync(CARPETA).filter((f) => f.endsWith('.sql')).sort()

  let aplicadas = new Set<string>()
  try {
    const filas = await base.consultar<{ nombre: string }>('select nombre from app.migraciones')
    aplicadas = new Set(filas.map((f) => f.nombre))
  } catch {
    // Primera corrida: app.migraciones todavía no existe.
  }

  const pendientes = archivos.filter((a) => !aplicadas.has(a))
  if (!pendientes.length) {
    decir('  Sin migraciones pendientes.')
    return 0
  }

  for (const archivo of pendientes) {
    const sql = readFileSync(path.join(CARPETA, archivo), 'utf8')
    const hash = createHash('sha256').update(sql).digest('hex').slice(0, 16)

    try {
      await base.ejecutar(`begin;\n${sql}\ncommit;`)
      await base.consultar(
        'insert into app.migraciones (nombre, hash) values ($1, $2) on conflict (nombre) do nothing',
        [archivo, hash],
      )
      decir(`  → ${archivo} ✓`)
    } catch (e) {
      decir(`  → ${archivo} ✗`)
      await base.ejecutar('rollback').catch(() => {})
      throw new Error(`Falló la migración ${archivo}: ${(e as Error).message}`, { cause: e })
    }
  }

  decir(`  ${pendientes.length} migración(es) aplicada(s).`)
  return pendientes.length
}
