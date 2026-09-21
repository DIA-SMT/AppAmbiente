/**
 * Verificación de credenciales.
 *
 * Corre como servicio porque hay que leer el perfil antes de que exista
 * sesión: es la única lectura del sistema que no pasa por las políticas.
 *
 * El PIN es corto porque se teclea en la calle. Lo que compensa esa debilidad
 * es el bloqueo por intentos: cinco fallos seguidos y el usuario del sitio
 * queda trabado cinco minutos. Sin eso, cuatro dígitos se prueban a mano.
 *
 * La coordinación entra en dos pasos: correo institucional y contraseña
 * primero, código de seis dígitos después. Los dos pasos gastan del MISMO
 * contador de intentos fallidos y caen en el mismo bloqueo; si cada uno
 * llevara el suyo, el segundo factor serían seis dígitos que se prueban de a
 * un millón. El vigilador sigue entrando en un solo paso, igual que siempre.
 */
import 'server-only'
import { comoServicio } from '@db/sesion'
import type { Conexion } from '@db/client'
import { hashearCredencial, verificarCredencial } from '@db/credenciales'
import { descifrarSecreto, verificarCodigo } from '@db/totp'

const INTENTOS_MAXIMOS = 5
const MINUTOS_BLOQUEO = 5

// Se compara contra este hash cuando el identificador no existe, para gastar el
// mismo tiempo que en el caso bueno: si no, se puede averiguar qué usuarios hay
// mirando cuál responde más rápido.
const HASH_FANTASMA = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PerfilAutenticado {
  id: string
  usuario: string
  nombre: string
  rol: 'admin' | 'vigilador'
  sitio_id: string | null
  sesion_horas: number | null
}

export type ResultadoAcceso =
  /** Vigilador, o admin que todavía no configuró el segundo factor. */
  | { ok: true; perfil: PerfilAutenticado }
  /** La contraseña estaba bien, pero falta el código. */
  | { ok: 'segundo_factor'; perfilId: string }
  /**
   * `secreto_ilegible` es el caso raro que no se puede confundir con un código
   * mal tecleado: el secreto guardado no se puede descifrar —AUTH_SECRET
   * cambió— y entonces NINGÚN código de ese teléfono va a entrar nunca. Decirle
   * «el código no es correcto» manda a alguien a probar cinco veces hasta
   * trabarse la cuenta por un problema que no está de su lado.
   */
  | { ok: false; motivo: 'credenciales' | 'bloqueado' | 'inactivo' | 'secreto_ilegible'; minutos?: number }

interface FilaPerfil {
  id: string
  usuario: string
  nombre: string
  rol: 'admin' | 'vigilador'
  sitio_id: string | null
  sesion_horas: number | null
  credencial_hash: string
  activo: boolean
  intentos_fallidos: number
  bloqueado_hasta: string | null
  correo: string | null
  totp_secreto: string | null
  totp_confirmado_en: string | null
  totp_ultimo_paso: string | number | null
  codigos_respaldo: string[] | null
}

/** Las que existen desde siempre. */
const COLUMNAS_VIEJAS = `id, usuario, nombre, rol, sitio_id, sesion_horas, credencial_hash,
                         activo, intentos_fallidos, bloqueado_hasta`

/** Las que agrega la 0023. */
const COLUMNAS_0023 = ['correo', 'totp_secreto', 'totp_confirmado_en', 'totp_ultimo_paso', 'codigos_respaldo']

/**
 * Lo mismo, pero en nulos, para cuando la base todavía no tiene la 0023.
 *
 * Los tipos van escritos porque después se comparan y se guardan: un `null`
 * pelado le llega a Postgres como `text` y revienta más adelante, no acá.
 */
const NULOS_0023 = `null::text as correo, null::text as totp_secreto,
                    null::timestamptz as totp_confirmado_en, null::bigint as totp_ultimo_paso,
                    null::text[] as codigos_respaldo`

