'use server'

import { redirect } from 'next/navigation'
import { verificarAcceso, verificarSegundoFactor, type PerfilAutenticado } from '@/lib/acceso'
import {
  borrarCookiePrevia,
  cerrarSesion,
  crearCookieDeSesion,
  crearCookiePrevia,
  leerCookiePrevia,
} from '@/lib/sesion'

export interface EstadoIngreso {
  error?: string
  /** Lo que escribieron recién, para devolverlo puesto y no hacerlo tipear otra vez. */
  usuario?: string
  /**
   * La coordinación ya probó quién es y falta el código. Esto sólo decide qué
   * se dibuja: quién está a medio entrar lo dice la cookie previa, que es
   * httpOnly y no viaja por el formulario.
   */
  segundoFactor?: boolean
  /**
   * El servidor pide pasar a los códigos de respaldo. Sólo pasa cuando el
   * código del teléfono no puede entrar de ninguna manera: el que elige de qué
   * tipo es el código, normalmente, es quien está escribiendo.
   */
  respaldo?: boolean
}

/** El bloqueo llega en minutos; el contrato los da opcionales y el texto no. */
function enMinutos(minutos = 5) {
  return `${minutos} minuto${minutos === 1 ? '' : 's'}`
}

export async function ingresar(
  _previo: EstadoIngreso,
  datos: FormData,
): Promise<EstadoIngreso> {
  const usuario = String(datos.get('usuario') ?? '').trim()

  // Los tres caminos entran por el mismo formulario porque el paso lo decide
  // el servidor. Si lo decidiera el cliente, volver atrás podría dejar la
  // pantalla en un paso y la cookie previa en el otro.
  if (datos.get('volver')) {
    await borrarCookiePrevia()
    return { usuario }
  }
  if (datos.get('paso') === 'segundo_factor') return confirmarCodigo(datos, usuario)

  const credencial = String(datos.get('credencial') ?? '')
  // La coordinación entra con lo que escribe; los puntos, eligiendo del
  // selector. Uno pone una contraseña y el otro un PIN, y decirle "PIN" a
  // quien escribió una contraseña lo manda a buscar algo que no tiene.
  const esCoordinacion = datos.get('modo') === 'admin'
  const falta = esCoordinacion ? 'Falta la contraseña.' : 'Falta el PIN.'
  const incorrecta = esCoordinacion
    // Sin decir cuál de los dos está mal: si dijera "la contraseña no es", de
    // paso confirmaría qué correos tienen cuenta.
    ? 'El correo o la contraseña no son correctos.'
    : 'El PIN no es correcto.'

  if (!usuario) {
    return {
      error: esCoordinacion
        ? 'Escribí tu correo institucional o tu usuario.'
        : 'Elegí tu punto o escribí tu usuario.',
    }
  }
  if (!credencial) return { error: falta, usuario }

  const r = await verificarAcceso(usuario, credencial)

  // La contraseña estaba bien y la cuenta tiene segundo factor: todavía no hay
  // sesión. De este paso queda sólo la cookie previa, que dura cinco minutos y
  // sola no abre nada.
  if (r.ok === 'segundo_factor') {
    await crearCookiePrevia(r.perfilId)
    return { segundoFactor: true, usuario }
  }

  if (!r.ok) {
    if (r.motivo === 'bloqueado') {
      return {
        usuario,
        error: `Demasiados intentos. Probá de nuevo en ${enMinutos(r.minutos)}, o pedile a la coordinadora que te resetee el acceso.`,
      }
    }
    if (r.motivo === 'inactivo') {
      return { usuario, error: 'Este usuario está desactivado. Hablá con la coordinadora.' }
    }
    return { usuario, error: incorrecta }
  }

  return entrar(r.perfil)
}

/**
 * Segundo paso, sólo para la coordinación que tiene el segundo factor puesto.
 *
 * A quién se le valida el código sale de la cookie previa y no del formulario:
 * si saliera del formulario, cualquiera podría pedir el paso dos de una cuenta
 * ajena sin haber pasado nunca por el uno.
 */
async function confirmarCodigo(datos: FormData, usuario: string): Promise<EstadoIngreso> {
  const perfilId = await leerCookiePrevia()
  if (!perfilId) {
    return {
      usuario,
      error: 'Pasaron más de cinco minutos desde que escribiste la contraseña. Empezá de nuevo.',
    }
  }

  const codigo = String(datos.get('codigo') ?? '').trim()
  const conRespaldo = datos.get('respaldo') === '1'

  if (!codigo) {
    return {
      segundoFactor: true,
      usuario,
      error: conRespaldo
        ? 'Escribí uno de tus códigos de respaldo.'
        : 'Escribí el código de seis dígitos.',
    }
  }

  const r = await verificarSegundoFactor(perfilId, codigo)
  if (r.ok === true) return entrar(r.perfil)

  /*
   * El secreto guardado no se puede leer más: cambió AUTH_SECRET del servidor.
   * Ningún código de ese teléfono va a entrar, por bien que se lo escriba, así
   * que decir «el código no es correcto» es mandar a alguien a intentarlo hasta
   * trabarse. El camino que sí existe son los códigos de respaldo, que son
   * hashes y no dependen de ninguna variable de entorno; la pantalla queda
   * abierta en ese modo y el intento no gastó nada.
   */
  if (r.ok === false && r.motivo === 'secreto_ilegible') {
    return {
      segundoFactor: true,
      respaldo: true,
      usuario,
      error:
        'Este teléfono ya no sirve para esta cuenta: entrá con uno de tus códigos de respaldo. '
        + 'Después, desde Mi cuenta, volvé a configurar el código del celular.',
    }
  }

  // Ni el bloqueo ni la baja se arreglan escribiendo otro código. Se corta acá
  // el paso intermedio para no dejarlos probando contra una puerta que, hasta
  // que pase el rato o alguien la reactive, no abre con nada.
  if (r.ok === false && r.motivo !== 'credenciales') {
    await borrarCookiePrevia()
    return {
      usuario,
      error:
        r.motivo === 'bloqueado'
          ? `Demasiados intentos. Probá de nuevo en ${enMinutos(r.minutos)}.`
          : 'Este usuario está desactivado. Hablá con la coordinadora.',
    }
  }

  return {
    segundoFactor: true,
    usuario,
    error: conRespaldo
      ? 'Ese código de respaldo no sirve. Cada uno vale una sola vez: si ya lo usaste, probá con otro.'
      : 'El código no es correcto. Fijate que sea el que la app muestra en este momento.',
  }
}

/** Abre la sesión de verdad y manda a donde corresponde. No vuelve. */
async function entrar(perfil: PerfilAutenticado): Promise<never> {
  // Si quedó la cookie del paso intermedio, no tiene por qué sobrevivir a una
  // sesión entera.
  await borrarCookiePrevia()

  await crearCookieDeSesion({
    id: perfil.id,
    rol: perfil.rol,
    sitio_id: perfil.sitio_id,
    nombre: perfil.nombre,
    sesion_horas: perfil.sesion_horas,
  })

  redirect(perfil.rol === 'admin' ? '/tablero' : '/turno')
}

export async function salir() {
  await cerrarSesion()
  // Quien sale a mitad del segundo paso deja la cookie previa viva cinco
  // minutos más. No abre nada por sí sola, pero tampoco tiene por qué quedar.
  await borrarCookiePrevia()
  redirect('/ingresar')
}
