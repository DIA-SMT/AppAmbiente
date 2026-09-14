/**
 * Sesión del usuario: cookie firmada, sin estado en el servidor.
 *
 * La sesión del vigilador no vence a propósito. Rota gente todas las semanas y
 * trabajan en la calle: obligarlos a volver a escribir un PIN cada mañana es la
 * forma más rápida de que dejen de cargar. Lo que sí se puede hacer es
 * desactivar el usuario del sitio desde el panel, y ahí la sesión muere en el
 * siguiente pedido porque se revalida contra la base.
 *
 * La de la coordinadora vence (perfiles.sesion_horas, 12 por defecto): tiene
 * acceso a datos personales y al panel completo.
 */
import 'server-only'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { comoServicio } from '@db/sesion'
import type { Sesion } from '@db/sesion'

export type { Sesion }

const COOKIE = 'ambiente_sesion'

function clave(): Uint8Array {
  const secreto = process.env.AUTH_SECRET
  if (!secreto || secreto.length < 32) {
    throw new Error(
      'Falta AUTH_SECRET, o es demasiado corto. Copiar .env.example a .env.local.',
    )
  }
  return new TextEncoder().encode(secreto)
}

export async function crearCookieDeSesion(perfil: {
  id: string
  rol: 'admin' | 'vigilador'
  sitio_id: string | null
  nombre: string
  sesion_horas: number | null
}) {
  const token = new SignJWT({
    rol: perfil.rol,
    sitio_id: perfil.sitio_id ?? '',
    nombre: perfil.nombre,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(perfil.id)
    .setIssuedAt()

  const horas = perfil.sesion_horas
  if (horas) token.setExpirationTime(`${horas}h`)

  const almacen = await cookies()
  almacen.set(COOKIE, await token.sign(clave()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Sin maxAge la cookie muere al cerrar el navegador, y en un celular eso
    // pasa seguido. Un año para el vigilador; el vencimiento real lo controla
    // el JWT en el caso de la coordinadora.
    maxAge: horas ? horas * 3600 : 60 * 60 * 24 * 365,
  })
}

export async function cerrarSesion() {
  const almacen = await cookies()
  almacen.delete(COOKIE)
}

/** Lee la cookie y revalida contra la base que el perfil siga activo. */
export async function sesionActual(): Promise<Sesion | null> {
  const almacen = await cookies()
  const bruto = almacen.get(COOKIE)?.value
  if (!bruto) return null

  let sub: string
  try {
    const { payload } = await jwtVerify(bruto, clave())
    if (!payload.sub) return null
    sub = payload.sub
  } catch {
    return null
  }

  // Desactivar un usuario tiene que cortarle el acceso ya, no cuando venza su
  // token. Son pocos pedidos por minuto: el costo de revalidar es despreciable.
  const filas = await comoServicio((tx) =>
    tx.consultar<{ id: string; rol: 'admin' | 'vigilador'; sitio_id: string | null; nombre: string }>(
      `select id, rol, sitio_id, nombre from perfiles where id = $1 and activo`,
      [sub],
    ),
  )
  const p = filas[0]
  if (!p) return null

  return { perfilId: p.id, rol: p.rol, sitioId: p.sitio_id, nombre: p.nombre }
}

/** Para páginas que exigen sesión. Devuelve null si no hay; el layout redirige. */
export async function exigirSesion(): Promise<Sesion> {
  const s = await sesionActual()
  if (!s) throw new ErrorSinSesion()
  return s
}

export async function exigirAdmin(): Promise<Sesion> {
  const s = await exigirSesion()
  if (s.rol !== 'admin') throw new ErrorSinPermiso()
  return s
}

export class ErrorSinSesion extends Error {
  constructor() { super('Sin sesión'); this.name = 'ErrorSinSesion' }
}
export class ErrorSinPermiso extends Error {
  constructor() { super('Sin permiso'); this.name = 'ErrorSinPermiso' }
}
