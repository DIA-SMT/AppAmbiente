/**
 * Aplica las migraciones pendientes y las registra en app.migraciones.
 * Vuelve a correr sin efecto si no hay nada nuevo.
 *
 *     npm run db:migrar
 *
 * Con PGlite, el servidor de desarrollo migra solo al arrancar; este comando
 * está para producción y para reparar. Cerrá el servidor antes de usarlo: dos
 * procesos escribiendo la misma carpeta .data/pglite se pisan.
 */
import { obtenerBase, describirMotor } from '../client'
import { aplicarMigraciones } from '../migraciones'

export async function migrar(opciones: { silencioso?: boolean } = {}) {
  const base = await obtenerBase()
  if (!opciones.silencioso) console.log(`\n  Base: ${describirMotor()}`)
  return aplicarMigraciones(base, opciones)
}

const esEntrada = process.argv[1]?.replace(/\\/g, '/').endsWith('db/cli/migrar.ts')
if (esEntrada) {
  migrar()
    .then(async () => (await obtenerBase()).cerrar())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`\n  ${(e as Error).message}\n`)
      process.exit(1)
    })
}