/**
 * Si la base ya tiene las columnas de la 0023.
 *
 * El SQL se pega a mano en el editor del proveedor y el build sube solo a
 * Vercel: son dos pasos sueltos y nada garantiza el orden. Nombrar `correo` en
 * la consulta cuando todavía no existe no rompe una pantalla de adentro sino la
 * puerta de entrada, y ahí no entra NADIE —tampoco el vigilador con su PIN, que
 * no tiene nada que ver con el segundo factor—. Preguntar antes cuesta una
 * consulta y deja el despliegue en cualquier orden sin sacar a nadie.
 *
 * Se recuerda sólo el sí. Una columna que existe no desaparece, así que ese
 * recuerdo no puede quedar viejo; el no, en cambio, dura hasta que alguien pega
 * el SQL, y una instancia que lo hubiera guardado seguiría entrando sin segundo
 * factor hasta que la reciclen. Son unos pocos ingresos por día: preguntar de
 * nuevo mientras falte no le cuesta nada a nadie.
 */
let laBaseTieneLa0023 = false

async function tieneLa0023(tx: Conexion): Promise<boolean> {
  if (laBaseTieneLa0023) return true

  // Contra pg_attribute y no contra information_schema: esta consulta corre
  // como servicio, pero el mismo patrón se usa en /cuenta con el rol
  // `authenticated`, e information_schema esconde las columnas sobre las que el
  // rol no tiene permisos. Una sola forma de preguntar, en los dos lados.
  const [fila] = await tx.consultar<{ cuantas: number }>(
    `select count(*)::int as cuantas
       from pg_attribute
      where attrelid = 'public.perfiles'::regclass
        and not attisdropped
        and attname = any($1::text[])`,
    [COLUMNAS_0023],
  )

  laBaseTieneLa0023 = (fila?.cuantas ?? 0) === COLUMNAS_0023.length
  return laBaseTieneLa0023
}

/** El select del perfil, con las columnas nuevas o con nulos en su lugar. */
function consultaDePerfil(completa: boolean, porIdentificador: boolean): string {
  const columnas = completa ? `${COLUMNAS_VIEJAS}, ${COLUMNAS_0023.join(', ')}` : `${COLUMNAS_VIEJAS}, ${NULOS_0023}`
  if (!porIdentificador) return `select ${columnas} from perfiles where id = $1`

  // Sin la 0023 no hay correo con el cual entrar, así que queda el usuario, que
  // es con lo que se entra desde el primer día.
  if (!completa) return `select ${columnas} from perfiles where lower(usuario) = $1 limit 1`

  return `select ${columnas}
            from perfiles
           where lower(usuario) = $1 or lower(correo) = $1
           -- Si el correo de una cuenta coincidiera con el usuario de otra, gana
           -- el usuario: es el identificador que existe desde el primer día.
           order by (lower(usuario) = $1) desc
           limit 1`
}

/**
 * Lo que se escribe se compara en minúsculas y sin espacios.
 *
 * Los espacios no son manía: el teclado del celular agrega uno después de
 * autocompletar un correo, y esa cuenta existe igual.
 */
function normalizar(texto: string): string {
  return texto.replace(/\s+/g, '').toLowerCase()
}

function perfilDe(p: FilaPerfil): PerfilAutenticado {
  return {
    id: p.id, usuario: p.usuario, nombre: p.nombre, rol: p.rol,
    sitio_id: p.sitio_id, sesion_horas: p.sesion_horas,
  }
}

function sigueBloqueado(p: FilaPerfil): ResultadoAcceso | null {
  if (!p.bloqueado_hasta) return null
  const hasta = new Date(p.bloqueado_hasta)
  if (hasta <= new Date()) return null
  const minutos = Math.max(1, Math.ceil((hasta.getTime() - Date.now()) / 60000))
  return { ok: false, motivo: 'bloqueado', minutos }
}

/**
 * Suma un intento fallido y traba la cuenta si llegó al límite.
 *
 * Lo llaman los dos pasos: la contraseña equivocada y el código equivocado van
 * al mismo contador. Ver el comentario de arriba del archivo.
 */
