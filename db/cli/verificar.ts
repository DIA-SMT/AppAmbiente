/**
 * Comprueba que las políticas de seguridad hagan lo que dicen.
 *
 *     npm run db:verificar
 *
 * No es un test unitario: es la prueba de que el modelo de permisos se cumple
 * en la base y no depende de que ninguna pantalla se acuerde de filtrar. Vale
 * la pena correrlo después de tocar db/migrations/0010_rls.sql y antes de
 * desplegar a Supabase, donde las mismas políticas se evalúan igual.
 */
import '../entorno'
import { exigirConfirmacionSiEsRemota } from './guarda'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import * as modulos from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { comoServicio, conSesion, type Sesion } from '../sesion'
import { hashearCredencial } from '../credenciales'
import { obtenerBase, describirMotor } from '../client'
import { ZONA, fechaHora } from '../../src/lib/formato'

let pasaron = 0
let fallaron = 0
let omitidas = 0

function revisar(descripcion: string, condicion: boolean, detalle = '') {
  if (condicion) {
    pasaron++
    console.log(`  ✓ ${descripcion}`)
  } else {
    fallaron++
    console.log(`  ✗ ${descripcion}${detalle ? `  → ${detalle}` : ''}`)
  }
}

/**
 * Lo que no se pudo probar, que no es lo mismo que lo que salió mal.
 *
 * Una comprobación que no corre no puede contarse como buena —sería decir que
 * algo anda cuando nadie lo miró— ni como mala, porque entonces la verificación
 * entera daría en rojo sin que haya nada roto. Se dice y se cuenta aparte.
 */
function omitir(descripcion: string, motivo: string) {
  omitidas++
  console.log(`  ~ ${descripcion}  → ${motivo}`)
}

/** Corre una consulta esperando que la base la rechace. */
async function debeFallar(descripcion: string, sesion: Sesion, sql: string, params: unknown[] = []) {
  try {
    await conSesion(sesion, (tx) => tx.consultar(sql, params))
    revisar(descripcion, false, 'la consulta pasó y no debería')
  } catch (e) {
    revisar(descripcion, true, (e as Error).message.slice(0, 60))
  }
}

/**
 * Lo que dijo la base al rechazar una consulta.
 *
 * `debeFallar` alcanza cuando lo único que importa es que no pase. Algunos
 * mensajes, en cambio, salen tal cual a la pantalla —app.eliminar_perfil le
 * escribe a quien lo va a leer— y ahí hay que mirar qué dicen: un rechazo con
 * el motivo equivocado es un rechazo que no se entiende.
 */
async function motivoDelRechazo(sesion: Sesion, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await conSesion(sesion, (tx) => tx.consultar(sql, params))
    return ''
  } catch (e) {
    return (e as Error).message
  }
}

async function contar(sesion: Sesion, sql: string, params: unknown[] = []): Promise<number> {
  const filas = await conSesion(sesion, (tx) => tx.consultar<{ c: string }>(sql, params))
  return Number(filas[0]?.c ?? 0)
}

/**
 * Si un rol de Postgres puede hacer algo, sin dejar rastro.
 *
 * Deshace siempre: varias de estas consultas —truncate, delete— tendrían efecto
 * de verdad si la base las aceptara, y justamente lo que se está probando es si
 * las acepta.
 *
 * Va sin claims a propósito. Lo que se mira acá no son las políticas sino el
 * permiso de abajo: RLS no interviene en un TRUNCATE, ni en una vista que no es
 * security_invoker.
 */
async function puede(rol: 'authenticated' | 'anon', sql: string): Promise<boolean> {
  const CORTE = '__deshacer__'
  try {
    await comoServicio(async (tx) => {
      await tx.consultar(`set local role ${rol}`)
      await tx.consultar(sql)
      throw new Error(CORTE)
    })
    return true
  } catch (e) {
    return (e as Error).message === CORTE
  }
}

interface Ensayo {
  /** Cambia de sesión sin salir de la transacción. Con null vuelve al dueño de las tablas. */
  como(sesion: Sesion | null): Promise<void>
  consultar<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** Corre algo que la base tiene que rechazar. Devuelve el motivo, o '' si lo aceptó. */
  rechazo(sql: string, params?: unknown[]): Promise<string>
}

/**
 * Una escena entera que se prueba y se deshace: puede(), pero con sesiones.
 *
 * Es para lo de Migue que no se puede escribir de verdad en la base de la
 * Secretaría, ni siquiera por un rato: todo lo de un punto —la conversación de
 * PV-02 la vería su celular, y un recuerdo suyo entraría en la próxima
 * conversación de verdad—, el gasto —sube el del mes, que es el tope de todos—
 * y lo que no tiene dueño a propósito, como una expresión o un corte por
 * maltrato, que después no habría cómo reconocer. Un corte de prueba a nombre
 * de PV-02 sería un dato falso sobre un punto real.
 *
 * `como` pone la misma identidad que conSesion(), y con null vuelve al dueño,
 * para preparar lo que ninguna sesión puede: correr un reloj para atrás.
 * `rechazo` va con un savepoint porque un error deja la transacción inservible
 * y lo que sigue de la escena ya no correría.
 *
 * Contra un Postgres de verdad esto anda porque la escena termina SIEMPRE en
 * el throw: postgres-js se anota cualquier error que haya pasado adentro de la
 * transacción, aunque alguien lo haya atajado, y lo tira al final en vez de
 * confirmar. Convertir esto en algo que confirma lo rompería ahí y no en
 * PGlite.
 */
async function ensayar<T>(escena: (e: Ensayo) => Promise<T>): Promise<T> {
  const CORTE = '__deshacer__'
  let resultado: T | undefined
  try {
    await comoServicio(async (tx) => {
      const ensayo: Ensayo = {
        async como(sesion) {
          const claims = sesion
            ? JSON.stringify({ sub: sesion.perfilId, rol: sesion.rol, sitio_id: sesion.sitioId ?? '' })
            : ''
          await tx.consultar(`select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)`, [
            sesion ? 'authenticated' : 'none',
            claims,
          ])
        },
        consultar<R>(sql: string, params: unknown[] = []) {
          return tx.consultar<R>(sql, params)
        },
        async rechazo(sql, params = []) {
          await tx.consultar('savepoint ensayo')
          try {
            await tx.consultar(sql, params)
            await tx.consultar('release savepoint ensayo')
            return ''
          } catch (e) {
            await tx.consultar('rollback to savepoint ensayo')
            return (e as Error).message || 'la base la rechazó'
          }
        },
      }
      resultado = await escena(ensayo)
      throw new Error(CORTE)
    })
  } catch (e) {
    if ((e as Error).message !== CORTE) throw e
  }
  return resultado as T
}

const MARCA = 'Generado por db:verificar'
const TELEFONOS_PRUEBA = ['3814569988']
/** La que crea esta verificación para tener algo con CUIT y teléfono que leer. */
const ENTIDAD_FIJA = 'Organización de prueba verificar'
const ENTIDADES_PRUEBA = ['Carrero de prueba', 'Productor de prueba verificar', ENTIDAD_FIJA]
const PILA_PRUEBA = 'VERIF-PRUEBA'
/** De dónde dice venir la poda que forma la pila de prueba. */
const PODA_PRUEBA = 'Poda de db:verificar'
/**
 * Adónde van las dos salidas del borde del día. Es lo que las separa de todo lo
 * demás en el buscador de Movimientos, que busca también por destino.
 */
const DESTINO_BORDE = 'Borde del día de db:verificar'

/**
 * Los tres usuarios que esta verificación necesita, y que se crea sola.
 *
 * Antes salían de la siembra —coordinacion, planta, pv02—, pero una base de
 * producción se entrega con un solo usuario y esos no existen. Creárselos acá
 * hace que la comprobación sirva contra cualquier base, que es justo cuando más
 * importa: recién creada y antes de entregarla.
 *
 * Nacen desactivados a propósito. No hace falta que entren —la verificación
 * arma la sesión directamente, sin login— y así no aparecen ni un segundo en el
 * selector de la pantalla de ingreso, que solo ofrece perfiles activos.
 *
 * usuario, nombre, rol, código de sitio
 */
const PERFILES_PRUEBA: ReadonlyArray<readonly [string, string, 'admin' | 'vigilador', string | null]> = [
  ['verif_admin',  'Verificación — coordinación', 'admin',     null],
  ['verif_planta', 'Verificación — Planta',       'vigilador', 'PVRV-VIV'],
  ['verif_punto',  'Verificación — punto verde',  'vigilador', 'PV-02'],
  // PV-03 es el punto que solo informa el conteo del día (carga_detallada en
  // false), y eso es justo lo que separa "visitas" de "vecinos identificados".
  ['verif_andes',  'Verificación — solo conteo',  'vigilador', 'PV-03'],
  // Migue no le muestra a una coordinadora lo que conversó ni lo que le pidió
  // recordar la otra, y para probarlo hacen falta dos.
  ['verif_admin_b', 'Verificación — otra coordinadora', 'admin',  null],
]

/**
 * Los dos usuarios que esta verificación crea para probar el borrado.
 *
 * Van aparte de los cuatro de arriba porque ésos cargan movimientos y controles
 * mientras corre esto: a los dos minutos de nacer ya no se pueden borrar, que es
 * la otra mitad de lo que hay que probar.
 *
 *   efímero   el caso de la pantalla: se creó, nunca entró, no dejó nada.
 *   auditado  el caso que ninguna clave foránea frena, porque auditoria.actor_id
 *             no tiene: lo único que hizo fue cambiarse el nombre a sí mismo.
 *
 * usuario, nombre
 */
const USUARIO_EFIMERO = 'verif_efimero'
const USUARIO_AUDITADO = 'verif_auditado'
const PERFILES_A_BORRAR: ReadonlyArray<readonly [string, string]> = [
  [USUARIO_EFIMERO,  'Verificación — nunca entró'],
  [USUARIO_AUDITADO, 'Verificación — solo auditoría'],
]

/**
 * La cuenta de coordinación con la que se prueba el ingreso.
 *
 * Es la única de esta verificación que tiene que estar ACTIVA: el ingreso no le
 * contesta a una cuenta desactivada, así que sin eso no hay forma de probar que
 * el correo abra la puerta ni que cinco contraseñas erradas la traben.
 *
 * Por eso es también la única con una contraseña que sirve. Se sortea en cada
 * corrida, no sale de la memoria de este proceso y la cuenta queda desactivada
 * antes de terminar: esto se corre contra la base de la Secretaría —para eso
 * está la comprobación de las claves de fábrica— y una cuenta de coordinación
 * abierta es exactamente lo que no puede dejar atrás. Si la corrida se corta por
 * la mitad y queda activa, la contraseña se fue con el proceso: no hay con qué
 * entrar, y la próxima corrida la borra antes de empezar.
 */
const USUARIO_INGRESO = 'verif_ingreso'
const CORREO_INGRESO = 'verificacion@smt.gob.ar'
/**
 * Cómo se llamaba mientras el ingreso tuvo segundo factor.
 *
 * Se sigue borrando porque esto ya corrió contra la base de la Secretaría y
 * cada corrida dejaba la cuenta desactivada, no borrada: sin esta línea,
 * «Verificación — segundo factor» le queda para siempre en la lista de usuarios
 * a una coordinación que no tiene por qué saber de dónde salió.
 */
const USUARIO_INGRESO_VIEJO = 'verif_2fa'
/** Los mismos que traban el ingreso en src/lib/acceso.ts. */
const INTENTOS_HASTA_TRABAR = 5

/**
 * Borra lo que dejó una corrida anterior, para que correr esto dos veces dé el
 * mismo resultado.
 *
 * Es el único lugar del proyecto que borra de verdad, y lo hace fuera de las
 * políticas a propósito: la app no puede borrar —el permiso está revocado para
 * todos los roles— pero un banco de pruebas que ensucia la base deja de servir
 * a la segunda corrida. Solo toca filas que creó esta misma verificación.
 */
async function limpiarRastros() {
  const usuarios = [
    ...PERFILES_PRUEBA.map((p) => p[0]),
    ...PERFILES_A_BORRAR.map((p) => p[0]),
    USUARIO_INGRESO,
    USUARIO_INGRESO_VIEJO,
  ]
  await comoServicio(async (tx) => {
    await tx.consultar(
      `delete from movimiento_items
        where movimiento_id in (select id from movimientos where observaciones = $1)`,
      [MARCA],
    )
    await tx.consultar('delete from movimientos where observaciones = $1', [MARCA])
    await tx.consultar('delete from pila_controles where observacion = $1', [MARCA])
    await tx.consultar('delete from conteos_diarios where observaciones = $1', [MARCA])
    await tx.consultar('delete from pedidos_recambio where observaciones = $1', [MARCA])
    await tx.consultar(
      'delete from vecinos where app.normalizar_telefono(telefono) = any($1::text[])',
      [TELEFONOS_PRUEBA],
    )
    await tx.consultar('delete from entidades where nombre = any($1::text[])', [ENTIDADES_PRUEBA])
    await tx.consultar(
      'delete from pila_controles where pila_id in (select id from pilas where codigo = $1)',
      [PILA_PRUEBA],
    )
    await tx.consultar('delete from pilas where codigo = $1', [PILA_PRUEBA])

    // Migue. Sus conversaciones y los recuerdos de coordinación cuelgan del
    // perfil en cascada y se irían solos con el delete de abajo, pero dos cosas
    // no: un recuerdo de un punto es del punto y no lleva perfil, y el gasto no
    // tiene clave foránea a propósito. Lo único que dice que eran de prueba es
    // la conversación donde nacieron, así que salen antes de que el perfil se
    // la lleve. Hoy esta verificación no deja ninguna de las dos —las ensaya y
    // las deshace—: esto es para el día que algo que tenía que fallar pase.
    //
    // Y sólo si la 0025 está: esto tiene que poder correr contra una base
    // donde Migue todavía no se instaló.
    const [migue] = await tx.consultar<{ hay: boolean }>(
      `select to_regclass('public.migue_mensajes') is not null as hay`,
    )
    if (migue?.hay) {
      const DE_PRUEBA = `select c.id from migue_conversaciones c join perfiles p on p.id = c.abierta_por_id
                          where p.usuario = any($1::text[])`
      await tx.consultar(`delete from migue_recuerdos where conversacion_id in (${DE_PRUEBA})`, [usuarios])
      await tx.consultar(
        `delete from migue_gasto
          where conversacion_id in (${DE_PRUEBA})
             or dueno in (select 'perfil:' || id from perfiles where usuario = any($1::text[]))`,
        [usuarios],
      )
      await tx.consultar(
        `delete from migue_conversaciones
          where abierta_por_id in (select id from perfiles where usuario = any($1::text[]))`,
        [usuarios],
      )
    }

    // Último: casi todas las tablas de arriba los referencian con `on delete
    // restrict`, así que hasta acá no se pueden sacar.
    await tx.consultar('delete from perfiles where usuario = any($1::text[])', [usuarios])
  })
}

/**
 * Crea los usuarios de prueba y devuelve sus sesiones. La credencial es
 * un hash de algo al azar: nadie tiene que poder entrar con ellos.
 */
async function sesionesDePrueba(): Promise<
  Record<'admin' | 'otraCoordinadora' | 'planta' | 'punto' | 'andes', Sesion>
> {
  const filas = await comoServicio(async (tx) => {
    for (const [usuario, nombre, rol, sitioCodigo] of PERFILES_PRUEBA) {
      await tx.consultar(
        `insert into perfiles (usuario, nombre, rol, sitio_id, credencial_hash, sesion_horas, activo)
         select $1, $2, $3,
                case when $4::text is null then null else (select id from sitios where codigo = $4) end,
                $5, null, false
          where not exists (select 1 from perfiles where lower(usuario) = lower($1))`,
        [usuario, nombre, rol, sitioCodigo, hashearCredencial(randomUUID())],
      )
    }
    return tx.consultar<{ id: string; usuario: string; rol: 'admin' | 'vigilador'; sitio_id: string | null; nombre: string }>(
      `select id, usuario, rol, sitio_id, nombre from perfiles where usuario = any($1::text[])`,
      [PERFILES_PRUEBA.map((p) => p[0])],
    )
  })

  const buscar = (u: string): Sesion => {
    const p = filas.find((x) => x.usuario === u)
    if (!p) throw new Error(`No se pudo crear el usuario de prueba ${u}.`)
    if (p.rol === 'vigilador' && !p.sitio_id) {
      throw new Error(`Falta el sitio de ${u}. ¿Están cargados los datos base? Correr: npm run db:sembrar`)
    }
    return { perfilId: p.id, rol: p.rol, sitioId: p.sitio_id, nombre: p.nombre }
  }

  return {
    admin: buscar('verif_admin'),
    otraCoordinadora: buscar('verif_admin_b'),
    planta: buscar('verif_planta'),
    punto: buscar('verif_punto'),
    andes: buscar('verif_andes'),
  }
}

