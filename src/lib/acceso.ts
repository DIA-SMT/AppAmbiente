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
 * Se entra en un solo paso: identificador y credencial. La coordinación se
 * identifica con su correo institucional —el nombre de usuario mientras no lo
 * tenga cargado— y el vigilador con el usuario del punto, igual que siempre.
 * Lo que el panel exige después de entrar —el correo cargado, una contraseña
 * elegida por la persona y no la de fábrica— no se pide acá: se pide adentro,
 * en /cuenta, porque una cuenta a medio configurar tiene que poder entrar a
 * terminar de configurarse.
 */
import 'server-only'
import { comoServicio } from '@db/sesion'
import type { Conexion } from '@db/client'
import { verificarCredencial } from '@db/credenciales'

const INTENTOS_MAXIMOS = 5
const MINUTOS_BLOQUEO = 5

// Se compara contra este hash cuando el identificador no existe, para gastar el
// mismo tiempo que en el caso bueno: si no, se puede averiguar qué usuarios hay
// mirando cuál responde más rápido.
const HASH_FANTASMA = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA'

export interface PerfilAutenticado {
  id: string
  usuario: string
  nombre: string
  rol: 'admin' | 'vigilador'
  sitio_id: string | null
  sesion_horas: number | null
}

export type ResultadoAcceso =
  | { ok: true; perfil: PerfilAutenticado }
  | { ok: false; motivo: 'credenciales' | 'bloqueado' | 'inactivo'; minutos?: number }

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
}

/** Las que existen desde siempre. */
const COLUMNAS_VIEJAS = `id, usuario, nombre, rol, sitio_id, sesion_horas, credencial_hash,
                         activo, intentos_fallidos, bloqueado_hasta`

/**
 * Lo mismo, pero en nulos, para cuando la base todavía no tiene el correo.
 *
 * El tipo va escrito porque después se compara: un `null` pelado le llega a
 * Postgres como `text` y revienta más adelante, no acá.
 */
const SIN_CORREO = `null::text as correo`

/**
 * Si la base ya tiene la columna `correo`.
 *
 * El SQL se pega a mano en el editor del proveedor y el build sube solo a
 * Vercel: son dos pasos sueltos y nada garantiza el orden. Nombrar `correo` en
 * la consulta cuando todavía no existe no rompe una pantalla de adentro sino la
 * puerta de entrada, y ahí no entra NADIE —tampoco el vigilador con su PIN, que
 * no tiene nada que ver con el correo de la coordinación—. Preguntar antes
 * cuesta una consulta y deja el despliegue en cualquier orden sin sacar a nadie.
 *
 * Se recuerda sólo el sí. Una columna que existe no desaparece, así que ese
 * recuerdo no puede quedar viejo; el no, en cambio, dura hasta que alguien pega
 * el SQL, y una instancia que lo hubiera guardado seguiría sin aceptar el correo
 * hasta que la reciclen. Son unos pocos ingresos por día: preguntar de nuevo
 * mientras falte no le cuesta nada a nadie.
 */
let laBaseTieneCorreo = false

async function tieneCorreo(tx: Conexion): Promise<boolean> {
  if (laBaseTieneCorreo) return true

  // Contra pg_attribute y no contra information_schema: esta consulta corre
  // como servicio, pero el mismo patrón se usa en /cuenta con el rol
  // `authenticated`, e information_schema esconde las columnas sobre las que el
  // rol no tiene permisos. Una sola forma de preguntar, en los dos lados.
  const [fila] = await tx.consultar<{ cuantas: number }>(
    `select count(*)::int as cuantas
       from pg_attribute
      where attrelid = 'public.perfiles'::regclass
        and not attisdropped
        and attname = 'correo'`,
  )

  laBaseTieneCorreo = (fila?.cuantas ?? 0) === 1
  return laBaseTieneCorreo
}

/** El select del perfil, con la columna del correo o con un nulo en su lugar. */
function consultaDePerfil(conCorreo: boolean): string {
  const columnas = conCorreo ? `${COLUMNAS_VIEJAS}, correo` : `${COLUMNAS_VIEJAS}, ${SIN_CORREO}`

  // Sin la columna no hay correo con el cual entrar, así que queda el usuario,
  // que es con lo que se entra desde el primer día.
  if (!conCorreo) return `select ${columnas} from perfiles where lower(usuario) = $1 limit 1`

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

/** Suma un intento fallido y traba la cuenta si llegó al límite. */
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
 * Quién sos y tu credencial.
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
    const conCorreo = await tieneCorreo(tx)
    const filas = await tx.consultar<FilaPerfil>(consultaDePerfil(conCorreo), [limpio])

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

    await tx.consultar(
      `update perfiles set intentos_fallidos = 0, bloqueado_hasta = null, ultimo_acceso = now() where id = $1`,
      [p.id],
    )

    return { ok: true, perfil: perfilDe(p) }
  })
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