async function sumarFallo(tx: Conexion, p: FilaPerfil): Promise<ResultadoAcceso> {
  /*
   * La cuenta la hace la base, en una sola sentencia, y la respuesta sale de lo
   * que devuelve.
   *
   * Leer el contador acá y escribir después el número calculado en JavaScript
   * parece lo mismo y no lo es: dos pedidos que leen antes de que el otro
   * escriba guardan los dos el mismo valor, así que N credenciales equivocadas
   * mandadas a la vez cuestan un solo intento. Contra el PIN de cuatro dígitos
   * del vigilador —cuya única defensa es justamente este bloqueo— eso es el
   * espacio entero en unas horas. En la base local no se ve, porque PGlite
   * serializa las transacciones; en el pooler del proveedor, con varias
   * instancias en Vercel, los pedidos son concurrentes de verdad.
   *
   * Los tipos van escritos. Sin los casts, Postgres tiene que deducir el de un
   * mismo parámetro dos veces —en la asignación y en la comparación— y saca dos
   * distintos: «inconsistent types deduced for parameter $2, text versus
   * integer». Reventaba el ingreso entero, y sólo en el camino de la credencial
   * equivocada, que es el que nadie prueba.
   */
  const filas = await tx.consultar<{ intentos_fallidos: number }>(
    `update perfiles
        set intentos_fallidos = perfiles.intentos_fallidos + 1,
            bloqueado_hasta = case when perfiles.intentos_fallidos + 1 >= $2::int
                                   then now() + make_interval(mins => $3::int)
                                   else null end
      where id = $1
    returning intentos_fallidos`,
    [p.id, INTENTOS_MAXIMOS, MINUTOS_BLOQUEO],
  )

  // Sin fila es que el perfil se borró entre la lectura y esto. No hay contador
  // que mirar y tampoco hay a quién dejar entrar.
  const intentos = filas[0]?.intentos_fallidos ?? INTENTOS_MAXIMOS
  if (intentos >= INTENTOS_MAXIMOS) {
    return { ok: false, motivo: 'bloqueado', minutos: MINUTOS_BLOQUEO }
  }
  return { ok: false, motivo: 'credenciales' }
}

/**
 * Primer paso: quién sos y tu credencial.
 *
 * El identificador es el usuario del punto para el vigilador, y el correo
 * institucional para la coordinación. Mientras una cuenta de coordinación no
 * tenga correo cargado sigue entrando con su nombre de usuario, como hasta
 * ahora: la migración no lo hizo obligatorio justamente para que nadie quede
 * afuera el día que esto se despliega.
 */
export async function verificarAcceso(
  identificador: string,
  credencial: string,
): Promise<ResultadoAcceso> {
  const limpio = normalizar(identificador)
  if (!limpio || !credencial) return { ok: false, motivo: 'credenciales' }

  return comoServicio(async (tx): Promise<ResultadoAcceso> => {
    const completa = await tieneLa0023(tx)
    const filas = await tx.consultar<FilaPerfil>(consultaDePerfil(completa, true), [limpio])

    const p = filas[0]
    const coincide = verificarCredencial(credencial, p?.credencial_hash ?? HASH_FANTASMA)

    if (!p) return { ok: false, motivo: 'credenciales' }
    if (!p.activo) return { ok: false, motivo: 'inactivo' }

    const trabada = sigueBloqueado(p)
    if (trabada) return trabada

    // Con el correo cargado, el nombre de usuario deja de servir para entrar:
    // la cuenta de coordinación tiene un solo identificador y es el correo.
    // No suma intento fallido, igual que un identificador que no existe.
    const porCorreo = p.correo !== null && limpio === normalizar(p.correo)
    if (p.rol === 'admin' && p.correo !== null && !porCorreo) {
      return { ok: false, motivo: 'credenciales' }
    }

    if (!coincide) return sumarFallo(tx, p)

    if (p.rol === 'admin' && p.totp_confirmado_en) {
      // Ojo con limpiar el contador acá: si la contraseña correcta lo pusiera
      // en cero, quien la robó vuelve a este paso cada cinco códigos errados y
      // el bloqueo no traba nada. Se limpia recién al pasar el segundo factor.
      return { ok: 'segundo_factor', perfilId: p.id }
    }

    await tx.consultar(
      `update perfiles set intentos_fallidos = 0, bloqueado_hasta = null, ultimo_acceso = now() where id = $1`,
      [p.id],
    )

    return { ok: true, perfil: perfilDe(p) }
  })
}

