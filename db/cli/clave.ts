/**
 * Le pone una contraseña nueva a una cuenta de coordinación, desde afuera.
 *
 *     npm run db:clave                              (informe, no toca nada)
 *     npm run db:clave -- --usuario direccionia     (le pone una nueva)
 *
 * Antes de cambiar nada pregunta, y hay que contestar escribiendo el nombre de
 * usuario. Agregando --si no pregunta, para cuando no hay terminal.
 *
 * ESTO ES LA SALIDA DE EMERGENCIA. La coordinación se rescata entre sí desde
 * /usuarios, pero esta instalación tiene una sola cuenta: el día que quien la
 * usa se olvide la contraseña no hay nadie adentro que se la pueda cambiar, y
 * el sistema entero se queda sin puerta. Lo que hace falta para correr esto es
 * la cadena de conexión a la base, que ya es la llave de todo.
 *
 * La contraseña que escribe es al azar, se muestra una sola vez y no queda
 * guardada en ningún lado: lo que se guarda es su hash. Y deja
 * `credencial_cambiada_en` en null a propósito, así el panel obliga a elegir
 * una propia en el primer ingreso y esta contraseña de paso —que viajó por
 * donde sea que se la haya dictado— deja de servir enseguida.
 *
 * Los usuarios de punto no se atienden acá: el PIN de un punto se lo cambia la
 * coordinación desde /usuarios, que para eso entra.
 *
 * Va por comoServicio —sin políticas— porque acá no hay sesión de nadie: es una
 * herramienta de rescate que se corre desde una máquina que ya tiene
 * DATABASE_URL, igual que las migraciones.
 */
import '../entorno'
import { randomInt } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { comoServicio } from '../sesion'
import { obtenerBase, describirMotor, type Conexion } from '../client'
import { esClaveValida, hashearCredencial } from '../credenciales'

export interface CuentaDeCoordinacion {
  id: string
  usuario: string
  nombre: string
  correo: string | null
  /** Null mientras la contraseña que abre la cuenta la haya escrito otro. */
  cambiadaEn: string | null
}

const fFecha = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Tucuman',
  day: '2-digit', month: '2-digit', year: 'numeric',
})

/**
 * Sin la I, la l, la O, el 0 y el 1.
 *
 * Esta contraseña se lee de una pantalla y se dicta por teléfono. Un carácter
 * que se confunde con otro acá no es un detalle: es la persona a la que estamos
 * rescatando probando cinco veces y quedándose trabada cinco minutos más.
 */
const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789'
const GRUPOS = 3
const POR_GRUPO = 4

/**
 * Una contraseña de paso, en grupos separados por guión.
 *
 * Los guiones son parte de la contraseña, no adorno: si se mostraran grupos
 * sueltos, la mitad la escribiría con espacios y la otra mitad sin nada. Así lo
 * que se ve es exactamente lo que hay que teclear.
 *
 * randomInt y no Math.random(): es una credencial, aunque dure un ingreso.
 */
function generarClave(): string {
  const grupo = () =>
    Array.from({ length: POR_GRUPO }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')
  return Array.from({ length: GRUPOS }, grupo).join('-')
}

/**
 * Que la migración que agrega `credencial_cambiada_en` esté aplicada.
 *
 * Sin esto el error que sale es «column "credencial_cambiada_en" does not
 * exist» en medio de un rescate, que es el peor momento para tener que adivinar
 * qué falta.
 */
async function columnaLista(tx: Conexion): Promise<boolean> {
  const filas = await tx.consultar<{ c: string }>(
    `select count(*) as c
       from information_schema.columns
      where table_schema = 'public' and table_name = 'perfiles'
        and column_name = 'credencial_cambiada_en'`,
  )
  return Number(filas[0]?.c ?? 0) === 1
}

/**
 * Las cuentas de coordinación y cómo está cada una.
 *
 * Los usuarios de punto no aparecen: no llevan correo y su PIN se cambia desde
 * el panel. Mezclarlos acá haría pensar que a alguno le falta algo.
 */
export async function cuentasDeCoordinacion(
  tx: Conexion,
  usuario?: string,
): Promise<CuentaDeCoordinacion[]> {
  const buscado = usuario?.trim().toLowerCase()
  const filas = await tx.consultar<{
    id: string; usuario: string; nombre: string
    correo: string | null; credencial_cambiada_en: string | null
  }>(
    `select id, usuario, nombre, correo, credencial_cambiada_en
       from perfiles
      where rol = 'admin'
        and ($1::text is null or lower(usuario) = $1 or lower(correo) = $1)
      order by usuario`,
    [buscado ?? null],
  )

  return filas.map((f) => ({
    id: f.id,
    usuario: f.usuario,
    nombre: f.nombre,
    correo: f.correo,
    cambiadaEn: f.credencial_cambiada_en,
  }))
}

/**
 * Escribe la contraseña nueva y deja la cuenta como recién creada.
 *
 * Las tres cosas van juntas y en la misma sentencia. `credencial_cambiada_en`
 * en null es lo que hace que el portón le pida una propia al entrar; el
 * bloqueo se suelta porque quien llega hasta acá suele venir de probar
 * contraseñas, y dejarla trabada cinco minutos después del rescate no cuida
 * nada.
 */
export async function ponerClave(tx: Conexion, id: string, clave: string): Promise<void> {
  await tx.consultar(
    `update perfiles
        set credencial_hash = $2,
            credencial_cambiada_en = null,
            intentos_fallidos = 0,
            bloqueado_hasta = null
      where id = $1`,
    [id, hashearCredencial(clave)],
  )
}

// ── Pantalla ───────────────────────────────────────────────────────────────

/**
 * El estado, no el origen. Esta misma herramienta deja la columna en null, así
 * que decir «con la que la crearon» desmentiría lo que acaba de hacer.
 */
function describir(c: CuentaDeCoordinacion): string {
  if (!c.cambiadaEn) return 'todavía no eligió la suya'
  return `contraseña propia desde el ${fFecha.format(new Date(c.cambiadaEn))}`
}

function listar(cuentas: CuentaDeCoordinacion[]) {
  const ancho = Math.max(...cuentas.map((c) => c.usuario.length), 8)
  const anchoCorreo = Math.max(...cuentas.map((c) => (c.correo ?? '—').length), 6)
  for (const c of cuentas) {
    console.log(
      `    ${c.usuario.padEnd(ancho)}  ${(c.correo ?? '—').padEnd(anchoCorreo)}  ${describir(c)}`,
    )
  }
}

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

/**
 * Confirmación escribiendo el nombre de usuario, no un «s/n».
 *
 * Acá se toca la única puerta de entrada al sistema. Tener que escribir a quién
 * se le está cambiando la contraseña es lo que evita dejar afuera a la cuenta
 * equivocada a las apuradas.
 *
 * Sin terminal —dentro de un script, en un servidor— readline leería el final
 * del archivo y contestaría que no. Para ese caso está --si, que vale lo mismo
 * porque quien lo escribe ya leyó lo que sigue.
 */
async function confirmar(usuario: string): Promise<boolean> {
  if (process.argv.includes('--si')) return true
  if (!process.stdin.isTTY) {
    console.log('  Sin terminal interactiva no puedo preguntar. Volvé a correrlo agregando --si\n')
    return false
  }
  const io = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const dicho = await io.question(`  Escribí "${usuario}" para confirmar (cualquier otra cosa lo cancela): `)
    return dicho.trim().toLowerCase() === usuario.toLowerCase()
  } finally {
    io.close()
  }
}

