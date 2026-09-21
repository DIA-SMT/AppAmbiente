/**
 * Segundo factor de tiempo (TOTP, RFC 6238) para las cuentas de coordinación.
 *
 * Es el único archivo del sistema donde vive la aritmética del segundo factor,
 * y está a propósito sin base y sin React: así se lo puede correr suelto contra
 * los vectores de prueba del RFC 6238, que son la única forma honesta de saber
 * que esto está bien. Un TOTP mal implementado no se nota —da códigos de seis
 * dígitos igual, y el teléfono que los genera nunca coincide— hasta que alguien
 * queda afuera el día de la presentación.
 *
 * Por qué HMAC-SHA1 y no algo más nuevo: es lo que generan Google
 * Authenticator, Microsoft Authenticator, Authy y 1Password cuando escanean un
 * otpauth:// sin parámetro `algorithm`. Cambiarlo acá deja a la mitad de los
 * teléfonos del municipio sin poder configurarse.
 *
 * El secreto se guarda cifrado (ver cifrarSecreto): en claro, cualquiera que
 * llegue a leer la tabla de perfiles —un volcado de la base, un respaldo que
 * viaja por correo— se genera los códigos solo, y el segundo factor deja de
 * serlo. Cifrado, además del volcado hace falta la variable de entorno del
 * servidor.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto'

const DIGITOS = 6
const PASO_SEGUNDOS = 30
/** Un paso para cada lado: aguanta hasta medio minuto de reloj desfasado. */
const VENTANA = 1
const EMISOR = 'Residuos SMT'

// ── Base32 (RFC 4648) ──────────────────────────────────────────────────────
// Los teléfonos leen y escriben el secreto en base32, no en hexadecimal.

