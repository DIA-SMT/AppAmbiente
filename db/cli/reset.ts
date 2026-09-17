/**
 * Borra la base de desarrollo y la vuelve a armar desde cero.
 *
 *     npm run db:reset
 *
 * En PGlite elimina la carpeta .data/pglite. Con DATABASE_URL apuntando a un
 * Postgres real pide confirmación explícita, para no borrar producción.
 */
import '../entorno'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { obtenerBase } from '../client'
import { migrar } from './migrar'
import { sembrar } from './sembrar'

async function reset() {
  const url = process.env.DATABASE_URL?.trim()

  if (url) {
    if (process.env.CONFIRMO_BORRAR !== 'si') {
      console.error('\n  DATABASE_URL está definida. Para borrar esa base, correr con CONFIRMO_BORRAR=si\n')
      process.exit(1)
    }
    const base = await obtenerBase()
    await base.ejecutar('drop schema if exists public cascade; create schema public; drop schema if exists app cascade;')
    await base.cerrar()
    delete (globalThis as Record<string, unknown>).__baseAmbiente
  } else {
    rmSync(path.join(process.cwd(), '.data', 'pglite'), { recursive: true, force: true })
    console.log('  Base local borrada.')
  }

  await migrar()
  await sembrar()
  await (await obtenerBase()).cerrar()
}

reset().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
