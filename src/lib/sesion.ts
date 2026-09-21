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
 *
 * Hay dos cookies. La de sesión, que es la de siempre, y una de cinco minutos
 * para el hueco entre la contraseña y el código del segundo factor. Los dos
 * tokens se firman con la misma clave y viajan al mismo navegador, así que
 * cada uno dice para qué es (`aud`) y quien lo lee exige el suyo: sin eso,
 * copiar el token del paso intermedio a la cookie de sesión sería entrar sin
 * haber pasado el segundo factor.
 */
import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignJWT, jwtVerify } from 'jose'
import { comoServicio, consultarConSesion } from '@db/sesion'
import type { Sesion } from '@db/sesion'

export type { Sesion }

const COOKIE = 'ambiente_sesion'
const COOKIE_PREVIA = 'ambiente_previo'
const MINUTOS_PASO_PREVIO = 5

function clave(): Uint8Array {
  const secreto = process.env.AUTH_SECRET
  if (!secreto || secreto.length < 32) {
    throw new Error(
      'Falta AUTH_SECRET, o es demasiado corto. Copiar .env.example a .env.local.',
    )
  }
  return new TextEncoder().encode(secreto)
}

/** Las mismas opciones para las dos cookies; lo único que cambia es cuánto duran. */
function opcionesDeCookie(segundos: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: segundos,
  }
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
    .setAudience('sesion')
    .setIssuedAt()

  const horas = perfil.sesion_horas
  if (horas) token.setExpirationTime(`${horas}h`)

  const almacen = await cookies()
  // Sin maxAge la cookie muere al cerrar el navegador, y en un celular eso pasa
  // seguido. Un año para el vigilador; el vencimiento real lo controla el JWT
  // en el caso de la coordinadora.
  const segundos = horas ? horas * 3600 : 60 * 60 * 24 * 365
  almacen.set(COOKIE, await token.sign(clave()), opcionesDeCookie(segundos))
  // Con la sesión hecha, el token del paso intermedio no tiene nada más que
  // hacer en el navegador.
  almacen.delete(COOKIE_PREVIA)
}

export async function cerrarSesion() {
  const almacen = await cookies()
  almacen.delete(COOKIE)
}

/**
 * El paso intermedio: la contraseña ya está bien, falta el código.
 *
 * Cinco minutos alcanzan de sobra para abrir la aplicación del teléfono y no
 * dejan la puerta entornada si alguien se va del escritorio. Lo único que
 * guarda es de quién es el ingreso a medio hacer: el rol y el nombre salen del
 * perfil recién cuando la sesión existe de verdad.
 */
export async function crearCookiePrevia(perfilId: string): Promise<void> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(perfilId)
    .setAudience('previo')
    .setIssuedAt()
    .setExpirationTime(`${MINUTOS_PASO_PREVIO}m`)
    .sign(clave())

  const almacen = await cookies()
  almacen.set(COOKIE_PREVIA, token, opcionesDeCookie(MINUTOS_PASO_PREVIO * 60))
}

/** El perfil que está a mitad de camino, o null si no hay o ya venció. */
export async function leerCookiePrevia(): Promise<string | null> {
  const almacen = await cookies()
  const bruto = almacen.get(COOKIE_PREVIA)?.value
  if (!bruto) return null

  try {
    // Acá adentro sólo vale el token del paso intermedio. Una cookie de sesión
    // copiada en este lugar no serviría para saltear nada, pero tampoco hay
    // motivo para darla por buena.
    const { payload } = await jwtVerify(bruto, clave(), { audience: 'previo' })
    return payload.sub ?? null
  } catch {
    return null
  }
}

export async function borrarCookiePrevia(): Promise<void> {
  const almacen = await cookies()
  almacen.delete(COOKIE_PREVIA)
}

/**
 * Lee la cookie y revalida contra la base que el perfil siga activo.
 *
 * Va envuelta en cache() porque entre el layout y la página esto se llama dos
 * veces por navegación, y cada llamada abría su propia transacción contra São
 * Paulo. cache() memoiza solo dentro del mismo pedido, así que se conserva lo
 * que dice el comentario de arriba: en el pedido siguiente se vuelve a
 * consultar y el usuario desactivado queda afuera. Por eso no va unstable_cache
 * ni revalidate: esos guardan entre pedidos y entre usuarios distintos.
 */
