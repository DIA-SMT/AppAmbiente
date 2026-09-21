import { redirect } from 'next/navigation'
import { conSesion, consultarConSesion } from '@db/sesion'
import { cifrarSecreto, descifrarSecreto, generarSecreto, uriDeAprovisionamiento } from '@db/totp'
import { exigirAdmin, type Sesion } from '@/lib/sesion'
import { Cuenta } from './Cuenta'

export const dynamic = 'force-dynamic'

interface FilaCuenta {
  usuario: string
  nombre: string
  correo: string | null
  totp_secreto: string | null
  totp_confirmado_en: string | null
  codigos: number
}

const COLUMNAS_NUEVAS = ['correo', 'totp_secreto', 'totp_confirmado_en', 'codigos_respaldo']

/**
 * Deja guardado un secreto para escanear y lo devuelve en claro.
 *
 * No puede generar uno nuevo en cada dibujado: quien escaneó el QR, se fue a
 * buscar el teléfono y volvió a cargar la pantalla estaría escribiendo para
 * siempre el código de un secreto que ya se reemplazó. Se guarda el primero y
 * se reusa hasta que quede confirmado.
 *
 * El `coalesce` va adentro del update y no en un if de acá porque dos pestañas
 * abiertas leen las dos que no hay secreto: la fila bloqueada hace que la
 * segunda vea lo que escribió la primera y lo respete, y las dos terminan
 * mostrando el mismo QR.
 *
 * Vive acá y no en acciones.ts porque todo lo que se exporta de un archivo
 * 'use server' queda llamable desde afuera, y esto recibe la sesión por
 * parámetro: sería escribirle el secreto a cualquier perfil.
 */
async function asegurarSecreto(sesion: Sesion, cifradoGuardado: string | null): Promise<string> {
  if (cifradoGuardado) {
    try {
      return descifrarSecreto(cifradoGuardado)
    } catch {
      // Cambió AUTH_SECRET y lo guardado no se puede leer más. Todavía no está
      // confirmado, así que no hay nada que perder: se reemplaza y sigue.
    }
  }

  const nuevo = cifrarSecreto(generarSecreto())
  const filas = await consultarConSesion<{ totp_secreto: string }>(
    sesion,
    `update perfiles
        set totp_secreto = ${cifradoGuardado ? '$2' : 'coalesce(totp_secreto, $2)'}
      where id = $1 and rol = 'admin' and totp_confirmado_en is null
    returning totp_secreto`,
    [sesion.perfilId, nuevo],
  )

  return descifrarSecreto(filas[0]?.totp_secreto ?? nuevo)
}

/**
 * El QR, dibujado del lado del servidor.
 *
 * La importación es dinámica y va envuelta: si `qrcode` no está instalado
 * —el despliegue quedó a medio camino, alguien corrió npm ci con el
 * package-lock viejo—, un import normal tira abajo la pantalla entera. Y ésta
 * es justo la que no puede caerse: sin ella no hay forma de configurar el
 * segundo factor, y con el portón puesto tampoco hay forma de hacer nada más.
 *
 * Sin QR la pantalla sigue sirviendo, porque el secreto escrito se muestra
 * siempre y se puede cargar a mano en cualquier aplicación.
 */
async function dibujarQR(uri: string): Promise<string | null> {
  try {
    const QRCode = (await import('qrcode')).default
    return await QRCode.toString(uri, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
  } catch {
    return null
  }
}

export default async function PantallaCuenta() {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')

  /*
   * Primero se pregunta si la base tiene las columnas.
   *
   * El SQL se pega a mano en Supabase y el build sube por su cuenta a Vercel:
   * son dos pasos sueltos y nada garantiza el orden. Nombrar `correo` en la
   * consulta cuando todavía no existe voltea el Server Component, y lo que ve
   * quien abre el panel es una pantalla de error sin explicación. Preguntar
   * antes cuesta una consulta que no puede fallar.
   *
   * Va contra pg_attribute y no contra information_schema porque esta consulta
   * corre con el rol `authenticated`, e information_schema esconde las columnas
   * sobre las que el rol no tiene permisos: una lista vacía por un permiso
   * diría «falta la actualización» cuando lo que falta es un grant.
   */
  const { columnas, fila } = await conSesion(sesion, async (tx) => {
    const [{ cuantas }] = await tx.consultar<{ cuantas: number }>(
      `select count(*)::int as cuantas
         from pg_attribute
        where attrelid = 'public.perfiles'::regclass
          and not attisdropped
          and attname = any($1::text[])`,
      [COLUMNAS_NUEVAS],
    )
    if (cuantas < COLUMNAS_NUEVAS.length) return { columnas: cuantas, fila: null }

    const filas = await tx.consultar<FilaCuenta>(
      `select usuario, nombre, correo, totp_secreto, totp_confirmado_en,
              coalesce(array_length(codigos_respaldo, 1), 0)::int as codigos
         from perfiles where id = $1`,
      [sesion.perfilId],
    )
    return { columnas: cuantas, fila: filas[0] ?? null }
  })

  if (columnas < COLUMNAS_NUEVAS.length) {
    return (
      <div className="pila angosto">
        <h1>Mi cuenta</h1>
        <div className="aviso atencion" role="status">
          <p className="fuerte">La base todavía no está actualizada.</p>
          <p>
            Falta aplicarle la actualización que agrega el correo institucional y el segundo
            factor. Avisale a la Dirección de Inteligencia Artificial. Mientras tanto entrás
            igual, con tu usuario y tu contraseña, y el panel funciona como siempre.
          </p>
        </div>
      </div>
    )
  }

  if (!fila) redirect('/ingresar')

  /*
   * El secreto se prepara recién cuando hay correo, porque va adentro del QR:
   * es lo que hace que en el teléfono aparezca «Residuos SMT: tu@smt.gob.ar» y
   * no una cuenta sin nombre entre otras cinco iguales.
   */
  /*
   * Un segundo factor confirmado cuyo secreto ya no se puede descifrar.
   *
   * Pasa cuando rotan AUTH_SECRET: lo guardado queda ilegible y el teléfono
   * sigue mostrando códigos que no van a entrar nunca. La pantalla no puede
   * decir «Activado» de algo que no anda, porque entonces la única acción que lo
   * arregla —«Cambié de teléfono»— es la que nadie tiene motivo para tocar. Se
   * muestra como pendiente de reconfigurar y se nombra el problema.
   */
  let secretoIlegible = false
  if (fila.totp_confirmado_en && fila.totp_secreto) {
    try {
      descifrarSecreto(fila.totp_secreto)
    } catch {
      secretoIlegible = true
    }
  }

  let secreto: string | null = null
  let qr: string | null = null
  if (fila.correo && !fila.totp_confirmado_en) {
    secreto = await asegurarSecreto(sesion, fila.totp_secreto)
    qr = await dibujarQR(uriDeAprovisionamiento(fila.correo, secreto))
  }

  /*
   * Siempre el mismo componente, con o sin nada configurado. Los ocho códigos
   * de respaldo se muestran una sola vez y viven en el estado de <Cuenta>:
   * cambiar de componente según lo que falte los borraría de la pantalla en el
   * mismo instante en que aparecen, que es la peor cosa que puede pasar acá.
   */
  return (
    <Cuenta
      datos={{
        usuario: fila.usuario,
        nombre: fila.nombre,
        correo: fila.correo,
        confirmadoEn: fila.totp_confirmado_en,
        secretoIlegible,
        codigosRestantes: fila.codigos,
        secreto,
        qr,
      }}
    />
  )
}
