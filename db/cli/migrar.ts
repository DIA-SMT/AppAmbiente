/**
 * Aplica las migraciones pendientes y las registra en app.migraciones.
 * Vuelve a correr sin efecto si no hay nada nuevo.
 *
 *     npm run db:migrar
 *
 * Con PGlite, el servidor de desarrollo migra solo al arrancar; este comando
 * está para producción y para reparar. Cerrá el servidor antes de usarlo: dos
 * procesos escribiendo la misma carpeta .data/pglite se pisan.
 *
 * CONTRA UN POSTGRES DE VERDAD PIDE CONFIRMACIÓN, igual que db:reset. No es
 * simetría: una migración cambia el esquema de la base en uso y no se deshace
 * sola. Y `.env.local` puede tener una DATABASE_URL puesta de antes, así que
 * `npm run db:migrar` a secas —el comando más inofensivo de la lista— le aplica
 * lo que haya pendiente a la base de la Secretaría sin preguntar nada. La 0024
 * es justo la que no puede correr antes que el build: aplicada temprano, el
 * código que está en el aire nombra columnas que ya no existen y no entra nadie.
 */
import '../entorno'
import { obtenerBase, describirMotor } from '../client'
import { aplicarMigraciones } from '../migraciones'

export async function migrar(opciones: { silencioso?: boolean } = {}) {
  const base = await obtenerBase()
  if (!opciones.silencioso) console.log(`\n  Base: ${describirMotor()}`)
  return aplicarMigraciones(base, opciones)
}

/**
 * Que nadie migre una base remota sin haberlo dicho.
 *
 * Sólo cuando se lo corre a mano. db:reset importa migrar() en vez de correr
 * este archivo, así que no pasa por acá: ya preguntó lo suyo, y con CONFIRMO_BORRAR,
 * que es más grave.
 */
function confirmarSiEsRemota(): void {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) return
  if (process.env.CONFIRMO_MIGRAR === 'si') return
  console.error(`
  DATABASE_URL está definida: esto le aplicaría las migraciones pendientes a

    ${describirMotor()}

  Si es lo que querés, volvé a correrlo con CONFIRMO_MIGRAR=si adelante. Si no,
  fijate que .env.local no tenga una DATABASE_URL puesta de antes, o pasale
  DATABASE_URL= vacía en la misma línea para trabajar contra la base local.
`)
  process.exit(1)
}

const esEntrada = process.argv[1]?.replace(/\\/g, '/').endsWith('db/cli/migrar.ts')
if (esEntrada) {
  confirmarSiEsRemota()
  migrar()
    .then(async () => (await obtenerBase()).cerrar())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`\n  ${(e as Error).message}\n`)
      process.exit(1)
    })
}
