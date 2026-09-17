/**
 * Carga .env.local y .env para los comandos de db/cli.
 *
 * Next lo hace solo, pero `tsx` no: sin esto, `npm run dev` y
 * `npm run db:verificar` pueden estar mirando bases DISTINTAS sin que nadie se
 * entere. Pasó: con la cadena de producción en .env.local, el servidor de
 * desarrollo trabajaba contra Supabase mientras los comandos seguían usando el
 * PGlite de la máquina. La pantalla mostraba una cosa y la consola otra.
 *
 * Lo peligroso no es que sean distintas sino que no se note. Con esto las dos
 * mitades leen la misma configuración, y los comandos que borran o semibran ya
 * tienen sus propios frenos para cuando la base es de verdad: db:reset exige
 * CONFIRMO_BORRAR=si, db:sembrar no genera datos de ejemplo, y db:verificar
 * falla si sobrevive una clave de fábrica.
 *
 * Una variable puesta a mano en la línea de comandos gana, que es lo que hace
 * que `DATABASE_URL="…" npm run db:migrar` siga funcionando.
 */
// @next/env es CommonJS: bajo ESM no expone sus nombres sueltos, hay que
// pedírselo a require.
import { createRequire } from 'node:module'

let cargado = false

export function cargarEntorno(): void {
  if (cargado) return
  cargado = true
  const requerir = createRequire(import.meta.url)
  const { loadEnvConfig } = requerir('@next/env') as {
    loadEnvConfig: (dir: string, dev: boolean, log: { info: () => void; error: typeof console.error }) => void
  }
  // dev=true para que .env.local pese más que .env, igual que en npm run dev.
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error })
}

cargarEntorno()