export const sesionActual = cache(async (): Promise<Sesion | null> => {
  const almacen = await cookies()
  const bruto = almacen.get(COOKIE)?.value
  if (!bruto) return null

  let sub: string
  try {
    const { payload } = await jwtVerify(bruto, clave())
    // Una sesión es una sesión y el paso intermedio es el paso intermedio: el
    // token de 'previo' pegado en esta cookie no abre el panel.
    //
    // Los tokens sin `aud` son los que ya estaban emitidos antes de que
    // existiera el segundo paso, y se aceptan: para fabricar uno hace falta
    // AUTH_SECRET, y rechazarlos es sacar de la sesión, todos juntos y sin
    // aviso, a los vigiladores que están en la calle. Se pueden dejar de
    // aceptar cuando haya pasado una temporada con todos los puntos adentro.
    if (payload.aud !== undefined && payload.aud !== 'sesion') return null
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
})

export interface PendientesDeCuenta {
  correo: boolean
  segundoFactor: boolean
}

/**
 * Qué le falta a la cuenta para estar completa.
 *
 * Es lo que mira el portón del panel para mandar a /cuenta. Va en cache() por
 * lo mismo que sesionActual: el layout y la página preguntan lo mismo dos veces
 * por navegación, y la respuesta no puede sobrevivir al pedido —si sobreviviera,
 * quien acaba de cargar su correo seguiría viendo que le falta—.
 *
 * Al vigilador no le falta nada nunca: no tiene correo ni segundo factor, y el
 * portón no existe de su lado.
 */
export const pendientesDeCuenta = cache(async (s: Sesion): Promise<PendientesDeCuenta> => {
  if (s.rol !== 'admin') return { correo: false, segundoFactor: false }

  const filas = await consultarConSesion<{ correo: string | null; totp_confirmado_en: string | null }>(
    s,
    `select correo, totp_confirmado_en from perfiles where id = $1`,
    [s.perfilId],
  )

  const p = filas[0]
  // Si el perfil no se pudo leer, no se traba a nadie. El portón está para
  // empujar a completar la cuenta, no para dejar afuera a quien ya entró.
  if (!p) return { correo: false, segundoFactor: false }

  return { correo: !p.correo, segundoFactor: !p.totp_confirmado_en }
})

/** Para páginas que exigen sesión. Devuelve null si no hay; el layout redirige. */
export async function exigirSesion(): Promise<Sesion> {
  const s = await sesionActual()
  if (!s) throw new ErrorSinSesion()
  return s
}

/**
 * Coordinación, sin mirar si la cuenta está completa.
 *
 * Lo usan los tres lugares a los que el portón no les puede cerrar la puerta:
 * el layout del panel, que dibuja el marco de /cuenta, y la propia pantalla de
 * /cuenta con sus acciones. En cualquier otro lado va exigirPanel().
 */
export async function exigirAdmin(): Promise<Sesion> {
  const s = await exigirSesion()
  if (s.rol !== 'admin') throw new ErrorSinPermiso()
  return s
}

/**
 * Coordinación con la cuenta terminada. Es el portón, del lado del servidor.
 *
 * Tiene que estar acá y no sólo en el componente que dibuja el panel. Un layout
 * que decide en el navegador no frena nada: la página ajena igual se arma
 * entera en el servidor y viaja al navegador como parte de la respuesta, así
 * que con «ver código fuente», con curl o con el JavaScript apagado, la cuenta a
 * medio hacer lee el panel completo —los correos de las otras cuentas, los
 * vecinos— y nada la obliga nunca a terminar de configurarse. Acá el pedido se
 * corta antes de consultar una sola fila.
 *
 * Falla abierto, igual que el layout: si no se puede saber qué falta —la base
 * todavía sin la 0023, que es un orden posible cuando el SQL y el despliegue
 * son dos pasos sueltos— se deja pasar. Un portón roto que deja pasar es una
 * molestia de un rato; uno roto que no deja pasar es la coordinación entera
 * afuera, y con una sola cuenta no hay quien lo destrabe desde adentro.
 */
export async function exigirAdminCompleto(): Promise<Sesion> {
  const s = await exigirAdmin()
  const pendientes = await pendientesDeCuenta(s).catch(() => ({
    correo: false,
    segundoFactor: false,
  }))
  if (pendientes.correo || pendientes.segundoFactor) throw new ErrorCuentaIncompleta()
  return s
}

/**
 * Lo que llama cada pantalla del panel que no es /cuenta.
 *
 * Resuelve los tres finales posibles con un redirect y devuelve la sesión, así
 * la página no tiene que acordarse de ninguno. Ojo con envolverlo en un
 * `.catch()`: redirect() avisa lanzando, y atraparlo lo anula.
 */
export async function exigirPanel(): Promise<Sesion> {
  try {
    return await exigirAdminCompleto()
  } catch (e) {
    if (e instanceof ErrorCuentaIncompleta) redirect('/cuenta')
    // El vigilador tiene sesión buena; este panel no es para él.
    redirect(e instanceof ErrorSinPermiso ? '/turno' : '/ingresar')
  }
}

export class ErrorSinSesion extends Error {
  constructor() { super('Sin sesión'); this.name = 'ErrorSinSesion' }
}
export class ErrorSinPermiso extends Error {
  constructor() { super('Sin permiso'); this.name = 'ErrorSinPermiso' }
}
export class ErrorCuentaIncompleta extends Error {
  constructor() { super('Falta completar la cuenta'); this.name = 'ErrorCuentaIncompleta' }
}