/**
 * Segundo paso: el código de la aplicación, o uno de los de respaldo.
 *
 * El perfilId sale de la cookie del paso previo, no de nada que se escriba en
 * la pantalla.
 */
export async function verificarSegundoFactor(
  perfilId: string,
  codigo: string,
): Promise<ResultadoAcceso> {
  const escrito = codigo.replace(/\s+/g, '')
  // El perfilId viaja en una cookie. Si llega cualquier cosa, Postgres corta
  // con «invalid input syntax for type uuid» y la pantalla muestra un error
  // genérico en vez de volver a pedir el código.
  if (!UUID.test(perfilId) || !escrito) return { ok: false, motivo: 'credenciales' }

  return comoServicio(async (tx): Promise<ResultadoAcceso> => {
    // Sin la 0023 no existe el segundo factor, así que tampoco existe este
    // paso: el primero devolvió la sesión entera. Se contesta como un código
    // que no sirve y la pantalla vuelve a empezar.
    if (!(await tieneLa0023(tx))) return { ok: false, motivo: 'credenciales' }

    const filas = await tx.consultar<FilaPerfil>(consultaDePerfil(true, false), [perfilId])

    const p = filas[0]
    if (!p) return { ok: false, motivo: 'credenciales' }
    if (!p.activo) return { ok: false, motivo: 'inactivo' }

    // Si no hay segundo factor confirmado, acá no se entra: el primer paso ya
    // habría devuelto la sesión entera. Que alguien llegue igual significa que
    // el segundo factor se restableció mientras tanto —lo hizo otro admin, o
    // el comando de emergencia—; que vuelva a empezar.
    if (p.rol !== 'admin' || !p.totp_confirmado_en || !p.totp_secreto) {
      return { ok: false, motivo: 'credenciales' }
    }

    const trabada = sigueBloqueado(p)
    if (trabada) return trabada

    const exito = `intentos_fallidos = 0, bloqueado_hasta = null, ultimo_acceso = now()`

    if (/^\d{6}$/.test(escrito)) {
      const paso = pasoAceptado(p.totp_secreto, escrito)
      // Ningún código de ese teléfono va a entrar, así que esto no es alguien
      // probando: no gasta intento y no acerca el bloqueo. Un código de
      // respaldo no puede caer acá —son doce letras y números con guiones— y
      // sigue siendo la salida.
      if (paso === 'ilegible') return { ok: false, motivo: 'secreto_ilegible' }
      if (paso !== null) {
        const ultimo = p.totp_ultimo_paso == null ? null : Number(p.totp_ultimo_paso)
        // Un código dura treinta segundos y sirve una sola vez. El que ya se
        // usó vale tan poco como uno equivocado, así que también gasta intento:
        // quien lo está repitiendo es el que lo leyó por encima del hombro.
        if (ultimo !== null && paso <= ultimo) return sumarFallo(tx, p)

        // La condición va en el update y no en un if de acá arriba porque dos
        // pedidos con el mismo código pueden estar leyendo a la vez: el que
        // escribe primero deja al otro sin filas.
        const usado = await tx.consultar<{ id: string }>(
          `update perfiles
              set totp_ultimo_paso = $2::bigint, ${exito}
            where id = $1
              and (totp_ultimo_paso is null or totp_ultimo_paso < $2::bigint)
          returning id`,
          [p.id, paso],
        )
        if (usado.length === 0) return sumarFallo(tx, p)
        return { ok: true, perfil: perfilDe(p) }
      }
    }

    const formas = formasDelCodigo(escrito)
    const hash = (p.codigos_respaldo ?? []).find((h) =>
      formas.some((forma) => verificarCredencial(forma, h)),
    )
    if (hash) {
      const consumido = await tx.consultar<{ id: string }>(
        `update perfiles
            set codigos_respaldo = array_remove(codigos_respaldo, $2::text), ${exito}
          where id = $1 and $2::text = any(codigos_respaldo)
        returning id`,
        [p.id, hash],
      )
      // Sin filas es que el mismo código entró por otra pestaña un instante
      // antes. Se usa una sola vez, y ésta ya fue.
      if (consumido.length === 0) return sumarFallo(tx, p)
      return { ok: true, perfil: perfilDe(p) }
    }

    return sumarFallo(tx, p)
  })
}

