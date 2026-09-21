/**
 * El segundo factor de las cuentas de coordinación, desde la línea de comandos.
 *
 *     npm run db:2fa                                    (informe, no toca nada)
 *     npm run db:2fa -- --usuario direccionia           (informe de esa sola)
 *     npm run db:2fa -- --usuario direccionia --reset   (lo borra para rehacerlo)
 *
 * Antes de borrar pregunta, y hay que contestar escribiendo el nombre de
 * usuario. Agregando --si no pregunta, para cuando no hay terminal.
 *
 * ESTO ES LA SALIDA DE EMERGENCIA, y por eso existe. Con el segundo factor
 * puesto, una coordinadora que pierde el teléfono Y el papel de los códigos de
 * respaldo no puede entrar nunca más, y otro admin la puede rescatar desde el
 * panel… salvo que sea la única cuenta de coordinación que hay, que es
 * exactamente el caso de esta instalación. Sin este comando, el sistema entero
 * se queda sin puerta. Un segundo factor sin salida de emergencia no es rigor:
 * es una trampa.
 *
 * Borrar el segundo factor NO da acceso a nadie: la contraseña sigue haciendo
 * falta, y en el próximo ingreso la cuenta cae en /cuenta a configurarlo de
 * nuevo. Lo que sí hace falta para correr esto es la cadena de conexión a la
 * base, que ya es la llave de todo.
 *
 * Va por comoServicio —sin políticas— porque acá no hay sesión de nadie: es una
 * herramienta de rescate que se corre desde una máquina que ya tiene
 * DATABASE_URL, igual que las migraciones.
 */
import '../entorno'
import { createInterface } from 'node:readline/promises'
import { comoServicio } from '../sesion'
import { obtenerBase, describirMotor, type Conexion } from '../client'
import { descifrarSecreto } from '../totp'

export interface EstadoDeCuenta {
  id: string
  usuario: string
  nombre: string
  correo: string | null
  confirmadoEn: string | null
  codigosSinUsar: number
  /** El secreto está guardado pero no se puede descifrar con el AUTH_SECRET de esta máquina. */
  secretoIlegible: boolean
}

const fFecha = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Tucuman',
  day: '2-digit', month: '2-digit', year: 'numeric',
})

/**
 * Que la migración 0023 esté aplicada.
 *
 * Sin esto el error que sale es «column "totp_secreto" does not exist» en medio
 * de un rescate, que es el peor momento para tener que adivinar qué falta.
 */
async function columnasListas(tx: Conexion): Promise<boolean> {
  const filas = await tx.consultar<{ c: string }>(
    `select count(*) as c from information_schema.columns
      where table_schema = 'public' and table_name = 'perfiles'
        and column_name in ('correo', 'totp_secreto', 'totp_confirmado_en', 'codigos_respaldo')`,
  )
  return Number(filas[0]?.c ?? 0) === 4
}

/**
 * Las cuentas de coordinación y cómo está cada una.
 *
 * Los usuarios de punto no aparecen: no llevan segundo factor ni correo, y
 * mezclarlos acá haría pensar que a alguno le falta configurar algo.
 */