async function principal() {
  const usuario = argumento('--usuario')

  console.log(`\n  Base: ${describirMotor()}\n`)

  const cuentas = await comoServicio(async (tx) => {
    if (!(await columnaLista(tx))) {
      throw new Error(
        'La base todavía no tiene la columna credencial_cambiada_en.\n' +
          '  Aplicá la migración 0024 con: npm run db:migrar',
      )
    }
    return cuentasDeCoordinacion(tx, usuario ?? undefined)
  })

  if (cuentas.length === 0) {
    throw new Error(
      usuario
        ? `No hay ninguna cuenta de coordinación que sea "${usuario}". ` +
          'Se la busca por nombre de usuario o por correo.\n' +
          '  El PIN de un punto se cambia desde el panel, en /usuarios.'
        : 'No hay ninguna cuenta de coordinación en esta base.',
    )
  }

  if (!usuario) {
    console.log('  Cuentas de coordinación\n')
    listar(cuentas)
    // La cadena va escrita adelante en la misma línea, y no es adorno: sin
    // ella el comando va a la base que tenga configurada esa máquina, que en un
    // rescate no es de la que uno se acuerda.
    console.log(`
  Los usuarios de punto no aparecen: su PIN se cambia desde el panel.

  Para ponerle una contraseña nueva a una que se la olvidó:
    DATABASE_URL="<cadena de sesión>" npm run db:clave -- --usuario ${cuentas[0]!.usuario}
`)
    return
  }

  if (cuentas.length > 1) {
    throw new Error(`"${usuario}" le corresponde a más de una cuenta. Usá el nombre de usuario exacto.`)
  }

  const cuenta = cuentas[0]!
  console.log(`  Cuenta: ${cuenta.usuario} — ${cuenta.nombre}`)
  console.log(`  Correo: ${cuenta.correo ?? '— (sin cargar)'}`)
  console.log(`  Hoy:    ${describir(cuenta)}\n`)

  console.log(`  ESTO ES LO QUE VA A PASAR

    · "${cuenta.usuario}" deja de entrar con la contraseña que tenga hoy.
    · Se le pone una al azar, que se muestra acá abajo UNA SOLA VEZ.
    · Se le suelta el bloqueo por intentos fallidos, si lo tenía.
    · NO se toca el correo, ni el rol, ni nada de lo que cargó.
    · En el próximo ingreso entra con esa contraseña y el panel no lo deja ir a
      ninguna otra pantalla hasta que elija una propia. O sea que la que sale acá
      sirve para una vez y después no sirve más.
`)

  if (!(await confirmar(cuenta.usuario))) {
    console.log('\n  No se cambió nada.\n')
    return
  }

  const clave = generarClave()
  // Un control de que las dos mitades no se separaron: si el mínimo de
  // esClaveValida sube y esto sigue generando lo mismo, la contraseña que
  // escribimos acá sería una que la pantalla de /cuenta rechaza.
  if (!esClaveValida(clave)) {
    throw new Error('La contraseña generada no pasa esClaveValida. Revisá db/credenciales.ts.')
  }

  await comoServicio((tx) => ponerClave(tx, cuenta.id, clave))

  console.log(`
  Listo. La contraseña de "${cuenta.usuario}" es:

      ${clave}

  Los guiones son parte de la contraseña. Anotala ahora: no queda guardada en
  ningún lado y no hay forma de volver a verla; si se pierde, se corre esto de
  nuevo y sale otra.

  Decile que entre con ella y que elija la suya, que es lo primero que le va a
  pedir el panel.
`)
}

const esEntrada = process.argv[1]?.replace(/\\/g, '/').endsWith('db/cli/clave.ts')
if (esEntrada) {
  principal()
    .then(async () => (await obtenerBase()).cerrar())
    .then(() => process.exit(0))
    .catch(async (e) => {
      console.error(`\n  ${(e as Error).message}\n`)
      await (await obtenerBase()).cerrar().catch(() => {})
      process.exit(1)
    })
}