type ModuloIngreso = typeof import('../../src/lib/acceso')
let porQueNoSeCargo = ''
type ModuloDatos = typeof import('../../src/lib/datos')
let porQueNoSeCargaronLosDatos = ''
let serverOnlyResuelto = false

/**
 * `server-only` lo resuelve el build de Next por su cuenta, pero no está en
 * package.json: en un `tsx` suelto, importar src/lib/acceso.ts se caía con
 * "Cannot find package 'server-only'" y las comprobaciones del ingreso se
 * salteaban. Y se salteaban en silencio —la corrida igual terminaba en "0 mal"—,
 * que es la peor forma de perder una prueba: la que se pierde sin avisar.
 *
 * Venía andando por un stub escrito a mano dentro de node_modules, sin
 * versionar, que cualquier `npm install` se lleva puesto. Así que en vez de
 * depender de ese archivo, acá se resuelve el nombre a un módulo vacío, que es
 * exactamente lo que el paquete de verdad expone bajo la condición
 * `react-server`. Fuera de esta CLI no cambia nada: la app la sigue armando Next.
 */
function resolverServerOnly() {
  // Lo piden la capa de datos, el ingreso y Migue: con un enganche alcanza.
  if (serverOnlyResuelto) return
  serverOnlyResuelto = true

  // registerHooks() existe desde Node 22.15. En uno anterior no se engancha
  // nada y las cuatro del ingreso, las tres de los filtros por fecha y las
  // seis del código de Migue se saltean, avisando: vale más que corran las
  // otras que tumbar la verificación entera acá.
  const registrar = modulos.registerHooks
  if (typeof registrar !== 'function') return

  registrar({
    resolve(especificador, contexto, siguiente) {
      if (especificador === 'server-only') {
        return { url: 'data:text/javascript,', shortCircuit: true }
      }
      return siguiente(especificador, contexto)
    },
  })
}

/**
 * Las funciones de ingreso, que viven del lado de la app y no de la base.
 *
 * Se piden con un import dinámico para poder decir por qué no se cargaron si
 * algún día dejan de cargarse, en vez de tumbar las otras setenta.
 */
async function cargarIngreso(): Promise<ModuloIngreso | null> {
  try {
    resolverServerOnly()
    return await import('../../src/lib/acceso')
  } catch (e) {
    porQueNoSeCargo = (e as Error).message.split('\n')[0].slice(0, 90)
    return null
  }
}

/**
 * Las consultas de las pantallas, tal cual las usan ellas.
 *
 * Los filtros por fecha de /movimientos y /trazabilidad se prueban con sus
 * propias funciones y no con un SQL copiado acá: una copia pasa aunque la
 * pantalla se rompa, que es justo lo que no tiene que poder pasar.
 */
async function cargarDatos(): Promise<ModuloDatos | null> {
  try {
    resolverServerOnly()
    return await import('../../src/lib/datos')
  } catch (e) {
    porQueNoSeCargaronLosDatos = (e as Error).message.split('\n')[0].slice(0, 90)
    return null
  }
}

interface ModuloMigue {
  herramientas: typeof import('../../src/lib/migue/herramientas/index')
  coordinacion: typeof import('../../src/lib/migue/herramientas/coordinacion')
  catalogo: typeof import('../../src/lib/migue/catalogo')
  verificador: typeof import('../../src/lib/migue/verificador')
}
let porQueNoSeCargoMigue = ''

/**
 * El código de Migue, que vive del lado de la app y arrastra `server-only`.
 * Igual que cargarDatos(): con import dinámico, para poder decir por qué no se
 * cargó en vez de tumbar todo lo demás.
 */
async function cargarMigue(): Promise<ModuloMigue | null> {
  try {
    resolverServerOnly()
    const [herramientas, coordinacion, catalogo, verificador] = await Promise.all([
      import('../../src/lib/migue/herramientas/index'),
      import('../../src/lib/migue/herramientas/coordinacion'),
      import('../../src/lib/migue/catalogo'),
      import('../../src/lib/migue/verificador'),
    ])
    return { herramientas, coordinacion, catalogo, verificador }
  } catch (e) {
    porQueNoSeCargoMigue = (e as Error).message.split('\n')[0].slice(0, 90)
    return null
  }
}

/**
 * Lo que el modo estricto del proveedor no acepta en la definición de una
 * herramienta, con dónde está.
 *
 * Con `strict` el proveedor garantiza que los argumentos cumplan el esquema,
 * pero sólo si el esquema entero es de los que sabe garantizar: cada objeto,
 * también los de adentro, con additionalProperties en false y todas sus
 * propiedades en `required`. Uno que no cumple no da error al armarlo: da un
 * 400 del proveedor en la primera pregunta, o peor, argumentos inventados. Y
 * un tipo 'null' es la otra forma de decir «sin filtro» que tipos.ts prohíbe:
 * ahí va el centinela del enum o el texto vacío.
 */
function faltasDelEsquema(definicion: { function: { name: string; strict: unknown; parameters: unknown } }): string[] {
  const { name: nombre, strict, parameters } = definicion.function
  const faltas: string[] = []
  if (strict !== true) faltas.push(`${nombre} sin strict`)
  if ((parameters as { type?: unknown } | null)?.type !== 'object') faltas.push(`${nombre} no recibe un objeto`)

  const mirar = (nodo: unknown, donde: string): void => {
    if (Array.isArray(nodo)) {
      nodo.forEach((hijo, i) => mirar(hijo, `${donde}[${i}]`))
      return
    }
    if (typeof nodo !== 'object' || nodo === null) return
    const esquema = nodo as Record<string, unknown>
    const tipos = Array.isArray(esquema.type) ? esquema.type : [esquema.type]
    if (tipos.includes('null') || (Array.isArray(esquema.enum) && esquema.enum.includes(null))) {
      faltas.push(`${donde} admite null`)
    }
    if (tipos.includes('object')) {
      const propiedades = Object.keys((esquema.properties ?? {}) as object).sort().join()
      const requeridas = [...((esquema.required ?? []) as string[])].sort().join()
      if (esquema.additionalProperties !== false) faltas.push(`${donde} sin additionalProperties: false`)
      if (propiedades !== requeridas) faltas.push(`${donde} no pide todas sus propiedades`)
    }
    for (const [clave, valor] of Object.entries(esquema)) mirar(valor, `${donde}.${clave}`)
  }
  mirar(parameters, nombre)
  return faltas
}

/**
 * Migue, el asistente de consultas de la 0025.
 *
 * Va en una función aparte y no suelto en main() como lo demás por una sola
 * razón: tiene que poder no correr. El despliegue es primero el SQL y después
 * el código, y esto se corre antes; contra una base que todavía no tiene la
 * 0025 se dice una vez y se sigue con el resto.
 *
 * Lo que se prueba de la base es lo que tiene que cumplirse aunque el código
 * de src/lib/migue se equivoque: quién lee qué, que cada escritura pase por su
 * función con guarda, que nada se borre. Lo que se prueba del código es lo que
 * ninguna política ve: que las cifras que Migue cita sean las de la base, que
 * las herramientas no tengan con qué salirse de la sesión y que el proveedor
 * pueda cumplir sus esquemas.
 *
 * Esto se corre contra la base de la Secretaría, así que lo que se escribe se
 * separa en dos:
 *
 *   de verdad   lo de las dos coordinadoras de prueba. Nadie más lo ve —la
 *               coordinación no lee las conversaciones ni los recuerdos de la
 *               otra— y se va en cascada con sus perfiles en limpiarRastros().
 *   ensayado    todo lo que tocaría algo real, con ensayar(): lo de un punto,
 *               el gasto, el vocabulario y el corte por maltrato.
 */