/**
 * El paso que acepta el código, null si no coincide, 'ilegible' si el secreto
 * guardado no se puede descifrar.
 *
 * El secreto está cifrado con una clave derivada de AUTH_SECRET. Si esa
 * variable cambió, lo guardado no se lee más y ningún código del teléfono va a
 * coincidir nunca. Los dos casos terminan en «no entrás», pero no son lo mismo
 * y confundirlos sale caro: quien escribe el código bueno lee «el código no es
 * correcto», lo prueba cinco veces y se traba la cuenta sola por algo que no
 * está de su lado. Separados, la pantalla puede mandarlo derecho a sus códigos
 * de respaldo, que son hashes y no dependen del entorno.
 */
type PasoDelCodigo = number | null | 'ilegible'

function pasoAceptado(secretoCifrado: string, codigo: string): PasoDelCodigo {
  let secreto: string
  try {
    secreto = descifrarSecreto(secretoCifrado)
  } catch {
    return 'ilegible'
  }
  return verificarCodigo(secreto, codigo)
}

/** Los códigos de respaldo se muestran en grupos de cuatro separados por guión. */
function enGrupos(bloque: string): string {
  return (bloque.match(/.{1,4}/g) ?? []).join('-')
}

/**
 * Hashea los códigos de respaldo para guardarlos, tal como se muestran.
 *
 * Va acá, al lado del que los verifica, para que los dos lados normalicen igual:
 * si se guardan de una forma y se comparan de otra, no entra ninguno, y estos
 * códigos son justamente el último recurso de quien perdió el teléfono. Es el
 * mismo scrypt que la contraseña, así que hay un solo lugar donde mirar el día
 * que se cambie el hasheo.
 */
export function hashearCodigosDeRespaldo(codigos: string[]): string[] {
  return codigos.map((c) => hashearCredencial(enGrupos(soloAlfanumerico(c))))
}

function soloAlfanumerico(texto: string): string {
  return texto.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Las formas en que puede llegar el mismo código de respaldo.
 *
 * Se anota a mano y se escribe después como salga: con los guiones, sin
 * guiones, en minúsculas. Son todas el mismo código y todas tienen que entrar,
 * así que se prueba cada una contra el hash guardado en vez de exigir que se
 * teclee clavado a como se mostró.
 */
function formasDelCodigo(escrito: string): string[] {
  const bloque = soloAlfanumerico(escrito)
  if (!bloque) return []
  return [...new Set([enGrupos(bloque), bloque, escrito.toUpperCase()])]
}

/** Los sitios que se ofrecen en la pantalla de ingreso, con su usuario. */
export async function sitiosParaIngreso() {
  return comoServicio((tx) =>
    tx.consultar<{ usuario: string; sitio_nombre: string; sitio_tipo: string; orden: number }>(
      `select p.usuario, s.nombre as sitio_nombre, s.tipo as sitio_tipo, s.orden
         from perfiles p join sitios s on s.id = p.sitio_id
        where p.rol = 'vigilador' and p.activo and s.activo
        order by s.orden`,
    ),
  )
}
