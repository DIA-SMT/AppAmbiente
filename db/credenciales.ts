/**
 * Hasheo de PIN y contraseña con scrypt de node:crypto. Sin dependencias
 * nativas, que en Windows son la primera fuente de problemas al instalar.
 *
 * El PIN del vigilador es corto a propósito: se teclea a mano en la calle.
 * Lo que compensa esa debilidad no es el hash sino el bloqueo por intentos
 * fallidos (ver perfiles.intentos_fallidos / bloqueado_hasta) y que el usuario
 * solo puede escribir movimientos de su propio sitio.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const LARGO = 64
const PARAMS = { N: 16384, r: 8, p: 1 }

export function hashearCredencial(texto: string): string {
  const sal = randomBytes(16)
  const derivado = scryptSync(texto.normalize('NFKC'), sal, LARGO, PARAMS)
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${sal.toString('base64url')}$${derivado.toString('base64url')}`
}

export function verificarCredencial(texto: string, guardado: string): boolean {
  try {
    const [algoritmo, n, r, p, sal, esperado] = guardado.split('$')
    if (algoritmo !== 'scrypt') return false
    const derivado = scryptSync(texto.normalize('NFKC'), Buffer.from(sal, 'base64url'), LARGO, {
      N: Number(n), r: Number(r), p: Number(p),
    })
    const bufEsperado = Buffer.from(esperado, 'base64url')
    return derivado.length === bufEsperado.length && timingSafeEqual(derivado, bufEsperado)
  } catch {
    return false
  }
}

/** Un PIN de 4 a 8 dígitos. Nada de letras: el teclado numérico es más rápido. */
export function esPinValido(pin: string): boolean {
  return /^\d{4,8}$/.test(pin)
}