const ALFABETO32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function aBase32(bytes: Buffer): string {
  let acumulado = 0
  let bits = 0
  let salida = ''
  for (const b of bytes) {
    acumulado = (acumulado << 8) | b
    bits += 8
    while (bits >= 5) {
      salida += ALFABETO32[(acumulado >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) salida += ALFABETO32[(acumulado << (5 - bits)) & 31]
  return salida
}

/**
 * Tolera minúsculas, espacios, guiones y el relleno `=`.
 *
 * La pantalla de /cuenta muestra el secreto en grupos de cuatro para poder
 * copiarlo a mano, y quien lo escriba de nuevo va a incluir esos espacios.
 */
function deBase32(texto: string): Buffer {
  const limpio = texto.toUpperCase().replace(/[^A-Z2-7]/g, '')
  const salida: number[] = []
  let acumulado = 0
  let bits = 0
  for (const c of limpio) {
    acumulado = (acumulado << 5) | ALFABETO32.indexOf(c)
    bits += 5
    if (bits >= 8) {
      salida.push((acumulado >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(salida)
}

// ── El secreto y su URI ────────────────────────────────────────────────────

/** 20 bytes, que es el largo de la clave de HMAC-SHA1 que recomienda el RFC. */
export function generarSecreto(): string {
  return aBase32(randomBytes(20))
}

/**
 * Lo que va adentro del QR.
 *
 * Se arma a mano y no con URLSearchParams porque ése codifica el espacio como
 * `+`, y hay aplicaciones que entonces muestran «Residuos+SMT» como nombre de
 * la cuenta. Tampoco lleva `algorithm`: sin el parámetro todas asumen SHA1, que
 * es lo que hacemos; con él, alguna vieja se confunde.
 */
export function uriDeAprovisionamiento(correo: string, secreto: string): string {
  const emisor = encodeURIComponent(EMISOR)
  const etiqueta = `${emisor}:${encodeURIComponent(correo.trim())}`
  const consulta = [
    `secret=${secreto.toUpperCase().replace(/[^A-Z2-7]/g, '')}`,
    `issuer=${emisor}`,
    `digits=${DIGITOS}`,
    `period=${PASO_SEGUNDOS}`,
  ].join('&')
  return `otpauth://totp/${etiqueta}?${consulta}`
}

/** El código de seis dígitos que le toca a ese paso. */
function codigoDelPaso(llave: Buffer, paso: number): string {
  const contador = Buffer.alloc(8)
  contador.writeBigUInt64BE(BigInt(paso))
  const mac = createHmac('sha1', llave).update(contador).digest()
  // Truncado dinámico del RFC 4226: los cuatro últimos bits dicen desde dónde
  // leer, y se apaga el bit de signo porque no todos los lenguajes tienen
  // enteros sin signo.
  const desde = mac[mac.length - 1]! & 0x0f
  const truncado = mac.readUInt32BE(desde) & 0x7fffffff
  return String(truncado % 10 ** DIGITOS).padStart(DIGITOS, '0')
}

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Devuelve el paso aceptado, o null.
 *
 * El paso vuelve —y no un booleano— porque quien llama tiene que guardarlo en
 * perfiles.totp_ultimo_paso: sin eso, un código visto de reojo sobre el hombro
 * sirve durante el minuto y medio que dura su ventana, y un segundo factor que
 * se puede repetir no agrega nada contra alguien que está mirando la pantalla.
 *
 * Se prueban los tres pasos siempre, sin cortar en el primero que coincide, para
 * que el tiempo de respuesta no cuente de qué lado del reloj estaba el código.
 */
export function verificarCodigo(secreto: string, codigo: string, ahora: Date = new Date()): number | null {
  const limpio = codigo.replace(/\D/g, '')
  if (limpio.length !== DIGITOS) return null

  const llave = deBase32(secreto)
  if (llave.length === 0) return null

  const paso = Math.floor(ahora.getTime() / 1000 / PASO_SEGUNDOS)
  let aceptado: number | null = null
  for (let d = -VENTANA; d <= VENTANA; d++) {
    const p = paso + d
    if (p < 0) continue
    const coincide = iguales(codigoDelPaso(llave, p), limpio)
    if (coincide && aceptado === null) aceptado = p
  }
  return aceptado
}

// ── Cifrado del secreto en la base ─────────────────────────────────────────

const MARCA = 'gcm1'
/**
 * Fija a propósito: la clave se tiene que derivar igual en cada arranque del
 * servidor y en cada instancia, si no lo guardado ayer no se puede leer hoy.
 * Lo que hace secreta a la clave es AUTH_SECRET, no esto.
 *
 * El `info` distinto separa esta clave de la que firma la cookie de sesión:
 * misma variable de entorno, dos claves que no se pueden usar una por la otra.
 */
const SAL = 'ambiente.totp.v1'
const USO = 'cifrado del secreto totp'

function claveDeCifrado(): Buffer {
  const secreto = process.env.AUTH_SECRET
  if (!secreto || secreto.length < 32) {
    throw new Error('Falta AUTH_SECRET, o es demasiado corto. Copiar .env.example a .env.local.')
  }
  // HKDF y no scrypt —que es lo que usa db/credenciales.ts— porque AUTH_SECRET
  // ya son 48 bytes al azar y no una contraseña que alguien pueda adivinar:
  // acá el trabajo lento de scrypt no defendería nada y le sumaría cien
  // milisegundos a cada ingreso.
  return Buffer.from(hkdfSync('sha256', secreto, SAL, USO, 32))
}

export function cifrarSecreto(secreto: string): string {
  const iv = randomBytes(12)
  const cifrador = createCipheriv('aes-256-gcm', claveDeCifrado(), iv)
  const datos = Buffer.concat([cifrador.update(secreto, 'utf8'), cifrador.final()])
  return [
    MARCA,
    iv.toString('base64url'),
    cifrador.getAuthTag().toString('base64url'),
    datos.toString('base64url'),
  ].join('$')
}

/**
 * Levanta excepción si no se puede descifrar, en vez de devolver vacío.
 *
 * Si alguien cambia AUTH_SECRET, todos los secretos guardados quedan ilegibles.
 * Devolviendo '' la pantalla diría «código incorrecto» para siempre y nadie
 * entendería por qué; con el error a la vista, `npm run db:2fa` lo nombra y se
 * arregla restableciendo el segundo factor de esa cuenta.
 */
export function descifrarSecreto(cifrado: string): string {
  const [marca, iv, etiqueta, datos] = cifrado.split('$')
  if (marca !== MARCA || !iv || !etiqueta || !datos) {
    throw new Error('El secreto guardado no tiene el formato esperado.')
  }
  try {
    const descifrador = createDecipheriv('aes-256-gcm', claveDeCifrado(), Buffer.from(iv, 'base64url'))
    descifrador.setAuthTag(Buffer.from(etiqueta, 'base64url'))
    return descifrador.update(Buffer.from(datos, 'base64url')).toString('utf8') + descifrador.final('utf8')
  } catch {
    throw new Error(
      'No se pudo descifrar el secreto del segundo factor. Suele ser que AUTH_SECRET ' +
        'cambió: restablecer el segundo factor de esa cuenta con npm run db:2fa.',
    )
  }
}

// ── Códigos de respaldo ────────────────────────────────────────────────────

/**
 * Sin I, L, O, 0 ni 1: estos códigos se anotan en un papel y se vuelven a
 * escribir meses después, cuando ya se perdió el teléfono y nadie está para
 * adivinar si esa raya era un uno o una ele.
 */
const ALFABETO_RESPALDO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const GRUPOS = 3
const LARGO_GRUPO = 4

/**
 * La salida cuando se pierde el teléfono. Se muestran una sola vez y se guardan
 * hasheados, igual que una contraseña.
 */
export function generarCodigosDeRespaldo(cuantos = 8): string[] {
  const codigos = new Set<string>()
  while (codigos.size < cuantos) {
    const grupos: string[] = []
    for (let g = 0; g < GRUPOS; g++) {
      let grupo = ''
      // randomInt y no Math.random: son la llave de atrás de la casa.
      for (let i = 0; i < LARGO_GRUPO; i++) grupo += ALFABETO_RESPALDO[randomInt(ALFABETO_RESPALDO.length)]
      grupos.push(grupo)
    }
    codigos.add(grupos.join('-'))
  }
  return [...codigos]
}