export async function estadoDeCuentas(tx: Conexion, usuario?: string): Promise<EstadoDeCuenta[]> {
  const buscado = usuario?.trim().toLowerCase()
  const filas = await tx.consultar<{
    id: string; usuario: string; nombre: string; correo: string | null
    totp_secreto: string | null; totp_confirmado_en: string | null
    codigos: number | string
  }>(
    `select id, usuario, nombre, correo, totp_secreto, totp_confirmado_en,
            coalesce(cardinality(codigos_respaldo), 0) as codigos
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
    confirmadoEn: f.totp_confirmado_en,
    codigosSinUsar: Number(f.codigos),
    secretoIlegible: f.totp_secreto !== null && !sePuedeDescifrar(f.totp_secreto),
  }))
}

/**
 * Si AUTH_SECRET cambió, los secretos guardados quedan ilegibles y la cuenta
 * rechaza todos los códigos sin decir por qué. Es la clase de cosa que se
 * descubre a las ocho de la mañana; que el informe la nombre ahorra la mañana.
 */
function sePuedeDescifrar(cifrado: string): boolean {
  try {
    return descifrarSecreto(cifrado).length > 0
  } catch {
    return false
  }
}

/** Deja la cuenta como recién creada: en el próximo ingreso lo vuelve a configurar. */
export async function restablecerSegundoFactor(tx: Conexion, id: string): Promise<void> {
  await tx.consultar(
    `update perfiles
        set totp_secreto = null,
            totp_confirmado_en = null,
            totp_ultimo_paso = null,
            codigos_respaldo = '{}',
            -- También se suelta el bloqueo: quien llega hasta acá suele venir de
            -- probar códigos que no andaban, y dejarla trabada cinco minutos
            -- después del rescate no cuida nada.
            intentos_fallidos = 0,
            bloqueado_hasta = null
      where id = $1`,
    [id],
  )
}

// ── Pantalla ───────────────────────────────────────────────────────────────

/** Lo que se va a perder, dicho en castellano y no con un número pelado. */
function frasePorCodigos(n: number): string {
  if (n === 0) return 'no le quedaba ninguno guardado'
  if (n === 1) return 'queda su único código sin usar'
  return `quedan sus ${n} códigos sin usar`
}

function describir(c: EstadoDeCuenta): string {
  if (c.secretoIlegible) return 'secreto ILEGIBLE con el AUTH_SECRET de esta máquina'
  if (!c.confirmadoEn) return 'sin segundo factor: lo configura al entrar'
  const fecha = fFecha.format(new Date(c.confirmadoEn))
  const codigos =
    c.codigosSinUsar === 0
      ? 'sin códigos de respaldo'
      : `${c.codigosSinUsar} código${c.codigosSinUsar === 1 ? '' : 's'} de respaldo`
  return `configurado el ${fecha} · ${codigos}`
}

function listar(cuentas: EstadoDeCuenta[]) {
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
 * se le está borrando el segundo factor es lo que evita el rescate de la cuenta
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
  const reset = process.argv.includes('--reset')

  console.log(`\n  Base: ${describirMotor()}\n`)

  const cuentas = await comoServicio(async (tx) => {
    if (!(await columnasListas(tx))) {
      throw new Error(
        'La base todavía no tiene las columnas del segundo factor.\n' +
          '  Aplicá la migración 0023 con: npm run db:migrar',
      )
    }
    return estadoDeCuentas(tx, usuario ?? undefined)
  })

  if (cuentas.length === 0) {
    throw new Error(
      usuario
        ? `No hay ninguna cuenta de coordinación que sea "${usuario}". ` +
          'Se la busca por nombre de usuario o por correo.\n' +
          '  Los usuarios de punto no tienen segundo factor.'
        : 'No hay ninguna cuenta de coordinación en esta base.',
    )
  }

  if (!reset) {
    console.log('  Cuentas de coordinación\n')
    listar(cuentas)
    console.log(`
  Los usuarios de punto no aparecen: entran con PIN y no llevan segundo factor.

  Para restablecer el de una cuenta que perdió el teléfono y los códigos:
    npm run db:2fa -- --usuario ${cuentas[0]!.usuario} --reset
`)
    return
  }

  if (!usuario) {
    throw new Error('Para restablecer hay que decir cuál cuenta:\n  npm run db:2fa -- --usuario direccionia --reset')
  }
  if (cuentas.length > 1) {
    throw new Error(`"${usuario}" le corresponde a más de una cuenta. Usá el nombre de usuario exacto.`)
  }

  const cuenta = cuentas[0]!
  console.log(`  Cuenta: ${cuenta.usuario} — ${cuenta.nombre}`)
  console.log(`  Correo: ${cuenta.correo ?? '— (sin cargar)'}`)
  console.log(`  Hoy:    ${describir(cuenta)}\n`)

  console.log(`  ESTO ES LO QUE VA A PASAR

    · Se borra el secreto del segundo factor de "${cuenta.usuario}": la aplicación
      del teléfono que tenga cargada deja de servir.
    · Se borran sus códigos de respaldo (${frasePorCodigos(cuenta.codigosSinUsar)}).
    · Se le suelta el bloqueo por intentos fallidos, si lo tenía.
    · NO se toca la contraseña, ni el correo, ni nada de lo que cargó.
    · En el próximo ingreso va a entrar con su contraseña y va a caer en /cuenta
      a escanear un código nuevo. Los ocho códigos de respaldo nuevos se muestran
      ahí una sola vez.
`)

  if (!(await confirmar(cuenta.usuario))) {
    console.log('\n  No se tocó nada.\n')
    return
  }

  await comoServicio((tx) => restablecerSegundoFactor(tx, cuenta.id))

  const despues = await comoServicio((tx) => estadoDeCuentas(tx, cuenta.usuario))
  console.log(`
  Listo. "${cuenta.usuario}" quedó ${describir(despues[0]!)}.

  Avisale que entre con su contraseña de siempre y que tenga el teléfono a mano.
`)
}

const esEntrada = process.argv[1]?.replace(/\\/g, '/').endsWith('db/cli/segundo-factor.ts')
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