async function verificarMigue(sesiones: Record<'admin' | 'otraCoordinadora' | 'planta' | 'punto' | 'andes', Sesion>) {
  const { admin, otraCoordinadora, planta, punto, andes } = sesiones

  const [instalado] = await comoServicio((tx) =>
    tx.consultar<{ hay: boolean }>(`select to_regclass('public.migue_mensajes') is not null as hay`),
  )
  if (!instalado?.hay) {
    console.log('\n  Migue')
    omitir('todo lo de Migue', 'esta base no tiene la 0025_migue.sql: correr npm run db:migrar')
    return
  }

  const reglas = await import('../../src/lib/reglas')
  const MODELO = 'openai/gpt-4o-mini'
  const SISTEMA = `Sistema de prueba · ${MARCA}`
  const ABRIR_DE_COORDINACION = `
    insert into migue_conversaciones (rol, perfil_id, abierta_por_id, modelo, sistema, herramientas, recuerdos_incluidos)
    values ('admin', $1, $2, $3, $4, '[]', $5::uuid[])
    returning id`
  const ABRIR_DEL_PUNTO = `
    insert into migue_conversaciones (rol, sitio_id, dispositivo_id, abierta_por_id, modelo, sistema, herramientas)
    values ('vigilador', $1, $2, $3, $4, $5, '[]')
    returning id`
  const RECLAMAR = 'select app.migue_reclamar($1, $2) as estado'
  const GUARDAR = `select app.migue_guardar_turno($1, $2, $3::text[], $4::text[], $5::text[], $6::text[],
                                                   $7::text[], $8::text[]) as orden`
  const RECORDAR = 'select app.migue_recordar($1, $2) as id'
  const VACIAR = `select app.migue_vaciar($1, 'olvido')`

  // Un turno como los de verdad: la pregunta, un pedido de consulta, su
  // resultado y la respuesta. Los mensajes salen de JSON.stringify, que deja
  // las claves en el orden en que se escribieron —role, tool_call_id,
  // content— y sin espacios. jsonb las reordena por largo y les agrega
  // espacios: si la columna lo fuera, la historia volvería cambiada y el
  // proveedor dejaría de reconocer el principio del pedido.
  const MENSAJES = [
    { role: 'user', content: '¿Cuánto entró hoy?' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_verificar', type: 'function', function: { name: 'lo_de_hoy', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'call_verificar', content: '{"total":3}' },
    { role: 'assistant', content: 'Hoy entraron 3.' },
  ].map((m) => JSON.stringify(m))
  const TURNO = [
    ['user', 'assistant', 'tool', 'assistant'],
    ['pregunta', 'intermedio', 'resultado', 'respuesta'],
    MENSAJES,
    ['¿Cuánto entró hoy?', null, null, 'Hoy entraron 3.'],
    [null, null, null, '[]'],
    [null, null, '[3]', null],
  ]

  const abrirDeCoordinacion = async (quien: Sesion, sistema = SISTEMA, recuerdos: string[] = []) => {
    const [c] = await conSesion(quien, (tx) =>
      tx.consultar<{ id: string }>(ABRIR_DE_COORDINACION, [quien.perfilId, quien.perfilId, MODELO, sistema, recuerdos]),
    )
    return c.id
  }
  const reclamar = async (quien: Sesion, conversacion: string, pregunta: string) => {
    const [f] = await conSesion(quien, (tx) => tx.consultar<{ estado: string }>(RECLAMAR, [conversacion, pregunta]))
    return f.estado
  }
  const guardar = (quien: Sesion, conversacion: string, pregunta: string) =>
    motivoDelRechazo(quien, GUARDAR, [conversacion, pregunta, ...TURNO])

  // ── Una pregunta ────────────────────────────────────────────────────
  console.log('\n  Migue · una pregunta')

  const conversacionA = await abrirDeCoordinacion(admin)
  const [primera, segunda] = [randomUUID(), randomUUID()]

  const libre = await reclamar(admin, conversacionA, primera)
  revisar('una conversación libre se reclama para la pregunta', libre === 'libre', `dio ${libre}`)
  const ocupada = await reclamar(admin, conversacionA, segunda)
  revisar('otra pregunta mientras tanto la encuentra ocupada', ocupada === 'ocupada', `dio ${ocupada}`)
  // El reintento del celular mientras el primer pedido sigue andando: no se
  // contesta dos veces ni se cobra dos veces.
  const enCurso = await reclamar(admin, conversacionA, primera)
  revisar('la misma pregunta reintentada está en curso', enCurso === 'en_curso', `dio ${enCurso}`)

  const guardado = await guardar(admin, conversacionA, primera)
  const [{ n: mensajesA }] = await conSesion(admin, (tx) =>
    tx.consultar<{ n: number }>('select count(*)::int as n from migue_mensajes where conversacion_id = $1', [conversacionA]),
  )
  revisar(
    'el turno entero se guarda de una vez',
    guardado === '' && mensajesA === MENSAJES.length,
    guardado.slice(0, 60) || `${mensajesA} mensajes de ${MENSAJES.length}`,
  )

  const volvieron = await conSesion(admin, (tx) =>
    tx.consultar<{ contenido: string }>(
      'select contenido from migue_mensajes where conversacion_id = $1 order by orden',
      [conversacionA],
    ),
  )
  // Y la prueba sólo prueba algo si jsonb de verdad lo habría cambiado.
  const [jsonb] = await comoServicio((tx) =>
    tx.consultar<{ cambiaria: boolean }>('select bool_or(c::jsonb::text <> c) as cambiaria from unnest($1::text[]) c', [
      MENSAJES,
    ]),
  )
  revisar(
    'y vuelve idéntico, como texto: jsonb le habría reordenado las claves',
    volvieron.map((f) => f.contenido).join('\n') === MENSAJES.join('\n') && jsonb?.cambiaria === true,
    jsonb?.cambiaria ? 'volvió distinto de como se guardó' : 'jsonb tampoco lo habría cambiado: la prueba no prueba nada',
  )

  const hecha = await reclamar(admin, conversacionA, primera)
  revisar('la pregunta ya guardada está hecha: se devuelve, no se cobra otra vez', hecha === 'hecha', `dio ${hecha}`)

  await debeFallar(
    'guardar un turno que no se reclamó falla',
    admin,
    GUARDAR,
    [conversacionA, randomUUID(), ...TURNO],
  )
  await debeFallar(
    'nadie inserta mensajes a mano, ni en su propia conversación',
    admin,
    `insert into migue_mensajes (conversacion_id, orden, pregunta_id, rol, tipo, contenido)
     values ($1, 99, $2, 'user', 'pregunta', '{}')`,
    [conversacionA, randomUUID()],
  )
  await debeFallar(
    'ni cambia una conversación a mano',
    admin,
    `update migue_conversaciones set turnos = 0, sistema = 'otro' where id = $1`,
    [conversacionA],
  )

  // app.migue_vaciar corre como el dueño y no mira de quién es: sólo la llaman
  // las funciones que olvidan y cortan, cada una con su guarda.
  const vaciar = await ensayar(async (e) => {
    await e.como(admin)
    const deCoordinacion = await e.rechazo(VACIAR, [conversacionA])
    await e.como(punto)
    const [c] = await e.consultar<{ id: string }>(ABRIR_DEL_PUNTO, [
      punto.sitioId, randomUUID(), punto.perfilId, MODELO, SISTEMA,
    ])
    return { deCoordinacion, delPunto: await e.rechazo(VACIAR, [c.id]) }
  })
  revisar(
    'nadie llama a app.migue_vaciar, ni la coordinación ni un punto',
    vaciar.deCoordinacion !== '' && vaciar.delPunto !== '',
    `${vaciar.deCoordinacion ? '' : 'la coordinación pudo '}${vaciar.delPunto ? '' : 'el punto pudo'}`,
  )

  // ── Recordar y olvidar ──────────────────────────────────────────────
  console.log('\n  Migue · recordar y olvidar')

  const conversacionNace = await abrirDeCoordinacion(admin)
  const recordar = async (texto: string) => {
    try {
      const [f] = await conSesion(admin, (tx) => tx.consultar<{ id: string }>(RECORDAR, [conversacionNace, texto]))
      return { id: f.id, rechazo: '' }
    } catch (e) {
      return { id: '', rechazo: (e as Error).message }
    }
  }

  // Los límites están en la base y no en el prompt: pedirle al modelo que no
  // guarde un teléfono no alcanza, y el recuerdo lo lee el del turno siguiente.
  for (const [descripcion, texto] of [
    ['no recuerda un teléfono', 'la señora Marta atiende al 381 555-1234'],
    ['ni un documento con puntos', 'el DNI del chofer es 30.123.456'],
    ['ni un correo', 'los pedidos van a compras@proveedor.com.ar'],
  ]) {
    const { rechazo } = await recordar(texto)
    revisar(descripcion, rechazo.includes('No guardo'), rechazo.slice(0, 60) || 'lo guardó')
  }
  const conFecha = await recordar('desde el 28/09/2026 el punto abre a las 8')
  revisar('una fecha con barras sí', conFecha.id !== '', conFecha.rechazo.slice(0, 60))

  const TEXTO_OLVIDABLE = 'en esta coordinación los camiones se cuentan por viaje'
  const olvidable = await recordar(TEXTO_OLVIDABLE)

  const [{ activos }] = await conSesion(admin, (tx) =>
    tx.consultar<{ activos: number }>(
      'select count(*)::int as activos from migue_recuerdos where perfil_id = $1 and olvidado_en is null',
      [admin.perfilId],
    ),
  )
  const faltan = reglas.RECUERDOS_MAXIMOS - activos
  // Todos en una sola sentencia: cada llamada ve lo que guardaron las
  // anteriores, así que el tope se cuenta igual que de a uno.
  const relleno =
    faltan > 0
      ? await motivoDelRechazo(
          admin,
          `select app.migue_recordar($1, 'relleno de db:verificar, el ' || n) from generate_series(1, $2::int) n`,
          [conversacionNace, faltan],
        )
      : ''
  const deMas = await recordar('uno más de la cuenta')
  revisar(
    `el recuerdo ${reglas.RECUERDOS_MAXIMOS + 1} se rechaza`,
    relleno === '' && deMas.rechazo.includes('Ya recuerdo'),
    relleno.slice(0, 60) || deMas.rechazo.slice(0, 60) || 'lo guardó',
  )

  // Olvidarlo tiene que vaciar la conversación donde se pidió —el pedido quedó
  // escrito ahí— y las que lo recibieron en su sistema. conversacionA es la de
  // control: no tiene nada que ver con él.
  const preguntaNace = randomUUID()
  await reclamar(admin, conversacionNace, preguntaNace)
  await guardar(admin, conversacionNace, preguntaNace)
  const conversacionIncluye = await abrirDeCoordinacion(admin, `${SISTEMA}\nLo que recordás: ${TEXTO_OLVIDABLE}`, [
    olvidable.id,
  ])

  const olvido = await motivoDelRechazo(admin, 'select app.migue_olvidar_recuerdo($1)', [olvidable.id])
  const [recuerdo] = await conSesion(admin, (tx) =>
    tx.consultar<{ texto: string; olvidado: boolean }>(
      'select texto, olvidado_en is not null as olvidado from migue_recuerdos where id = $1',
      [olvidable.id],
    ),
  )
  const trasOlvidar = await conSesion(admin, (tx) =>
    tx.consultar<{ id: string; sistema: string; recuerdos: string; vaciada_por: string | null; mensajes: number; llenos: number }>(
      `select c.id, c.sistema, c.recuerdos_incluidos::text as recuerdos, c.vaciada_por,
              (select count(*)::int from migue_mensajes m where m.conversacion_id = c.id) as mensajes,
              (select count(*)::int from migue_mensajes m where m.conversacion_id = c.id and m.contenido <> '') as llenos
         from migue_conversaciones c
        where c.id = any($1::uuid[])`,
      [[conversacionNace, conversacionIncluye, conversacionA]],
    ),
  )
  const nace = trasOlvidar.find((c) => c.id === conversacionNace)
  const incluye = trasOlvidar.find((c) => c.id === conversacionIncluye)
  const aparte = trasOlvidar.find((c) => c.id === conversacionA)
  revisar(
    'olvidar un recuerdo lo deja en blanco',
    olvido === '' && recuerdo?.texto === '' && recuerdo.olvidado,
    olvido.slice(0, 60) || `quedó «${recuerdo?.texto ?? '?'}»`,
  )
  revisar(
    'y vacía la conversación donde nació, con sus mensajes',
    nace?.vaciada_por === 'olvido' && nace.sistema === '' && nace.mensajes > 0 && nace.llenos === 0,
    nace ? `vaciada por ${nace.vaciada_por ?? 'nadie'}, ${nace.llenos} mensajes con texto` : 'no se encontró',
  )
  revisar(
    'y la que lo tenía entre sus recuerdos, con el sistema en blanco',
    incluye?.vaciada_por === 'olvido' && incluye.sistema === '' && incluye.recuerdos === '{}',
    incluye ? `vaciada por ${incluye.vaciada_por ?? 'nadie'}, recuerdos ${incluye.recuerdos}` : 'no se encontró',
  )
  revisar(
    'pero no toca las demás',
    aparte?.vaciada_por === null && aparte.sistema === SISTEMA && aparte.llenos === MENSAJES.length,
    aparte ? `vaciada por ${aparte.vaciada_por}, ${aparte.llenos} mensajes con texto` : 'no se encontró',
  )

  // ── Quién lee qué ───────────────────────────────────────────────────
  //
  // Acá no va el `app.es_admin() or …` de casi todas las políticas: una charla
  // con Migue no es un registro de trabajo, y la coordinación no la lee.
  console.log('\n  Migue · quién lee qué')

  const loDeA = async (quien: Sesion) => {
    const [f] = await conSesion(quien, (tx) =>
      tx.consultar<{ conversaciones: number; mensajes: number; recuerdos: number }>(
        `select (select count(*) from migue_conversaciones where id = $1)::int as conversaciones,
                (select count(*) from migue_mensajes where conversacion_id = $1)::int as mensajes,
                (select count(*) from migue_recuerdos where perfil_id = $2)::int as recuerdos`,
        [conversacionA, admin.perfilId],
      ),
    )
    return f
  }
  // Lo que ve la dueña va en la condición: si la A tampoco viera lo suyo, que
  // la B no lo vea no probaría nada.
  const vistoPorA = await loDeA(admin)
  const vistoPorB = await loDeA(otraCoordinadora)
  revisar(
    'la coordinadora B no ve las conversaciones de la A, ni sus mensajes',
    vistoPorA.conversaciones === 1 && vistoPorA.mensajes > 0 && vistoPorB.conversaciones === 0 && vistoPorB.mensajes === 0,
    `la A ve ${vistoPorA.conversaciones} y ${vistoPorA.mensajes}, la B ${vistoPorB.conversaciones} y ${vistoPorB.mensajes}`,
  )
  revisar(
    'ni los recuerdos de la A',
    vistoPorA.recuerdos > 0 && vistoPorB.recuerdos === 0,
    `la A ve ${vistoPorA.recuerdos}, la B ${vistoPorB.recuerdos}`,
  )
  await debeFallar(
    'ni reclama la de la A para contestar en ella',
    otraCoordinadora,
    RECLAMAR,
    [conversacionA, randomUUID()],
  )

  const delPunto = await ensayar(async (e) => {
    await e.como(punto)
    const [c] = await e.consultar<{ id: string }>(ABRIR_DEL_PUNTO, [
      punto.sitioId, randomUUID(), punto.perfilId, MODELO, SISTEMA,
    ])
    const pregunta = randomUUID()
    await e.consultar(RECLAMAR, [c.id, pregunta])
    await e.consultar(GUARDAR, [c.id, pregunta, ...TURNO])
    const [r] = await e.consultar<{ id: string }>(RECORDAR, [
      c.id, 'en este punto al contenedor de RSU le dicen el tacho grande',
    ])

    const cuanto = async (quien: Sesion) => {
      await e.como(quien)
      const [f] = await e.consultar<{ conversaciones: number; mensajes: number; recuerdos: number }>(
        `select (select count(*) from migue_conversaciones where id = $1)::int as conversaciones,
                (select count(*) from migue_mensajes where conversacion_id = $1)::int as mensajes,
                (select count(*) from migue_recuerdos where id = $2)::int as recuerdos`,
        [c.id, r.id],
      )
      return f
    }
    const visto = {
      porElPunto: await cuanto(punto),
      porCoordinacion: await cuanto(admin),
      porOtroPunto: await cuanto(andes),
      porLaPlanta: await cuanto(planta),
    }

    await e.como(punto)
    const aOtroPunto = await e.rechazo(ABRIR_DEL_PUNTO, [andes.sitioId, randomUUID(), punto.perfilId, MODELO, SISTEMA])
    const aCoordinacion = await e.rechazo(ABRIR_DE_COORDINACION, [admin.perfilId, punto.perfilId, MODELO, SISTEMA, []])
    await e.como(otraCoordinadora)
    const aLaOtra = await e.rechazo(ABRIR_DE_COORDINACION, [
      admin.perfilId, otraCoordinadora.perfilId, MODELO, SISTEMA, [],
    ])
    return { visto, aOtroPunto, aCoordinacion, aLaOtra }
  })

  const { porElPunto, porCoordinacion, porOtroPunto, porLaPlanta } = delPunto.visto
  const conteo = (v: { conversaciones: number; mensajes: number; recuerdos: number }) =>
    `${v.conversaciones} conversación, ${v.mensajes} mensajes, ${v.recuerdos} recuerdo`
  revisar(
    'la coordinación no ve las conversaciones de un punto, ni sus mensajes',
    porElPunto.conversaciones === 1 && porElPunto.mensajes > 0 &&
      porCoordinacion.conversaciones === 0 && porCoordinacion.mensajes === 0,
    `el punto ve ${conteo(porElPunto)}; la coordinación, ${conteo(porCoordinacion)}`,
  )
  // Los recuerdos de un punto son del trabajo —cómo se nombran las cosas ahí—
  // y la coordinación tiene que poder verlos y olvidarlos.
  revisar(
    'pero sí sus recuerdos',
    porElPunto.recuerdos === 1 && porCoordinacion.recuerdos === 1,
    `la coordinación ve ${porCoordinacion.recuerdos}`,
  )
  revisar(
    'un punto no ve las conversaciones de otro',
    porOtroPunto.conversaciones === 0 && porOtroPunto.mensajes === 0 &&
      porLaPlanta.conversaciones === 0 && porLaPlanta.mensajes === 0,
    `PV-03 ve ${conteo(porOtroPunto)}; la Planta, ${conteo(porLaPlanta)}`,
  )
  revisar(
    'ni los recuerdos del otro punto',
    porOtroPunto.recuerdos === 0 && porLaPlanta.recuerdos === 0,
    `PV-03 ve ${porOtroPunto.recuerdos}, la Planta ${porLaPlanta.recuerdos}`,
  )
  revisar('un punto no abre una conversación a nombre de otro punto', delPunto.aOtroPunto !== '', 'la base la aceptó')
  revisar('ni a nombre de la coordinación', delPunto.aCoordinacion !== '', 'la base la aceptó')
  revisar('una coordinadora no abre una a nombre de la otra', delPunto.aLaOtra !== '', 'la base la aceptó')

  // ── Maltrato ────────────────────────────────────────────────────────
  //
  // Se avisa una vez y se corta si sigue, y la cuenta la lleva la base: el
  // corte sólo pasa si el aviso fue en una pregunta ANTERIOR a la que está en
  // curso. Con la coordinación se prueba de verdad, en transacciones
  // separadas, porque ahí el corte no anota ningún evento: la conversación es
  // de prueba y se va con su perfil.
  console.log('\n  Migue · maltrato')

  const conversacionM = await abrirDeCoordinacion(admin)
  const cortar = async () => {
    const [f] = await conSesion(admin, (tx) =>
      tx.consultar<{ cortada: boolean }>('select app.migue_cortar_por_maltrato($1) as cortada', [conversacionM]),
    )
    return f.cortada
  }
  const preguntaDelAviso = randomUUID()
  await reclamar(admin, conversacionM, preguntaDelAviso)
  const sinAviso = await cortar()
  await conSesion(admin, (tx) => tx.consultar('select app.migue_avisar_maltrato($1)', [conversacionM]))
  const enLaDelAviso = await cortar()
  await guardar(admin, conversacionM, preguntaDelAviso)
  await reclamar(admin, conversacionM, randomUUID())
  const enLaSiguiente = await cortar()
  const [cortada] = await conSesion(admin, (tx) =>
    tx.consultar<{ vaciada_por: string | null; sistema: string }>(
      'select vaciada_por, sistema from migue_conversaciones where id = $1',
      [conversacionM],
    ),
  )
  revisar('cortar por maltrato sin haber avisado no corta', sinAviso === false)
  revisar('ni en la misma pregunta en que avisó', enLaDelAviso === false)
  revisar(
    'en la pregunta siguiente sí, y la conversación queda vaciada',
    enLaSiguiente === true && cortada?.vaciada_por === 'maltrato' && cortada.sistema === '',
    `cortó: ${enLaSiguiente}, vaciada por ${cortada?.vaciada_por ?? 'nadie'}`,
  )

  // En un punto el corte sí anota un evento, y ése no se puede escribir de
  // verdad: no tiene ni conversación ni perfil, a propósito, y sería un corte
  // que nunca pasó en PV-02.
  const enUnPunto = await ensayar(async (e) => {
    await e.como(punto)
    const [c] = await e.consultar<{ id: string }>(ABRIR_DEL_PUNTO, [
      punto.sitioId, randomUUID(), punto.perfilId, MODELO, SISTEMA,
    ])
    const pregunta = randomUUID()
    await e.consultar(RECLAMAR, [c.id, pregunta])
    await e.consultar('select app.migue_avisar_maltrato($1)', [c.id])
    await e.consultar(GUARDAR, [c.id, pregunta, ...TURNO])
    // Adentro de una transacción now() no se mueve: el aviso y el reclamo de
    // la pregunta siguiente tendrían la misma hora y la base no cortaría
    // nunca. Se corre el aviso un minuto para atrás, que es lo que habría
    // pasado entre una pregunta y la otra.
    await e.como(null)
    await e.consultar(
      `update migue_conversaciones set aviso_maltrato_en = aviso_maltrato_en - interval '1 minute' where id = $1`,
      [c.id],
    )
    const EVENTOS = `
      select count(*)::int as n from migue_eventos
       where tipo = 'maltrato' and sitio_id = $1
         and semana = date_trunc('week', now() at time zone 'America/Argentina/Tucuman')::date`
    const [antes] = await e.consultar<{ n: number }>(EVENTOS, [punto.sitioId])
    await e.como(punto)
    await e.consultar(RECLAMAR, [c.id, randomUUID()])
    const [f] = await e.consultar<{ cortada: boolean }>('select app.migue_cortar_por_maltrato($1) as cortada', [c.id])
    await e.como(null)
    const [despues] = await e.consultar<{ n: number }>(EVENTOS, [punto.sitioId])
    const columnas = await e.consultar<{ c: string }>(
      `select column_name as c from information_schema.columns
        where table_schema = 'public' and table_name = 'migue_eventos' order by 1`,
    )
    return { cortada: f.cortada, sumo: despues.n - antes.n, columnas: columnas.map((x) => x.c).join(', ') }
  })
  revisar(
    'en un punto el corte se cuenta por semana, sin hora, conversación ni perfil',
    enUnPunto.cortada && enUnPunto.sumo === 1 && enUnPunto.columnas === 'id, rol, semana, sitio_id, tipo',
    `cortó: ${enUnPunto.cortada}, sumó ${enUnPunto.sumo}; la tabla tiene ${enUnPunto.columnas}`,
  )

  // ── Gasto y vencimiento ─────────────────────────────────────────────
  console.log('\n  Migue · gasto y vencimiento')

  // Ensayado: una fila de gasto de prueba subiría el del mes, que es el tope
  // de todos, y le restaría preguntas a la Secretaría. Se mira lo que suma y
  // no lo que hay, porque en la base de verdad ya hay gasto.
  const gasto = await ensayar(async (e) => {
    const GASTADO = 'select app.migue_gasto_del_mes()::float8 as mes, app.migue_gasto_de_hoy()::float8 as hoy'
    const ANOTAR = `select app.migue_anotar_gasto(null, null, $1, $1, 'db:verificar', '{}', $2)`
    await e.como(admin)
    const [antesCoordinacion] = await e.consultar<{ mes: number; hoy: number }>(GASTADO)
    await e.como(punto)
    const [antesPunto] = await e.consultar<{ mes: number; hoy: number }>(GASTADO)
    await e.como(admin)
    await e.consultar(ANOTAR, [MODELO, 0.25])
    await e.como(punto)
    await e.consultar(ANOTAR, [MODELO, 0.125])
    const [despuesPunto] = await e.consultar<{ mes: number; hoy: number }>(GASTADO)
    const [filasDelPunto] = await e.consultar<{ n: number }>('select count(*)::int as n from migue_gasto')
    await e.como(admin)
    const [despuesCoordinacion] = await e.consultar<{ mes: number; hoy: number }>(GASTADO)
    const [filasDeCoordinacion] = await e.consultar<{ n: number }>('select count(*)::int as n from migue_gasto')
    return {
      mes: despuesPunto.mes - antesPunto.mes,
      mesIgual: Math.abs(despuesPunto.mes - despuesCoordinacion.mes) < 1e-9,
      hoyCoordinacion: despuesCoordinacion.hoy - antesCoordinacion.hoy,
      hoyPunto: despuesPunto.hoy - antesPunto.hoy,
      filasDelPunto: filasDelPunto.n,
      filasDeCoordinacion: filasDeCoordinacion.n,
    }
  })
  const casi = (a: number, b: number) => Math.abs(a - b) < 1e-9
  revisar(
    'el gasto del mes es uno solo, de todos',
    casi(gasto.mes, 0.375) && gasto.mesIgual,
    `sumó ${gasto.mes.toFixed(6)} de 0,375${gasto.mesIgual ? '' : ', y la coordinación ve otro'}`,
  )
  revisar(
    'el de hoy es de cada dueño: la persona o el punto',
    casi(gasto.hoyCoordinacion, 0.25) && casi(gasto.hoyPunto, 0.125),
    `coordinación sumó ${gasto.hoyCoordinacion.toFixed(6)}, el punto ${gasto.hoyPunto.toFixed(6)}`,
  )
  revisar(
    'un punto no lee las filas del gasto',
    gasto.filasDeCoordinacion > 0 && gasto.filasDelPunto === 0,
    `lee ${gasto.filasDelPunto}`,
  )

  // Ensayado también: app.migue_vencer recorre todas las conversaciones, y
  // en la base de verdad vaciaría las que ya tocaba vaciar antes de que las
  // vacíe la próxima pregunta, que es a quien le corresponde.
  const { HORAS_DE_CONVERSACION_DEL_PUNTO: HORAS_PUNTO, DIAS_DE_CONVERSACION_DE_COORDINACION: DIAS_COORDINACION } = reglas
  const vence = await ensayar(async (e) => {
    await e.como(punto)
    const abrir = async () =>
      (await e.consultar<{ id: string }>(ABRIR_DEL_PUNTO, [punto.sitioId, randomUUID(), punto.perfilId, MODELO, SISTEMA]))[0].id
    const vieja = await abrir()
    const quieta = await abrir()
    await e.como(admin)
    const deCoordinacion = (await e.consultar<{ id: string }>(ABRIR_DE_COORDINACION, [
      admin.perfilId, admin.perfilId, MODELO, SISTEMA, [],
    ]))[0].id
    const viejisima = (await e.consultar<{ id: string }>(ABRIR_DE_COORDINACION, [
      admin.perfilId, admin.perfilId, MODELO, SISTEMA, [],
    ]))[0].id

    await e.como(null)
    for (const [id, hace] of [
      [vieja, `${HORAS_PUNTO + 1} hours`],
      [quieta, `${HORAS_PUNTO - 1} hours`],
      [deCoordinacion, `${HORAS_PUNTO + 1} hours`],
      [viejisima, `${DIAS_COORDINACION + 1} days`],
    ]) {
      await e.consultar('update migue_conversaciones set actualizada_en = now() - $2::interval where id = $1', [id, hace])
    }
    // Recorre de a 50, de la más vieja a la más nueva. En la base de verdad
    // puede haber más de 50 esperando —una semana sin que nadie pregunte— y
    // las de prueba quedarían para la vuelta siguiente: se repite hasta que no
    // vacíe ninguna, que acá adentro no le hace nada a nadie porque se deshace.
    await e.como(punto)
    for (let vuelta = 0; vuelta < 100; vuelta++) {
      const [f] = await e.consultar<{ vaciadas: number }>('select app.migue_vencer() as vaciadas')
      if (!f?.vaciadas) break
    }
    await e.como(null)
    const filas = await e.consultar<{ id: string; vaciada_por: string | null; cerrada_por: string | null }>(
      'select id, vaciada_por, cerrada_por from migue_conversaciones where id = any($1::uuid[])',
      [[vieja, quieta, deCoordinacion, viejisima]],
    )
    const de = (id: string) => filas.find((f) => f.id === id)
    return { vieja: de(vieja), quieta: de(quieta), deCoordinacion: de(deCoordinacion), viejisima: de(viejisima) }
  })
  const estadoDe = (f?: { vaciada_por: string | null; cerrada_por: string | null }) =>
    f ? `vaciada: ${f.vaciada_por ?? 'no'}, cerrada: ${f.cerrada_por ?? 'no'}` : 'no se encontró'
  revisar(
    `lo del punto de más de ${HORAS_PUNTO} h se vacía solo`,
    vence.vieja?.vaciada_por === 'vencida',
    estadoDe(vence.vieja),
  )
  revisar(
    `a las ${HORAS_PUNTO - 1} h sólo se cierra por quieta, sin vaciarse`,
    vence.quieta?.vaciada_por === null && vence.quieta.cerrada_por === 'quieta',
    estadoDe(vence.quieta),
  )
  revisar(
    `lo de coordinación de ${HORAS_PUNTO + 1} h sigue entero`,
    vence.deCoordinacion?.vaciada_por === null && vence.deCoordinacion.cerrada_por === null,
    estadoDe(vence.deCoordinacion),
  )
  revisar(
    `y a los ${DIAS_COORDINACION + 1} días se vacía`,
    vence.viejisima?.vaciada_por === 'vencida',
    estadoDe(vence.viejisima),
  )

  // ── Vocabulario ─────────────────────────────────────────────────────
  //
  // Ensayado: una expresión no tiene dueño —es del sistema, no de una charla—
  // y una de prueba le aparecería a la coordinación para revisar.
  console.log('\n  Migue · vocabulario')

  const vocabulario = await ensayar(async (e) => {
    const ANOTAR = `select app.migue_anotar_expresion($1, 'Una expresión de prueba', 'otro', '')`
    await e.como(punto)
    await e.consultar(ANOTAR, ['la de db:verificar'])
    // Otro punto la dice con otras mayúsculas: es la misma.
    await e.como(andes)
    await e.consultar(ANOTAR, ['La de DB:Verificar'])
    await e.como(admin)
    const filas = await e.consultar<{ id: string; veces: number; estado: string }>(
      `select id, veces, estado from migue_expresiones
        where normalizada = 'la de db:verificar' and tipo = 'otro' and referencia = ''`,
    )
    const id = filas[0]?.id ?? null
    await e.como(punto)
    const delPunto = await e.rechazo(`select app.migue_revisar_expresion($1, 'aprobada')`, [id])
    await e.como(admin)
    const deCoordinacion = await e.rechazo(`select app.migue_revisar_expresion($1, 'aprobada')`, [id])
    const [revisada] = await e.consultar<{ estado: string }>('select estado from migue_expresiones where id = $1', [id])
    return { filas, delPunto, deCoordinacion, estado: revisada?.estado ?? '' }
  })
  revisar(
    'una expresión repetida suma veces, no se duplica',
    vocabulario.filas.length === 1 && vocabulario.filas[0].veces === 2 && vocabulario.filas[0].estado === 'propuesta',
    vocabulario.filas.map((f) => `${f.veces} veces, ${f.estado}`).join(' · ') || 'no quedó ninguna',
  )
  revisar(
    'sólo la coordinación la revisa',
    vocabulario.delPunto.includes('coordinación') && vocabulario.deCoordinacion === '' && vocabulario.estado === 'aprobada',
    vocabulario.delPunto ? vocabulario.deCoordinacion.slice(0, 60) || `quedó ${vocabulario.estado}` : 'el punto la aprobó',
  )

  // ── Nada se borra ───────────────────────────────────────────────────
  //
  // Olvidar vacía, no borra. DELETE y TRUNCATE siguen revocados para todos
  // (0019), y la 0025 los vuelve a sacar a mano porque aquel revoke alcanzó
  // sólo a las tablas que existían entonces. TRUNCATE no pasa por las
  // políticas: si el permiso estuviera, RLS no lo frenaría.
  console.log('\n  Migue · nada se borra')

  for (const tabla of [
    'migue_conversaciones', 'migue_mensajes', 'migue_recuerdos', 'migue_expresiones', 'migue_gasto', 'migue_eventos',
  ]) {
    const borra = await puede('authenticated', `delete from ${tabla}`)
    const trunca = await puede('authenticated', `truncate ${tabla} cascade`)
    revisar(
      `nadie borra ni trunca ${tabla}`,
      !borra && !trunca,
      [borra ? 'DELETE pasa' : '', trunca ? 'TRUNCATE pasa' : ''].filter(Boolean).join(' y '),
    )
  }

  // ── Las cifras de las reglas ────────────────────────────────────────
  //
  // Migue cita estas cifras desde src/lib/reglas.ts, y las cita como
  // respaldadas: «tenés 10 minutos para deshacerlo» pasa el control de
  // números porque el 10 sale de ahí. Si la política dijera 15, Migue le
  // mentiría al vigilador con el aval del control. Se lee el texto que la base
  // tiene guardado —el de la política, la función o la vista—, no el de la
  // migración: es el que se cumple.
  //
  // Los nombres son los de las migraciones, y no siempre los que dice el
  // comentario de reglas.ts: el disparador es app.validar_fecha_movimiento y
  // la corrección del conteo es la política conteos_editar.
  console.log('\n  Migue · las cifras de las reglas')

  type Unidad = 'minutes' | 'hours' | 'days'
  const CIFRAS: Array<[keyof typeof reglas, 'la política' | 'la función' | 'la vista', string, Unidad | RegExp]> = [
    ['MINUTOS_PARA_DESHACER', 'la política', 'movimientos_deshacer', 'minutes'],
    ['HORAS_VISIBLES_EN_EL_CELULAR', 'la política', 'movimientos_leer', 'hours'],
    ['HORAS_DE_ATRASO_MAXIMO', 'la función', 'app.validar_fecha_movimiento', 'hours'],
    ['MINUTOS_PARA_CARGA_DIFERIDA', 'la función', 'app.validar_fecha_movimiento', 'minutes'],
    ['DIAS_DE_CONTEO_PARA_ATRAS', 'la política', 'conteos_crear', /current_date\s*-\s*(\d+)/gi],
    ['DIAS_DE_CONTEO_PARA_ATRAS', 'la política', 'conteos_editar', /current_date\s*-\s*(\d+)/gi],
    ['HORAS_PARA_CANCELAR_PEDIDO', 'la política', 'pedidos_cancelar', 'hours'],
    ['DIAS_PARA_PEDIDO_DEMORADO', 'la vista', 'v_pedidos_recambio', 'days'],
    ['HORAS_DE_CONVERSACION_DEL_PUNTO', 'la función', 'app.migue_vencer', 'hours'],
    ['DIAS_DE_CONVERSACION_DE_COORDINACION', 'la función', 'app.migue_vencer', 'days'],
    ['HORAS_PARA_CERRAR_QUIETA', 'la función', 'app.migue_vencer', 'hours'],
    ['RECUERDOS_MAXIMOS', 'la función', 'app.migue_recordar', /v_activos\s*>=\s*(\d+)/gi],
  ]
  const nombres = (clase: string) => CIFRAS.filter((c) => c[1] === clase).map((c) => c[2].replace(/^app\./, ''))
  const textos = new Map(
    (
      await comoServicio((tx) =>
        tx.consultar<{ objeto: string; texto: string }>(
          `select policyname as objeto, concat_ws(' ', qual, with_check) as texto
             from pg_policies where schemaname = 'public' and policyname = any($1::text[])
           union all
           select 'app.' || p.proname, string_agg(p.prosrc, ' ')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname = any($2::text[])
            group by p.proname
           union all
           select c.relname, pg_get_viewdef(c.oid)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' and c.relname = any($3::text[])`,
          [nombres('la política'), nombres('la función'), nombres('la vista')],
        ),
      )
    ).map((f) => [f.objeto, f.texto]),
  )

  for (const [constante, clase, objeto, forma] of CIFRAS) {
    const valor = reglas[constante]
    const texto = textos.get(objeto)
    const dice = typeof forma === 'string' ? `${valor} ${forma}` : String(valor)
    let coincide = false
    let enLaBase = 'no está en la base'
    if (texto !== undefined && typeof forma === 'string') {
      // Una política o una vista vuelven deparseadas —'00:10:00'::interval—
      // y una función plpgsql vuelve tal cual se escribió —interval '10
      // minutes'—. Se juntan las dos formas y los compara la base, que sabe
      // que las dos son lo mismo.
      const hallados = [...texto.matchAll(/interval\s+'([^']+)'|'([^']+)'::interval/gi)].map((m) => m[1] ?? m[2])
      const [f] = await comoServicio((tx) =>
        tx.consultar<{ esta: boolean }>('select $1::interval = any($2::text[]::interval[]) as esta', [dice, hallados]),
      )
      coincide = f?.esta === true
      enLaBase = hallados.join(', ') || 'ningún intervalo'
    } else if (texto !== undefined && forma instanceof RegExp) {
      const hallados = [...texto.matchAll(forma)].map((m) => Number(m[1]))
      coincide = hallados.includes(valor)
      enLaBase = hallados.join(', ') || 'ninguna cifra'
    }
    revisar(
      `${constante} coincide con ${clase} ${objeto}`,
      coincide,
      `reglas.ts dice ${dice}; ${clase} dice ${enLaBase}`,
    )
  }

  // ── El código ───────────────────────────────────────────────────────
  console.log('\n  Migue · el código')

  /*
   * Lo que un archivo de código nombra, sin sus comentarios: los nombres y los
   * textos —cadenas y plantillas, que es donde vive el SQL—.
   *
   * Se lee con el analizador de TypeScript y no con una expresión regular
   * porque los comentarios de src/lib/migue explican justamente lo que el
   * código no hace —«acá no hay un solo comoServicio»— y una búsqueda sobre el
   * texto crudo los daría por culpables. Lo que importa es lo que corre.
   */
  const ts = (await import('typescript')).default
  const loQueNombra = (ruta: string) => {
    const fuente = ts.createSourceFile(
      ruta, readFileSync(ruta, 'utf8'), ts.ScriptTarget.Latest, false,
      ruta.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const nombres = new Set<string>()
    const textos: string[] = []
    const recorrer = (nodo: import('typescript').Node): void => {
      if (ts.isIdentifier(nodo)) nombres.add(nodo.text)
      else if (ts.isStringLiteralLike(nodo) || ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo)) {
        textos.push(nodo.text)
      }
      ts.forEachChild(nodo, recorrer)
    }
    recorrer(fuente)
    return { nombres, textos }
  }

  const RAIZ_MIGUE = fileURLToPath(new URL('../../src/lib/migue/', import.meta.url))
  const archivos = readdirSync(RAIZ_MIGUE, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f))
    .sort()
  const leido = new Map(archivos.map((f) => [f, loQueNombra(path.join(RAIZ_MIGUE, f))]))
  const deHerramientas = archivos.filter((f) => f.startsWith(`herramientas${path.sep}`))

  // comoServicio es la única puerta que esquiva las políticas. Migue lee con
  // la sesión de quien pregunta o no lee: una herramienta que la cruzara le
  // contaría al celular de un punto lo de todos los demás.
  const conComoServicio = archivos.filter((f) => {
    const { nombres, textos } = leido.get(f)!
    return nombres.has('comoServicio') || textos.some((t) => t.includes('comoServicio'))
  })
  revisar(
    'ningún archivo de src/lib/migue nombra comoServicio',
    archivos.length > 0 && conComoServicio.length === 0,
    conComoServicio.join(', ') || 'no se encontraron los archivos',
  )

  // Las que escriben datos de personas o de entidades, las que borran o
  // formalizan, y la que cuenta lo que dejó hecho cualquier usuario mirando
  // tablas enteras. Son `security definer`: con la sesión del punto igual
  // escriben, y Migue sólo lee.
  const PROHIBIDAS = /\bapp\.(anonimizar_vecino|registrar_vecino|registrar_entidad_rapida|formalizar_destino|eliminar_perfil|rastro_de_perfil)\b/g
  const conProhibidas = deHerramientas.flatMap((f) => [
    ...new Set(leido.get(f)!.textos.flatMap((t) => [...t.matchAll(PROHIBIDAS)].map((m) => `${path.basename(f)}: app.${m[1]}`))),
  ])
  revisar(
    'ninguna herramienta nombra las funciones que escriben personas, borran o miran de más',
    deHerramientas.length > 0 && conProhibidas.length === 0,
    conProhibidas.join(', ') || 'no se encontraron las herramientas',
  )

  // La auditoría la lee entera la coordinación y guarda el antes y el después
  // de cada fila, con nombres y teléfonos. Un chat es una exportación con otro
  // nombre. Sin tilde a propósito: «auditoría» con tilde es lo que se le dice
  // a la persona, «auditoria» es la tabla.
  const AUDITORIA = /(?<![\p{L}\d_])auditoria(?![\p{L}\d_])/iu
  const conAuditoria = deHerramientas.filter((f) => leido.get(f)!.textos.some((t) => AUDITORIA.test(t)))
  revisar(
    'ninguna consulta de las herramientas nombra la tabla auditoria',
    deHerramientas.length > 0 && conAuditoria.length === 0,
    conAuditoria.map((f) => path.basename(f)).join(', ') || 'no se encontraron las herramientas',
  )

  const migue = await cargarMigue()
  if (!migue) {
    console.log(`  · no se pudo cargar src/lib/migue → ${porQueNoSeCargoMigue}`)
    for (const queda of [
      'las herramientas de coordinación tienen esquemas estrictos, y no más de 20',
      'las de un punto verde también',
      'y las de la Planta',
      'el vigilador no tiene ninguna herramienta de coordinación',
      'el control de números rechaza una cifra que ninguna consulta devolvió',
      'y deja pasar la que sí salió de una',
    ]) {
      omitir(queda, 'sin el código de Migue')
    }
    return
  }

  // Lo que recibe una conversación nueva de cada uno, armado como lo arma el
  // orquestador: el catálogo vivo leído con su sesión, sus herramientas y las
  // definiciones que salen de los dos. Los enums salen del catálogo, así que
  // con uno vacío o de mentira la prueba miraría otros esquemas.
  const { herramientasPara, definiciones } = migue.herramientas
  const loQueRecibe = (quien: Sesion) =>
    conSesion(quien, async (tx) => {
      const [sitio] = quien.sitioId
        ? await tx.consultar<{ id: string; codigo: string; nombre: string; tipo: 'planta' | 'punto_verde'; carga_detallada: boolean }>(
            'select id, codigo, nombre, tipo, carga_detallada from sitios where id = $1',
            [quien.sitioId],
          )
        : []
      const puntoDeLaSesion = sitio
        ? { id: sitio.id, codigo: sitio.codigo, nombre: sitio.nombre, tipo: sitio.tipo, cargaDetallada: sitio.carga_detallada }
        : null
      const catalogo = await migue.catalogo.leerCatalogo(tx, {
        rol: quien.rol, perfilId: quien.perfilId, punto: puntoDeLaSesion,
      })
      const herramientas = herramientasPara(quien.rol, puntoDeLaSesion)
      return { herramientas, definiciones: definiciones(herramientas, catalogo) }
    })

  // Veinte es lo que el proveedor recomienda no pasar: con más, el modelo
  // elige peor, y cada definición viaja entera en cada pregunta.
  const HERRAMIENTAS_MAXIMAS = 20
  const recibe = { coordinacion: await loQueRecibe(admin), puntoVerde: await loQueRecibe(punto), planta: await loQueRecibe(planta) }
  for (const [descripcion, r] of [
    ['las herramientas de coordinación tienen esquemas estrictos, y no más de 20', recibe.coordinacion],
    ['las de un punto verde también', recibe.puntoVerde],
    ['y las de la Planta', recibe.planta],
  ] as const) {
    const faltas = r.definiciones.flatMap((d) => faltasDelEsquema(d))
    if (r.definiciones.length > HERRAMIENTAS_MAXIMAS) faltas.unshift(`son ${r.definiciones.length}`)
    revisar(descripcion, r.definiciones.length > 0 && faltas.length === 0, faltas.slice(0, 3).join(' · ') || 'no tiene ninguna')
  }

  // Ni una de las de coordinación, ni una compartida que sea sólo de
  // coordinación: la negativa por permiso se decide antes de consultar,
  // porque RLS recorta en silencio y un cero leído como «no cargó nada» es una
  // acusación falsa.
  const deCoordinacion = new Set(migue.coordinacion.HERRAMIENTAS_DE_COORDINACION.map((h) => h.nombre))
  const prestadas = [...recibe.puntoVerde.herramientas, ...recibe.planta.herramientas]
    .filter((h) => deCoordinacion.has(h.nombre) || !h.roles.includes('vigilador'))
    .map((h) => h.nombre)
  revisar(
    'el vigilador no tiene ninguna herramienta de coordinación',
    deCoordinacion.size > 0 && prestadas.length === 0,
    [...new Set(prestadas)].join(', '),
  )

  // El control de números, que es lo que no deja pasar una cifra hecha de
  // memoria: «312,5 m³» inventado se lee igual que el verdadero.
  const { verificarNumeros } = migue.verificador
  const ahora = new Date()
  const inventada = verificarNumeros('En agosto entraron 312,5 m³ a la Planta.', [296.4], ahora)
  revisar(
    'el control de números rechaza una cifra que ninguna consulta devolvió',
    !inventada.ok && inventada.sinRespaldo.includes('312,5'),
    inventada.sinRespaldo.join(', ') || 'la dejó pasar',
  )
  const respaldada = verificarNumeros('En agosto entraron 296,4 m³ a la Planta.', [296.4], ahora)
  revisar('y deja pasar la que sí salió de una', respaldada.ok, `rechazó ${respaldada.sinRespaldo.join(', ')}`)
}

async function main() {
  console.log(`\n  Verificación de permisos · ${describirMotor()}\n`)
  await limpiarRastros()

  const sesiones = await sesionesDePrueba()
  const { admin, planta, punto: otroPunto, andes } = sesiones

  // Contra una base recién creada no hay nada cargado, y una comprobación sobre
  // la nada engaña en las dos direcciones: "la coordinadora ve los movimientos"
  // falla por no haber ninguno, y "el vigilador no lee entidades" pasa porque no
  // hay entidades que leer. Así que se pone una fila de cada cosa antes de
  // empezar. limpiarRastros() las saca al final.
  await comoServicio(async (tx) => {
    await tx.consultar(
      `insert into entidades (nombre, tipo, habilitada_destino, flujos, cuit, telefono, notas)
       select $1, 'organizacion', true, array['planta']::text[], '30-11111111-1', '381 400 0000', $2
        where not exists (select 1 from entidades where nombre = $1)`,
      [ENTIDAD_FIJA, MARCA],
    )
    const [mov] = await tx.consultar<{ id: string }>(
      `insert into movimientos (flujo, tipo, sitio_id, origen_clase, origen_detalle,
                                destino_clase, destino_sitio_id, cargado_por_id, observaciones)
       values ('planta', 'ingreso', $1, 'texto', 'Preparación de db:verificar',
               'sitio', $1, $2, $3)
       returning id`,
      [planta.sitioId, planta.perfilId, MARCA],
    )
    await tx.consultar(
      `insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id)
       select $1, m.id, 1, m.unidad_default_id
         from materiales m
        where m.activo and 'planta' = any(m.flujos) and 'ingreso' = any(m.tipos)
        order by m.orden limit 1`,
      [mov.id],
    )
  })

  console.log('  Lectura de movimientos')
  const totalAdmin = await contar(admin, 'select count(*) c from movimientos')
  revisar('la coordinadora ve los movimientos', totalAdmin > 0, `ve ${totalAdmin}`)

  // Se cuentan los movimientos DE LA PLANTA que ve un vigilador de otro punto.
  // Contar todos daría falso positivo apenas ese punto tenga los suyos, que es
  // justamente lo que pasa desde que existe el flujo de Puntos Verdes.
  const plantaDesdeOtroPunto = await contar(
    otroPunto,
    `select count(*) c from movimientos where sitio_id = (select id from sitios where codigo = 'PVRV-VIV')`,
  )
  revisar(
    'un vigilador no ve movimientos de otro sitio',
    plantaDesdeOtroPunto === 0,
    `ve ${plantaDesdeOtroPunto}`,
  )

  console.log('\n  Datos personales')
  const entidadesAdmin = await contar(admin, 'select count(*) c from entidades')
  const entidadesVig = await contar(planta, 'select count(*) c from entidades')
  const publicasVig = await contar(planta, 'select count(*) c from entidades_publicas')
  revisar('la coordinadora lee la tabla entidades (con CUIT y teléfono)', entidadesAdmin > 0)
  revisar('el vigilador no lee la tabla entidades', entidadesVig === 0, `lee ${entidadesVig}`)
  revisar('el vigilador sí lee la vista sin datos de contacto', publicasVig > 0, `lee ${publicasVig}`)

  const vecinosVig = await contar(planta, 'select count(*) c from vecinos')
  revisar('el vigilador no lee vecinos', vecinosVig === 0, `lee ${vecinosVig}`)

  const auditoriaVig = await contar(planta, 'select count(*) c from auditoria')
  revisar('el vigilador no lee la auditoría', auditoriaVig === 0, `lee ${auditoriaVig}`)

  console.log('\n  Escritura')
  await debeFallar('nadie puede borrar un movimiento (ni la coordinadora)', admin, 'delete from movimientos')
  await debeFallar(
    'un vigilador no puede cargar en otro sitio',
    otroPunto,
    `insert into movimientos (flujo, tipo, sitio_id, origen_clase, origen_detalle,
                              destino_clase, destino_sitio_id, cargado_por_id)
     values ('planta', 'ingreso', (select id from sitios where codigo = 'PVRV-VIV'),
             'texto', 'prueba', 'sitio', (select id from sitios where codigo = 'PVRV-VIV'), $1)`,
    [otroPunto.perfilId],
  )
  await debeFallar(
    'un vigilador no puede cargar a nombre de otro',
    planta,
    `insert into movimientos (flujo, tipo, sitio_id, origen_clase, origen_detalle,
                              destino_clase, destino_sitio_id, cargado_por_id)
     values ('planta', 'ingreso', $1, 'texto', 'prueba', 'sitio', $1, $2)`,
    [planta.sitioId, admin.perfilId],
  )
  // Una UPDATE que no alcanza ninguna fila no da error: simplemente no cambia
  // nada. Lo que hay que verificar es el efecto, no la excepción.
  await conSesion(planta, (tx) => tx.consultar(`update materiales set nombre = 'alterado'`))
  const alterados = await contar(admin, `select count(*) c from materiales where nombre = 'alterado'`)
  revisar('un vigilador no puede editar las listas maestras', alterados === 0, `${alterados} alterados`)
  await debeFallar(
    'un vigilador no puede cargar un movimiento de hace una semana',
    planta,
    `insert into movimientos (flujo, tipo, sitio_id, ocurrido_en, origen_clase, origen_detalle,
                              destino_clase, destino_sitio_id, cargado_por_id)
     values ('planta', 'ingreso', $1, now() - interval '7 days', 'texto', 'prueba',
             'sitio', $1, $2)`,
    [planta.sitioId, planta.perfilId],
  )

  console.log('\n  Auditoría')
  const antes = await contar(admin, 'select count(*) c from auditoria')
  await conSesion(planta, async (tx) => {
    const [mov] = await tx.consultar<{ id: string }>(
      `insert into movimientos (flujo, tipo, sitio_id, origen_clase, origen_detalle,
                                destino_clase, destino_sitio_id, cargado_por_id, observaciones)
       values ('planta', 'ingreso', $1, 'texto', 'Prueba de verificación', 'sitio', $1, $2,
               'Generado por db:verificar')
       returning id`,
      [planta.sitioId, planta.perfilId],
    )
    // Con su material, para que en los listados no aparezca como un movimiento roto.
    await tx.consultar(
      `insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id)
       select $1, m.id, 1, m.unidad_default_id
         from materiales m
        where m.activo and 'planta' = any(m.flujos) and 'ingreso' = any(m.tipos)
        order by m.orden limit 1`,
      [mov.id],
    )
  })
  const despues = await contar(admin, 'select count(*) c from auditoria')
  revisar('cargar un movimiento deja rastro en la auditoría', despues > antes, `${antes} → ${despues}`)

  const conActor = await contar(
    admin,
    `select count(*) c from auditoria where tabla = 'movimientos' and actor_id = $1`,
    [planta.perfilId],
  )
  revisar('la auditoría guarda quién lo cargó', conActor > 0)


  // ═══ Fase 2 · Puntos Verdes ═══════════════════════════════════════════
  const pv = otroPunto

  console.log('\n  Puntos Verdes · vecinos')

  // El mismo número escrito de cuatro formas tiene que dar una sola clave.
  const claves = await comoServicio((tx) =>
    tx.consultar<{ n: string }>('select app.normalizar_telefono(t) as n from unnest($1::text[]) t', [
      ['0381 15 456-1122', '+54 9 381 456 1122', '381 456 1122', '3814561122'],
    ]),
  )
  const distintas = new Set(claves.map((c) => c.n))
  revisar(
    'cuatro formatos del mismo teléfono son un solo vecino',
    distintas.size === 1,
    [...distintas].join(' / '),
  )

  const material = (
    await conSesion(pv, (tx) =>
      tx.consultar<{ id: string; unidad_default_id: string }>(
        `select id, unidad_default_id from materiales
          where activo and 'punto_verde' = any(flujos) and 'ingreso' = any(tipos)
          order by orden limit 1`,
      ),
    )
  )[0]

  const vecinosAntes = await contar(admin, 'select count(*) c from vecinos')
  for (const tel of ['0381 15 456-9988', '+54 9 381 456 9988']) {
    await conSesion(pv, async (tx) => {
      const [v] = await tx.consultar<{ id: string }>(
        'select app.registrar_vecino($1, $2, $3, $4) as id',
        ['Prueba Verificar', tel, 'Centro', pv.sitioId],
      )
      const [mov] = await tx.consultar<{ id: string }>(
        `insert into movimientos (flujo, tipo, sitio_id, origen_clase, origen_vecino_id,
                                  destino_clase, destino_sitio_id, cargado_por_id, observaciones)
         values ('punto_verde', 'ingreso', $1, 'vecino', $2, 'sitio', $1, $3,
                 'Generado por db:verificar')
         returning id`,
        [pv.sitioId, v.id, pv.perfilId],
      )
      await tx.consultar(
        `insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id)
         values ($1, $2, 1, $3)`,
        [mov.id, material.id, material.unidad_default_id],
      )
    })
  }
  const vecinosDespues = await contar(admin, 'select count(*) c from vecinos')
  revisar(
    'dos visitas del mismo vecino crean un solo vecino',
    vecinosDespues - vecinosAntes === 1,
    `${vecinosDespues - vecinosAntes} filas nuevas`,
  )

  const resumen = await conSesion(admin, (tx) =>
    tx.consultar<{ visitas: string; identificados: string }>(
      `select coalesce(sum(visitas), 0)::text as visitas,
              coalesce(sum(identificados), 0)::text as identificados
         from v_vecinos_por_periodo where sitio_id = $1`,
      [pv.sitioId],
    ),
  )
  revisar(
    'el tablero distingue visitas de vecinos identificados',
    Number(resumen[0].visitas) > Number(resumen[0].identificados),
    `${resumen[0].visitas} visitas · ${resumen[0].identificados} identificados`,
  )

  console.log('\n  Puntos Verdes · alta rápida de contrapartes')

  const carrero = await conSesion(pv, (tx) =>
    tx.consultar<{ id: string }>(
      "select app.registrar_entidad_rapida('Carrero de prueba', 'carrero', 'punto_verde') as id",
    ),
  )
  revisar('el vigilador puede dar de alta un carrero', Boolean(carrero[0]?.id))

  const marcada = await contar(
    admin,
    `select count(*) c from entidades
      where nombre in ('Carrero de prueba', 'Productor de prueba verificar') and pendiente_revision and not habilitada_origen`,
  )
  revisar('queda pendiente de revisión y solo como destino', marcada === 1)

  for (const [etiqueta, tipo] of [
    ['una empresa', 'empresa'],
    ['una dependencia municipal', 'dependencia_municipal'],
  ] as const) {
    await debeFallar(
      `el vigilador no puede dar de alta ${etiqueta}`,
      pv,
      'select app.registrar_entidad_rapida($1, $2, $3)',
      ['Trucha SA', tipo, 'punto_verde'],
    )
  }

  // Una tabla nueva sin GRANT falla con "permission denied" antes de que las
  // políticas siquiera se evalúen. Pasó con pila_controles: se detecta acá para
  // que no vuelva a pasar con la próxima.
  const sinPermiso = await comoServicio((tx) =>
    tx.consultar<{ tabla: string }>(
      `select c.relname as tabla
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and not has_table_privilege('authenticated', c.oid, 'SELECT')
        order by 1`,
    ),
  )
  revisar(
    'todas las tablas tienen permiso de lectura para la app',
    sinPermiso.length === 0,
    sinPermiso.map((t) => t.tabla).join(', '),
  )

  console.log('\n  Puntos Verdes · destinos escritos a mano')

  // Dos salidas al mismo destino escrito a mano, una con otras mayúsculas.
  const TEXTO = 'Productor de prueba verificar'
  for (const escrito of [TEXTO, TEXTO.toUpperCase()]) {
    await conSesion(pv, async (tx) => {
      const [mov] = await tx.consultar<{ id: string }>(
        `insert into movimientos (flujo, tipo, sitio_id, origen_clase, origen_sitio_id,
                                  destino_clase, destino_detalle, cargado_por_id, observaciones)
         values ('punto_verde', 'salida', $1, 'sitio', $1, 'texto', $2, $3,
                 'Generado por db:verificar')
         returning id`,
        [pv.sitioId, escrito, pv.perfilId],
      )
      await tx.consultar(
        `insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id)
         values ($1, $2, 1, $3)`,
        [mov.id, material.id, material.unidad_default_id],
      )
    })
  }

  // Dos grupos, no uno: la vista agrupa respetando mayúsculas, para que la
  // coordinadora vea cómo lo escribieron de verdad. La función que formaliza,
  // en cambio, compara en minúsculas y se lleva las dos variantes.
  const aparece = await contar(
    admin,
    'select count(*) c from v_destinos_a_formalizar where lower(destino) = lower($1)',
    [TEXTO],
  )
  revisar(
    'un destino escrito a mano aparece para formalizar',
    aparece === 2,
    `${aparece} variantes (se escribió de dos formas)`,
  )

  await conSesion(admin, (tx) =>
    tx.consultar('select app.formalizar_destino($1, $2, $3, $4)', [
      TEXTO, 'Productor de prueba verificar', 'otro', 'punto_verde',
    ]),
  )

  const reapuntados = await contar(
    admin,
    `select count(*) c from movimientos m
       join entidades e on e.id = m.destino_entidad_id
      where e.nombre = 'Productor de prueba verificar' and m.destino_clase = 'entidad'`,
  )
  revisar(
    'formalizarlo reapunta los movimientos que ya lo usaban',
    reapuntados === 2,
    `${reapuntados} de 2 (incluye el escrito en mayúsculas)`,
  )

  const sigueSuelto = await contar(
    admin,
    'select count(*) c from v_destinos_a_formalizar where lower(destino) = lower($1)',
    [TEXTO],
  )
  revisar('y deja de figurar como pendiente', sigueSuelto === 0)

  await debeFallar(
    'un vigilador no puede formalizar destinos',
    pv,
    "select app.formalizar_destino('x', 'Trucha', 'empresa', 'punto_verde')",
  )

  // ═══ Pilas de compost ═════════════════════════════════════════════════
  console.log('\n  Pilas de compost')

  // Una base recién creada no tiene pilas: las arma la Planta a medida que
  // junta poda. Para poder probar las políticas hace falta una, así que si no
  // hay se crea acá y limpiarRastros() la saca al final.
  await comoServicio((tx) =>
    tx.consultar(
      `insert into pilas (codigo, sitio_id, estado, fecha_armado, notas)
       select $1, $2, 'en_formacion', current_date, $3
        where not exists (select 1 from pilas where codigo = $1)`,
      [PILA_PRUEBA, planta.sitioId, MARCA],
    ),
  )

  const [unaPila] = await conSesion(planta, (tx) =>
    tx.consultar<{ id: string; codigo: string }>(
      'select id, codigo from v_pilas where activo order by codigo limit 1',
    ),
  )
  revisar('el vigilador de la Planta ve sus pilas', Boolean(unaPila?.id))
  if (!unaPila?.id) throw new Error('Sin pila no se pueden probar los controles.')

  const pilasDesdeOtroPunto = await contar(pv, 'select count(*) c from v_pilas')
  revisar(
    'un vigilador de punto verde no ve las pilas de la Planta',
    pilasDesdeOtroPunto === 0,
    `ve ${pilasDesdeOtroPunto}`,
  )

  const controlesAntes = await contar(admin, 'select count(*) c from pila_controles')
  await conSesion(planta, (tx) =>
    tx.consultar(
      `insert into pila_controles (pila_id, tipo, registrado_por_id, observacion)
       values ($1, 'volteo', $2, $3)`,
      [unaPila.id, planta.perfilId, MARCA],
    ),
  )
  const controlesDespues = await contar(admin, 'select count(*) c from pila_controles')
  revisar('el vigilador puede anotar un volteo', controlesDespues === controlesAntes + 1)

  await debeFallar(
    'no puede anotarlo en una pila de otro sitio',
    pv,
    `insert into pila_controles (pila_id, tipo, registrado_por_id, observacion)
     values ($1, 'volteo', $2, $3)`,
    [unaPila.id, pv.perfilId, MARCA],
  )

  await debeFallar(
    'no puede anotar a nombre de otro',
    planta,
    `insert into pila_controles (pila_id, tipo, registrado_por_id, observacion)
     values ($1, 'riego', $2, $3)`,
    [unaPila.id, admin.perfilId, MARCA],
  )

  await debeFallar(
    'una temperatura sin valor se rechaza',
    planta,
    `insert into pila_controles (pila_id, tipo, registrado_por_id, observacion)
     values ($1, 'temperatura', $2, $3)`,
    [unaPila.id, planta.perfilId, MARCA],
  )

  // La cadena completa: la composición de una pila sale de los ingresos que la
  // formaron, no de una declaración. Es lo que vuelve contestable la pregunta
  // "¿de dónde salió este camión de compost?".
  //
  // El ingreso y la salida los arma esta misma verificación sobre la pila de
  // prueba. Antes se miraba lo primero que hubiera cargado la Planta y eso
  // dejaba la comprobación colgada de los datos: alcanzaba con que hubiera
  // ingresos vinculados a pilas y ninguna salida todavía —que es exactamente la
  // base de hoy— para que se diera por fallada sin que nada estuviera roto.
  const [salida] = await comoServicio(async (tx) => {
    const [pila] = await tx.consultar<{ id: string }>(
      'select id from pilas where codigo = $1',
      [PILA_PRUEBA],
    )
    if (!pila) throw new Error('Sin la pila de prueba no se puede armar la cadena del compost.')

    const [ingreso] = await tx.consultar<{ id: string }>(
      `insert into movimientos (flujo, tipo, sitio_id, pila_id, origen_clase, origen_detalle,
                                destino_clase, destino_sitio_id, cargado_por_id, observaciones)
       values ('planta', 'ingreso', $1, $2, 'texto', $3, 'sitio', $1, $4, $5)
       returning id`,
      [planta.sitioId, pila.id, PODA_PRUEBA, planta.perfilId, MARCA],
    )
    // La unidad tiene que convertir a m³: con kilos o bolsas el volumen que
    // formó la pila da cero y la comprobación pasaría por el motivo equivocado.
    await tx.consultar(
      `insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id)
       select $1,
              (select id from materiales
                where activo and 'planta' = any(flujos) and 'ingreso' = any(tipos)
                order by orden limit 1),
              5,
              (select id from unidades where factor_m3 > 0 order by factor_m3 limit 1)`,
      [ingreso.id],
    )

    return tx.consultar<{ id: string }>(
      `insert into movimientos (flujo, tipo, sitio_id, pila_id, origen_clase, origen_sitio_id,
                                destino_clase, destino_detalle, tipo_valorizacion,
                                cargado_por_id, observaciones)
       values ('planta', 'salida', $1, $2, 'sitio', $1, 'texto', 'Huerta de db:verificar',
               'uso_interno_huerta', $3, $4)
       returning id`,
      [planta.sitioId, pila.id, planta.perfilId, MARCA],
    )
  })

  const [cadena] = await conSesion(admin, (tx) =>
    tx.consultar<{ pila: string; m3: string | null; procedencias: string | null }>(
      `select pila, m3_que_la_formaron::text as m3, procedencias
         from v_trazabilidad_salidas
        where movimiento_id = $1`,
      [salida.id],
    ),
  )
  revisar(
    'una salida de compost sabe de qué pila y de qué poda viene',
    Number(cadena?.m3 ?? 0) > 0 && cadena?.procedencias === PODA_PRUEBA,
    cadena
      ? `${cadena.pila}: ${Number(cadena.m3 ?? 0).toFixed(2)} m³ de ${cadena.procedencias ?? 'ninguna procedencia'}`
      : 'la salida no aparece en v_trazabilidad_salidas',
  )

  // ═══ Dónde termina el día ═════════════════════════════════════════════
  //
  // Supabase y PGlite corren en UTC, y la base cortaba los días a la medianoche
  // de allá, que en Tucumán son las 21: una salida del 31/08 a las 23:30 caía en
  // septiembre en el tablero, y «hasta el 31/08» en Movimientos no la traía. Lo
  // arregla la zona que ponen conSesion() y comoServicio(), así que se prueba
  // por las dos puertas y con las consultas de las pantallas.
  //
  // Las dos salidas del borde salen de la pila de prueba: así sirven también
  // para Trazabilidad, que es la otra pantalla que filtra por rango.
  console.log('\n  Dónde termina el día')

  const ZONA_PUESTA = "select current_setting('TimeZone') as zona"
  const [conIdentidad] = await conSesion(admin, (tx) => tx.consultar<{ zona: string }>(ZONA_PUESTA))
  const [comoElIngreso] = await comoServicio((tx) => tx.consultar<{ zona: string }>(ZONA_PUESTA))
  revisar(
    'las pantallas, el ingreso y estos comandos cortan los días en Tucumán',
    conIdentidad?.zona === ZONA && comoElIngreso?.zona === ZONA,
    `con sesión ${conIdentidad?.zona ?? '?'} · como servicio ${comoElIngreso?.zona ?? '?'}`,
  )

  /** Las salidas de la Planta que el tablero cuenta en agosto y en septiembre de 2026. */
  const salidasPorMes = async () => {
    const filas = await conSesion(admin, (tx) =>
      tx.consultar<{ mes: string; n: string }>(
        `select mes::text as mes, sum(movimientos)::text as n
           from v_resumen_mensual
          where flujo = 'planta' and tipo = 'salida' and mes in ('2026-08-01', '2026-09-01')
          group by mes`,
      ),
    )
    const del = (mes: string) => Number(filas.find((f) => f.mes === mes)?.n ?? 0)
    return { agosto: del('2026-08-01'), septiembre: del('2026-09-01') }
  }

  // Se cuenta lo que suman y no lo que hay: en agosto y en septiembre ya hay
  // salidas de verdad, y las de prueba tienen que caer una en cada mes.
  const antesDelBorde = await salidasPorMes()

  // Como servicio, igual que el resto de lo que esta verificación prepara: un
  // vigilador no puede cargar nada de hace un mes. Los instantes llevan la zona
  // escrita, así que qué hora son no depende de la sesión: lo que se mira es
  // dónde los corta la base al leerlos.
  const borde = await comoServicio(async (tx) => {
    const [pila] = await tx.consultar<{ id: string }>('select id from pilas where codigo = $1', [PILA_PRUEBA])
    const ids = { agosto: '', septiembre: '' }
    for (const [mes, instante] of [
      ['agosto', '2026-08-31T23:30:00-03:00'],
      ['septiembre', '2026-09-01T00:30:00-03:00'],
    ] as const) {
      const [mov] = await tx.consultar<{ id: string }>(
        `insert into movimientos (flujo, tipo, sitio_id, pila_id, ocurrido_en, origen_clase, origen_sitio_id,
                                  destino_clase, destino_detalle, tipo_valorizacion,
                                  cargado_por_id, observaciones)
         values ('planta', 'salida', $1, $2, $3, 'sitio', $1, 'texto', $4, 'uso_interno_huerta', $5, $6)
         returning id`,
        [planta.sitioId, pila?.id ?? null, instante, DESTINO_BORDE, planta.perfilId, MARCA],
      )
      // Con su material: v_resumen_mensual sale de los ítems, y un movimiento
      // sin ninguno no figura en ningún mes.
      await tx.consultar(
        `insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id)
         select $1, m.id, 1, m.unidad_default_id
           from materiales m
          where m.activo and 'planta' = any(m.flujos) and 'salida' = any(m.tipos)
          order by m.orden limit 1`,
        [mov.id],
      )
      ids[mes] = mov.id
    }
    return ids
  })

  const despuesDelBorde = await salidasPorMes()
  const sumaron =
    `agosto sumó ${despuesDelBorde.agosto - antesDelBorde.agosto}, ` +
    `septiembre ${despuesDelBorde.septiembre - antesDelBorde.septiembre}`
  revisar(
    'una salida del 31/08 a las 23:30 cuenta en agosto en el tablero',
    despuesDelBorde.agosto - antesDelBorde.agosto === 1,
    sumaron,
  )
  revisar(
    'y una del 01/09 a las 00:30, en septiembre',
    despuesDelBorde.septiembre - antesDelBorde.septiembre === 1,
    sumaron,
  )

  const datos = await cargarDatos()
  if (!datos) {
    console.log(`  · no se pudo cargar src/lib/datos.ts → ${porQueNoSeCargaronLosDatos}`)
    for (const queda of [
      'el filtro «hasta el 31/08» de Movimientos trae la de las 23:30 y no la de las 00:30',
      'y «el 01/09», al revés',
      'Trazabilidad corta el rango antes del tope de filas',
    ]) {
      omitir(queda, 'sin la capa de datos')
    }
  } else {
    const { buscarMovimientosEnTx, trazabilidadDeSalidasEnTx } = datos
    const [hasta31, del1] = await conSesion(admin, (tx) =>
      Promise.all([
        buscarMovimientosEnTx(tx, { flujo: 'planta', texto: DESTINO_BORDE, hasta: '2026-08-31' }),
        buscarMovimientosEnTx(tx, {
          flujo: 'planta', texto: DESTINO_BORDE, desde: '2026-09-01', hasta: '2026-09-01',
        }),
      ]),
    )
    const HORA_DE = { [borde.agosto]: 'la de las 23:30', [borde.septiembre]: 'la de las 00:30' }
    const cuales = (r: { filas: Array<{ id: string }> }) =>
      r.filas.map((f) => HORA_DE[f.id] ?? f.id).join(' y ') || 'ninguna'
    revisar(
      'el filtro «hasta el 31/08» de Movimientos trae la de las 23:30 y no la de las 00:30',
      hasta31.filas.length === 1 && hasta31.filas[0].id === borde.agosto,
      `trajo ${cuales(hasta31)}`,
    )
    revisar(
      'y «el 01/09», al revés',
      del1.filas.length === 1 && del1.filas[0].id === borde.septiembre,
      `trajo ${cuales(del1)}`,
    )

    // Con tope de una fila, lo más nuevo hasta el 31/08 tiene que ser la salida
    // de las 23:30. Con el `hasta` aplicado después del tope, esa única fila era
    // la más nueva de todas —la de la cadena del compost, de recién— y el corte
    // la tiraba: el rango salía vacío.
    const [ultima] = await conSesion(admin, (tx) =>
      trazabilidadDeSalidasEnTx(tx, { desde: '2026-08-31', hasta: '2026-08-31', limite: 1 }),
    )
    revisar(
      'Trazabilidad corta el rango antes del tope de filas',
      ultima?.movimiento_id === borde.agosto,
      ultima ? `trajo el Nº ${ultima.numero}, del ${fechaHora(ultima.ocurrido_en)}` : 'no trajo ninguna',
    )
  }

  // ═══ Conteo diario ════════════════════════════════════════════════════
  console.log('\n  Conteo diario de vecinos')

  // El punto que solo informa el conteo del día, no vecino por vecino.
  const sesionAndes = andes

  const antesConteo = await contar(admin, 'select count(*) c from conteos_diarios')
  for (const cuantos of [15, 18]) {
    await conSesion(sesionAndes, (tx) =>
      tx.consultar(
        `insert into conteos_diarios (sitio_id, fecha, vecinos, observaciones, cargado_por_id)
         values ($1, current_date, $2, $3, $4)
         on conflict (sitio_id, fecha) do update
           set vecinos = excluded.vecinos, observaciones = excluded.observaciones`,
        [sesionAndes.sitioId, cuantos, MARCA, sesionAndes.perfilId],
      ),
    )
  }
  const despuesConteo = await contar(admin, 'select count(*) c from conteos_diarios')
  const valorFinal = await contar(
    admin,
    'select vecinos c from conteos_diarios where sitio_id = $1 and fecha = current_date',
    [sesionAndes.sitioId],
  )
  revisar(
    'corregir el conteo del día no duplica la fila',
    despuesConteo - antesConteo <= 1 && valorFinal === 18,
    `${despuesConteo - antesConteo} filas nuevas, quedó en ${valorFinal}`,
  )

  await debeFallar(
    'no se puede cargar el conteo de otro punto',
    pv,
    `insert into conteos_diarios (sitio_id, fecha, vecinos, observaciones, cargado_por_id)
     values ($1, current_date, 99, $2, $3)`,
    [sesionAndes.sitioId, MARCA, pv.perfilId],
  )

  await debeFallar(
    'no se puede cargar un conteo de hace meses',
    sesionAndes,
    `insert into conteos_diarios (sitio_id, fecha, vecinos, observaciones, cargado_por_id)
     values ($1, current_date - 90, 10, $2, $3)`,
    [sesionAndes.sitioId, MARCA, sesionAndes.perfilId],
  )

  // Lo que hace que el indicador no mienta: un punto que solo cuenta suma
  // visitas pero no aporta vecinos identificados, porque el conteo no sabe
  // quién vino. Mezclarlos inventaría personas que nadie registró.
  const [mezcla] = await conSesion(admin, (tx) =>
    tx.consultar<{ visitas: string; identificados: string; contadas: string }>(
      `select coalesce(sum(visitas), 0)::text as visitas,
              coalesce(sum(identificados), 0)::text as identificados,
              coalesce(sum(contadas), 0)::text as contadas
         from v_vecinos_por_periodo
        where sitio_codigo = 'PV-03'`,
    ),
  )
  revisar(
    'un punto que solo cuenta suma visitas pero no vecinos identificados',
    Number(mezcla.visitas) > 0 &&
      Number(mezcla.identificados) === 0 &&
      Number(mezcla.contadas) === Number(mezcla.visitas),
    `${mezcla.visitas} visitas · ${mezcla.identificados} identificados · ${mezcla.contadas} de conteo`,
  )

  const conDetalle = await contar(
    admin,
    `select count(*) c from v_vecinos_por_periodo
      where sitio_codigo <> 'PV-03' and identificados > 0`,
  )
  revisar('los puntos que cargan en detalle sí identifican vecinos', conDetalle > 0)

  // ═══ Recambio de contenedores ═════════════════════════════════════════
  console.log('\n  Recambio de contenedores')

  const [contenedor] = await conSesion(pv, (tx) =>
    tx.consultar<{ id: string; codigo: string }>(
      'select id, codigo from contenedores where sitio_actual_id = $1 and activo limit 1',
      [pv.sitioId],
    ),
  )
  revisar('el vigilador ve los contenedores de su punto', Boolean(contenedor?.id))

  const deOtroPunto = await contar(
    pv,
    `select count(*) c from contenedores
      where activo and sitio_actual_id <> $1 and sitio_actual_id is not null`,
    [pv.sitioId],
  )
  revisar(
    'y no los de otro punto',
    deOtroPunto === 0,
    `ve ${deOtroPunto}`,
  )

  await conSesion(pv, (tx) =>
    tx.consultar(
      `insert into pedidos_recambio
         (sitio_id, contenedor_id, pedido_por_id, observaciones)
       values ($1, $2, $3, $4)`,
      [pv.sitioId, contenedor.id, pv.perfilId, MARCA],
    ),
  )
  const [pedido] = await conSesion(admin, (tx) =>
    tx.consultar<{ id: string; horas_totales: string }>(
      'select id, horas_totales::text from v_pedidos_recambio where observaciones = $1',
      [MARCA],
    ),
  )
  revisar('puede pedir un recambio y la espera se empieza a contar', Boolean(pedido?.id))

  // El vigilador de la Planta intentando pedir para un punto verde: son dos
  // sesiones de sitios distintos, que es lo que hay que probar. `pv` y
  // `otroPunto` son la misma sesión, así que usarlas acá no probaría nada.
  await debeFallar(
    'no puede pedir para otro punto',
    planta,
    `insert into pedidos_recambio (sitio_id, contenedor_id, pedido_por_id, observaciones)
     values ($1, $2, $3, $4)`,
    [pv.sitioId, contenedor.id, planta.perfilId, MARCA],
  )

  // Marcar el retiro es de la coordinación: es quien habla con la empresa. Si
  // el vigilador pudiera cerrarlo, el tiempo de respuesta lo mediría quien más
  // gana con que sea corto.
  //
  // Acá la base tira excepción en vez de no hacer nada, porque la política que
  // le deja cancelar su propio pedido tiene un WITH CHECK: la fila entra al
  // filtro pero el valor nuevo no pasa la condición.
  await debeFallar(
    'no puede dar por retirado un pedido',
    pv,
    "update pedidos_recambio set estado = 'retirado', retirado_en = now() where id = $1",
    [pedido.id],
  )

  await conSesion(admin, (tx) =>
    tx.consultar(
      `update pedidos_recambio
          set estado = 'retirado', retirado_en = now(), remito = 'R-VERIFICAR',
              avisado_en = coalesce(avisado_en, now()), avisado_por_id = $2
        where id = $1`,
      [pedido.id, admin.perfilId],
    ),
  )
  const [respuesta] = await conSesion(admin, (tx) =>
    tx.consultar<{ retirados: string }>(
      'select retirados::text from v_respuesta_recambio where sitio_id = $1',
      [pv.sitioId],
    ),
  )
  revisar(
    'la coordinación sí, y el tiempo de respuesta queda medido',
    Number(respuesta?.retirados ?? 0) > 0,
    `${respuesta?.retirados ?? 0} retirados en ese punto`,
  )

  // ═══ Eliminar usuarios ════════════════════════════════════════════════
  //
  // El único borrado que la app puede pedir, y existe para una sola cosa: sacar
  // de la lista un usuario de prueba que nunca trabajó. La condición no vive en
  // la pantalla sino en app.eliminar_perfil, así que se prueba desde acá, que es
  // donde se ve si la base la cumple aunque nadie la mire.
  console.log('\n  Eliminar usuarios')

  // Nacen sin sesión puesta —comoServicio no pone claims— así que la línea de
  // auditoría que deja el alta no los nombra a ellos como actores. Es lo mismo
  // que pasa en la pantalla: el alta la firma la coordinadora, no el recién
  // creado, y por eso un usuario nuevo empieza sin rastro propio.
  for (const [usuario, nombre] of PERFILES_A_BORRAR) {
    await comoServicio((tx) =>
      tx.consultar(
        `insert into perfiles (usuario, nombre, rol, credencial_hash, activo)
         select $1, $2, 'admin', $3, false
          where not exists (select 1 from perfiles where lower(usuario) = lower($1))`,
        [usuario, nombre, hashearCredencial(randomUUID())],
      ),
    )
  }

  const [efimero] = await conSesion(admin, (tx) =>
    tx.consultar<{ id: string; rastro: string | null }>(
      'select id, app.rastro_de_perfil(id) as rastro from perfiles where usuario = $1',
      [USUARIO_EFIMERO],
    ),
  )
  revisar(
    'un usuario recién creado no tiene ningún rastro',
    Boolean(efimero?.id) && efimero.rastro === null,
    efimero?.rastro ?? '',
  )

  // Éste hace una sola cosa, y sobre sí mismo: destrabarse el PIN, que es la
  // acción más chica que hay en la pantalla. No queda apuntado en ninguna
  // columna de ninguna tabla —ninguna clave foránea lo agarra— y aun así ya no
  // se puede borrar, porque la auditoría se acuerda y no se le puede sacar el
  // nombre a quien figura ahí.
  const [auditado] = await conSesion(admin, (tx) =>
    tx.consultar<{ id: string }>('select id from perfiles where usuario = $1', [USUARIO_AUDITADO]),
  )
  const sesionAuditado: Sesion = {
    perfilId: auditado.id,
    rol: 'admin',
    sitioId: null,
    nombre: PERFILES_A_BORRAR[1][1],
  }
  await conSesion(sesionAuditado, (tx) =>
    tx.consultar('update perfiles set intentos_fallidos = 0 where id = $1', [auditado.id]),
  )
  const [soloAuditoria] = await conSesion(admin, (tx) =>
    tx.consultar<{ rastro: string | null }>('select app.rastro_de_perfil($1) as rastro', [auditado.id]),
  )
  revisar(
    'tocar algo y nada más ya deja rastro: la auditoría no tiene clave foránea',
    soloAuditoria?.rastro === 'figura en la auditoría',
    soloAuditoria?.rastro ?? 'sin rastro',
  )

  const [conRastro] = await conSesion(admin, (tx) =>
    tx.consultar<{ rastro: string | null }>('select app.rastro_de_perfil($1) as rastro', [
      planta.perfilId,
    ]),
  )
  const rastroPlanta = conRastro?.rastro ?? ''
  revisar(
    'el que cargó movimientos sí, y se cuenta en castellano',
    rastroPlanta.includes('movimiento'),
    rastroPlanta || 'sin rastro',
  )

  await debeFallar(
    'un vigilador no puede eliminar a nadie',
    planta,
    'select app.eliminar_perfil($1)',
    [efimero.id],
  )

  // Contar el rastro es `security definer`: mira las once tablas enteras, que es
  // justo lo que el vigilador no puede mirar. Sin esta guarda alcanzaba con el
  // uuid de una coordinadora —sale de `anulado_por_id`, que sí puede leer— para
  // averiguar cuánto cargó, sin permiso de ver una sola de esas filas.
  await debeFallar(
    'y tampoco puede preguntar qué dejó hecho otro usuario',
    planta,
    'select app.rastro_de_perfil($1)',
    [admin.perfilId],
  )
  const sigueEstando = await contar(admin, 'select count(*) c from perfiles where usuario = $1', [
    USUARIO_EFIMERO,
  ])
  revisar('y el usuario sigue estando después del intento', sigueEstando === 1)

  // El orden de los controles adentro de la función también se prueba acá: la
  // coordinadora tiene rastro de sobra, así que si el de "es tu propio usuario"
  // viniera después, el error le contaría cuántos movimientos cargó en vez de
  // decirle lo único que le sirve saber.
  const propio = await motivoDelRechazo(admin, 'select app.eliminar_perfil($1)', [admin.perfilId])
  revisar('nadie puede eliminarse a sí mismo', propio.includes('tu propio usuario'), propio.slice(0, 60))

  const retenido = await motivoDelRechazo(admin, 'select app.eliminar_perfil($1)', [planta.perfilId])
  revisar(
    'al que trabajó no se lo elimina, y el error dice qué lo retiene',
    rastroPlanta !== '' && retenido.includes(rastroPlanta),
    retenido.slice(0, 80),
  )

  const porLaAuditoria = await motivoDelRechazo(admin, 'select app.eliminar_perfil($1)', [auditado.id])
  revisar(
    'al que solo figura en la auditoría, tampoco',
    porLaAuditoria.includes('figura en la auditoría'),
    porLaAuditoria.slice(0, 80),
  )

  // Se va con el correo puesto, que es lo que después hay que encontrar en la
  // línea de auditoría: es lo único que dice cuál de las cuentas era ésa.
  const CORREO_BORRADO = 'efimero.verificar@smt.gob.ar'
  await conSesion(admin, (tx) =>
    tx.consultar('update perfiles set correo = $2 where id = $1', [efimero.id, CORREO_BORRADO]),
  )

  const [borrado] = await conSesion(admin, (tx) =>
    tx.consultar<{ usuario: string }>('select app.eliminar_perfil($1) as usuario', [efimero.id]),
  )
  const quedan = await contar(admin, 'select count(*) c from perfiles where usuario = $1', [
    USUARIO_EFIMERO,
  ])
  revisar(
    'al que nunca hizo nada sí, y desaparece de la lista',
    borrado?.usuario === USUARIO_EFIMERO && quedan === 0,
    `devolvió ${borrado?.usuario ?? 'nada'}, quedan ${quedan}`,
  )

  // El disparador de la 0009 es `after insert or update`: del borrado no se
  // entera. La línea la escribe app.eliminar_perfil a mano, y sin ella la única
  // acción del sistema que no se puede deshacer sería la única sin registro.
  const [linea] = await conSesion(admin, (tx) =>
    tx.consultar<{
      borrado: string | null; actor: string | null; hash: string | null; correo: string | null
    }>(
      `select antes ->> 'usuario' as borrado,
              actor_id::text    as actor,
              antes ->> 'credencial_hash' as hash,
              antes ->> 'correo' as correo
         from auditoria
        where tabla = 'perfiles' and accion = 'eliminar' and registro_id = $1`,
      [efimero.id],
    ),
  )
  revisar(
    'del borrado queda la línea de auditoría: quién eliminó a quién',
    linea?.borrado === USUARIO_EFIMERO && linea?.actor === admin.perfilId && linea?.hash === null,
    linea
      ? `${linea.borrado} por ${linea.actor}${linea.hash === null ? '' : ', con la credencial adentro'}`
      : 'no quedó ninguna línea',
  )
  // Y queda entera menos eso. La resta de los campos reservados tiene que
  // sacar con qué se entraba y nada más: sin el correo, la línea dice que se
  // borró una cuenta pero no cuál, y esa es la única pregunta que alguien le va
  // a hacer a la auditoría el día que falte un usuario.
  revisar(
    'y queda el correo, que es lo que dice cuál cuenta era',
    linea?.correo === CORREO_BORRADO,
    linea ? `correo ${linea.correo ?? 'perdido'}` : 'no quedó ninguna línea',
  )

  // ═══ Correo y contraseña propia ═══════════════════════════════════════
  //
  // Un correo que no es del municipio tiene que entrar igual: la cuenta de
  // coordinación que usa la app no tiene casilla institucional, y cargar el
  // correo es el único camino que saca a una cuenta de la pantalla Mi cuenta.
  // Si esto vuelve a exigir el dominio, esa persona queda encerrada ahí sin
  // salida desde adentro.
  const { esCorreoValido } = await import('../../src/lib/correo')
  const aceptados = ['rocio.fernandez@gmail.com', 'alguien@smt.gob.ar', 'alguien@ia.smt.gob.ar']
  const rechazados = ['sin arroba', 'falta@elpunto', '']
  revisar(
    'un correo de cualquier proveedor sirve para entrar',
    aceptados.every(esCorreoValido) && !rechazados.some(esCorreoValido),
    aceptados.join(', '),
  )

  // Entrar al panel es correo y contraseña. Lo que la 0024 agrega
  // es que esa contraseña la tenga que elegir su dueño: mientras
  // `credencial_cambiada_en` esté en null, la que abre la cuenta la sabe también
  // quien la creó, y el portón no la deja ir a ninguna pantalla que no sea
  // /cuenta.
  //
  // Lo que se prueba acá es lo que tiene que cumplirse aunque la pantalla se
  // distraiga: que el vigilador quede afuera de todo esto, que dos cuentas no
  // compartan correo y que la marca de la contraseña propia no la complete la
  // base por su cuenta.
  console.log('\n  Correo y contraseña propia')

  // La cuenta del punto la comparten los turnos y se usa en la calle, muchas
  // veces sin señal. Que no pueda tener correo no es una convención de la
  // pantalla de usuarios: lo frena el check de la 0024.
  await debeFallar(
    'un vigilador no puede tener correo',
    admin,
    'update perfiles set correo = $2 where id = $1',
    [planta.perfilId, 'planta.verificar@smt.gob.ar'],
  )

  // Que el correo pueda faltar es lo que hace que esta tanda no deje a nadie
  // afuera: las cuentas de coordinación que hay hoy no tienen ninguno y tienen
  // que seguir entrando mañana con su nombre de usuario. Lo exige el portón de
  // /cuenta, no la columna. Si fuera obligatoria, esta verificación no habría
  // podido crear ni sus propios usuarios de prueba.
  const adminSinCorreo = await contar(
    admin,
    "select count(*) c from perfiles where rol = 'admin' and correo is null",
  )
  revisar(
    'una cuenta de coordinación sin correo sigue siendo válida',
    adminSinCorreo > 0,
    `${adminSinCorreo} sin correo`,
  )

  const CORREO_UNICO = 'coordinacion.verificar@smt.gob.ar'
  await conSesion(admin, (tx) =>
    tx.consultar('update perfiles set correo = $2 where id = $1', [admin.perfilId, CORREO_UNICO]),
  )
  await debeFallar(
    'dos cuentas no pueden compartir el correo',
    admin,
    'update perfiles set correo = $2 where id = $1',
    [auditado.id, CORREO_UNICO],
  )
  // Direccion.IA@ y direccion.ia@ son la misma casilla. El índice va por
  // lower() justamente para que la segunda no entre por escribirse distinto.
  await debeFallar(
    'ni escribiéndolo con otras mayúsculas',
    admin,
    'update perfiles set correo = $2 where id = $1',
    [auditado.id, CORREO_UNICO.toUpperCase()],
  )
  // Un correo en blanco no es «sin correo»: pasaría por el portón como cargado,
  // y el índice de arriba rechazaría a la segunda cuenta que lo dejara así con
  // un error que habla de un correo repetido que nadie escribió.
  await debeFallar(
    'ni dejarlo en blanco',
    admin,
    'update perfiles set correo = $2 where id = $1',
    [auditado.id, '   '],
  )
  // El correo de prueba se devuelve acá. La fila sobrevive hasta la próxima
  // corrida y no tiene por qué quedarse con una dirección que mañana puede ser
  // de alguien.
  await conSesion(admin, (tx) =>
    tx.consultar('update perfiles set correo = null where id = $1', [admin.perfilId]),
  )

  /*
   * La contraseña propia, que es lo que saca de circulación a las de fábrica.
   *
   * Las tres que siguen son los tres caminos por los que se escribe la marca, y
   * los tres son del código: los recorren /cuenta y la pantalla de usuarios, no
   * la base. Lo que se prueba desde acá es la mitad que sí es de la base, y que
   * haría fallar a los tres en silencio.
   *
   * Que no haya un default ni un disparador que complete la marca por su cuenta:
   * con `default now()` toda cuenta nueva nacería diciendo que su dueño ya
   * eligió su contraseña, y el panel no le pediría nunca una propia a la que
   * todavía usa la que le escribieron. Y que las políticas dejen pasar las dos
   * escrituras del panel: si `perfiles_editar` no dejara a una cuenta tocar la
   * suya, /cuenta guardaría sin guardar nada y su dueño daría vueltas por el
   * portón sin poder salir.
   */

  // verif_auditado nació hace unas líneas con el mismo insert que hace el alta
  // de la pantalla de usuarios: sin nombrar esta columna, para que quede en null.
  const [reciente] = await conSesion(admin, (tx) =>
    tx.consultar<{ sin_elegir: boolean }>(
      'select credencial_cambiada_en is null as sin_elegir from perfiles where id = $1',
      [auditado.id],
    ),
  )
  revisar(
    'una cuenta recién creada todavía usa la contraseña que le escribieron',
    reciente?.sin_elegir === true,
  )

  // Lo que guarda /cuenta cuando la persona elige la suya: la credencial y la
  // marca, juntas y en la misma transacción.
  await conSesion(admin, (tx) =>
    tx.consultar(
      `update perfiles set credencial_hash = $2, credencial_cambiada_en = now()
        where id = $1 and rol = 'admin'`,
      [admin.perfilId, hashearCredencial(randomUUID())],
    ),
  )
  const yaEsPropia = await contar(
    admin,
    'select count(*) c from perfiles where id = $1 and credencial_cambiada_en is not null',
    [admin.perfilId],
  )
  revisar('elegir la propia deja la cuenta completa', yaEsPropia === 1)

  // Y lo que guarda la pantalla de usuarios sobre una cuenta ajena. Se la marca
  // primero para que el null de después sea el que escribe esta acción y no el
  // que la fila ya traía: una contraseña que le pasaron por teléfono a su dueño
  // no es una contraseña elegida, aunque esa cuenta hubiera elegido la suya
  // alguna vez.
  await conSesion(admin, (tx) =>
    tx.consultar('update perfiles set credencial_cambiada_en = now() where id = $1', [auditado.id]),
  )
  await conSesion(admin, (tx) =>
    tx.consultar(
      `update perfiles set credencial_hash = $2, credencial_cambiada_en = null
        where id = $1 and rol = 'admin'`,
      [auditado.id, hashearCredencial(randomUUID())],
    ),
  )
  const vuelveAPendiente = await contar(
    admin,
    'select count(*) c from perfiles where id = $1 and credencial_cambiada_en is null',
    [auditado.id],
  )
  revisar(
    'cambiársela a otro la deja pendiente, para que elija la suya',
    vuelveAPendiente === 1,
  )

  // ═══ Ingreso ══════════════════════════════════════════════════════════
  console.log('\n  Ingreso')

  const ingreso = await cargarIngreso()
  if (!ingreso) {
    // El motivo se dice una vez y después se enumera lo que quedó sin correr:
    // una comprobación que no se ejecutó no es una comprobación que salió bien.
    console.log(`  · no se pudo cargar src/lib/acceso.ts → ${porQueNoSeCargo}`)
    for (const queda of [
      'la coordinación entra con su correo y su contraseña',
      'y con su nombre de usuario mientras no tenga correo cargado',
      'cinco contraseñas erradas traban la cuenta',
      'cinco contraseñas erradas a la vez cuentan las cinco',
    ]) {
      omitir(queda, 'sin las funciones de ingreso')
    }
  } else {
    const { verificarAcceso } = ingreso
    const clave = randomUUID()
    const [cuenta] = await comoServicio((tx) =>
      tx.consultar<{ id: string }>(
        `insert into perfiles (usuario, nombre, rol, correo, credencial_hash, sesion_horas, activo)
         values ($1, $2, 'admin', $3, $4, 12, true)
         returning id`,
        [USUARIO_INGRESO, 'Verificación — ingreso', CORREO_INGRESO, hashearCredencial(clave)],
      ),
    )

    const conCorreo = await verificarAcceso(CORREO_INGRESO, clave)
    revisar(
      'la coordinación entra con su correo y su contraseña',
      conCorreo.ok === true,
      `devolvió ${JSON.stringify(conCorreo.ok)}`,
    )

    // La regla que no se puede romper el día que esto se despliegue: las cuentas
    // de coordinación que hay hoy no tienen correo cargado y tienen que seguir
    // entrando con su nombre de usuario, como desde el primer día. A la de
    // prueba se le saca el correo para pararla exactamente en ese lugar.
    await comoServicio((tx) =>
      tx.consultar('update perfiles set correo = null where id = $1', [cuenta.id]),
    )
    const conUsuario = await verificarAcceso(USUARIO_INGRESO, clave)
    revisar(
      'y con su nombre de usuario mientras no tenga correo cargado',
      conUsuario.ok === true,
      `devolvió ${JSON.stringify(conUsuario.ok)}`,
    )

    // Cinco erradas y queda trabada cinco minutos. Sin segundo factor, este
    // bloqueo es lo único que hay entre una contraseña de seis caracteres y un
    // script que las prueba de a miles: por eso la contraseña buena tampoco
    // entra mientras dure.
    let ultimoIntento = await verificarAcceso(USUARIO_INGRESO, 'no-es-la-clave')
    for (let i = 1; i < INTENTOS_HASTA_TRABAR; i++) {
      ultimoIntento = await verificarAcceso(USUARIO_INGRESO, 'no-es-la-clave')
    }
    const conLaClaveBuena = await verificarAcceso(USUARIO_INGRESO, clave)
    revisar(
      'cinco contraseñas erradas traban la cuenta',
      ultimoIntento.ok === false && ultimoIntento.motivo === 'bloqueado' &&
        conLaClaveBuena.ok === false && conLaClaveBuena.motivo === 'bloqueado',
      `el quinto dijo ${JSON.stringify(ultimoIntento)}, la clave buena ${JSON.stringify(conLaClaveBuena)}`,
    )

    /*
     * Cinco intentos que llegan juntos tienen que contar cinco.
     *
     * El bloqueo es la única defensa del PIN de cuatro dígitos del vigilador y
     * de la contraseña de la coordinación. Si el contador se lee en JavaScript
     * y se escribe después, los pedidos que leyeron antes de que el otro
     * escribiera guardan todos el mismo número, y una ráfaga entera cuesta un
     * solo intento: cuatro dígitos se recorren en horas.
     *
     * Honestidad sobre esta comprobación: contra PGlite pasa igual con el
     * defecto puesto, porque ahí las transacciones se serializan. Sirve cuando
     * esta verificación corre contra el Postgres de verdad, que es donde el
     * defecto existía.
     */
    await comoServicio((tx) =>
      tx.consultar(
        'update perfiles set intentos_fallidos = 0, bloqueado_hasta = null where id = $1',
        [cuenta.id],
      ),
    )
    await Promise.all(
      Array.from({ length: INTENTOS_HASTA_TRABAR }, () => verificarAcceso(USUARIO_INGRESO, 'no-es-la-clave')),
    )
    const contados = await contar(
      admin,
      'select intentos_fallidos c from perfiles where id = $1',
      [cuenta.id],
    )
    revisar(
      'cinco contraseñas erradas a la vez cuentan las cinco',
      contados === INTENTOS_HASTA_TRABAR,
      `contó ${contados} de ${INTENTOS_HASTA_TRABAR}`,
    )

    // Y se cierra: desactivada no entra, y sin correo no le estorba a nadie el
    // día que la Secretaría cargue el suyo. La fila la borra la próxima corrida,
    // al principio.
    await comoServicio((tx) =>
      tx.consultar('update perfiles set activo = false, correo = null where id = $1', [cuenta.id]),
    )
  }

  // ═══ Migue ════════════════════════════════════════════════════════════
  await verificarMigue(sesiones)

  console.log('\n  Lo que no entra a la auditoría')

  // Las credenciales que se escribieron recién no pueden haber quedado
  // copiadas en la auditoría. La escriben dos lugares distintos —el disparador
  // de la 0009 y app.eliminar_perfil, que arma su jsonb a mano— y de esa tabla
  // no se borra nada: un hash que entra ahí no sale más, y la contraseña que
  // eligió su dueño quedaría a la vista de cualquiera que lea la auditoría, que
  // es toda la coordinación. La lista de campos es la misma que mira la base.
  const enLaAuditoria = await contar(
    admin,
    `select count(*) c from auditoria
      where exists (
        select 1 from unnest(app.campos_reservados()) campo
         where jsonb_exists(antes, campo) or jsonb_exists(despues, campo)
      )`,
  )
  revisar(
    'ni un hash de credencial en toda la auditoría',
    enLaAuditoria === 0,
    `${enLaAuditoria} líneas`,
  )

  // ═══ Credenciales de fábrica ══════════════════════════════════════════
  //
  // Las claves de la siembra están publicadas en el repositorio. Sirven para la
  // base local; en un servidor son una puerta abierta. Esto no falla la
  // verificación cuando se corre contra PGlite —ahí es lo esperado— pero sí
  // contra un Postgres de verdad, que es donde importa.
  // ═══ Lo que el proveedor abre por su cuenta ═══════════════════════════
  // Supabase crea cada tabla de `public` con TODOS los permisos para anon y
  // authenticated. Las migraciones hasta la 0018 daban por sentado lo contrario
  // —que un permiso existe sólo si alguien lo otorgó—, que es como se porta
  // PGlite. La diferencia no da error en ningún lado: queda abierto y la app
  // anda igual, así que si esto no se prueba, no se ve. La 0019 lo cierra.
  console.log('\n  Permisos de fábrica del proveedor')

  revisar(
    'nadie puede truncar movimientos (TRUNCATE no pasa por las políticas)',
    !(await puede('authenticated', 'truncate movimientos cascade')),
  )
  revisar(
    'no se pueden borrar entidades por la vista pública',
    !(await puede('authenticated', 'delete from entidades_publicas')),
  )
  revisar(
    'ni personas',
    !(await puede('authenticated', 'delete from personas_publicas')),
  )
  revisar(
    'ni cambiarles el nombre',
    !(await puede('authenticated', "update entidades_publicas set nombre = 'alterado'")),
  )
  // anon es el rol de la API REST pública del proveedor. Esta app no lo usa
  // nunca, así que no tiene por qué llegar a nada.
  revisar(
    'anon no lee la lista de personas',
    !(await puede('anon', 'select count(*) from personas_publicas')),
  )
  revisar(
    'anon no lee los movimientos',
    !(await puede('anon', 'select count(*) from movimientos')),
  )

  console.log('\n  Credenciales')

  const DE_FABRICA: Array<[string, string]> = [
    ['direccionia', '123456'],
    ['coordinacion', 'ambiente2026'],
    ['planta', '1234'],
    ['pv01', '1234'],
  ]
  const { verificarCredencial } = await import('../credenciales')
  const guardadas = await comoServicio((tx) =>
    tx.consultar<{ usuario: string; credencial_hash: string }>(
      'select usuario, credencial_hash from perfiles where activo',
    ),
  )
  const sinCambiar = DE_FABRICA.filter(([usuario, clave]) => {
    const p = guardadas.find((g) => g.usuario.toLowerCase() === usuario)
    return p ? verificarCredencial(clave, p.credencial_hash) : false
  }).map(([usuario]) => usuario)

  const enProduccion = Boolean(process.env.DATABASE_URL?.trim())
  if (enProduccion) {
    revisar(
      'ningún usuario conserva la clave de fábrica',
      sinCambiar.length === 0,
      sinCambiar.join(', '),
    )
  } else {
    console.log(
      sinCambiar.length
        ? `  · ${sinCambiar.length} usuarios con la clave de fábrica (${sinCambiar.join(', ')}).\n` +
          '    Es lo esperado en la base local. Contra un Postgres real, esto falla.'
        : '  ✓ ningún usuario conserva la clave de fábrica',
    )
  }

  // Lo que cargó esta verificación queda anulado, no borrado: en este sistema
  // nada se borra. Va al final para que las comprobaciones que miran vecinos y
  // conteos lo tengan todavía vigente mientras corren. Y la entidad de prueba se
  // da de baja, para que no aparezca en la bandeja de revisiones de la
  // coordinadora cada vez que alguien corre esto.
  await conSesion(admin, async (tx) => {
    await tx.consultar(
      `update movimientos
          set estado = 'anulado', motivo_anulacion = 'Movimiento de prueba de db:verificar',
              anulado_por_id = $1, anulado_en = now()
        where observaciones = $2 and estado = 'vigente'`,
      [admin.perfilId, MARCA],
    )
    await tx.consultar(
      `update entidades set activo = false, pendiente_revision = false
        where nombre = any($1::text[])`,
      [ENTIDADES_PRUEBA],
    )
  })

  console.log(
    `\n  ${pasaron} bien · ${fallaron} mal${omitidas ? ` · ${omitidas} sin correr` : ''}\n`,
  )
  await (await obtenerBase()).cerrar()
  process.exit(fallaron === 0 ? 0 : 1)
}

exigirConfirmacionSiEsRemota({
  variable: 'CONFIRMO_VERIFICAR',
  que:
    'La verificación crea sus propios usuarios, movimientos y entidades para poder ' +
    'comprobar los permisos, y los saca al terminar. Si se corta en el medio, quedan.\n' +
    '  También crea conversaciones de Migue de prueba, y se borran junto con esos usuarios.',
  comando: 'npm run db:verificar',
})

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
