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
import * as modulos from 'node:module'
import { comoServicio, conSesion, type Sesion } from '../sesion'
import { hashearCredencial } from '../credenciales'
import { obtenerBase, describirMotor } from '../client'

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

const MARCA = 'Generado por db:verificar'
const TELEFONOS_PRUEBA = ['3814569988']
/** La que crea esta verificación para tener algo con CUIT y teléfono que leer. */
const ENTIDAD_FIJA = 'Organización de prueba verificar'
const ENTIDADES_PRUEBA = ['Carrero de prueba', 'Productor de prueba verificar', ENTIDAD_FIJA]
const PILA_PRUEBA = 'VERIF-PRUEBA'
/** De dónde dice venir la poda que forma la pila de prueba. */
const PODA_PRUEBA = 'Poda de db:verificar'

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
    // Último: casi todas las tablas de arriba los referencian con `on delete
    // restrict`, así que hasta acá no se pueden sacar.
    await tx.consultar('delete from perfiles where usuario = any($1::text[])', [
      [
        ...PERFILES_PRUEBA.map((p) => p[0]),
        ...PERFILES_A_BORRAR.map((p) => p[0]),
        USUARIO_INGRESO,
        USUARIO_INGRESO_VIEJO,
      ],
    ])
  })
}

/**
 * Crea los usuarios de prueba y devuelve sus sesiones. La credencial es
 * un hash de algo al azar: nadie tiene que poder entrar con ellos.
 */
async function sesionesDePrueba(): Promise<Record<'admin' | 'planta' | 'punto' | 'andes', Sesion>> {
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
    planta: buscar('verif_planta'),
    punto: buscar('verif_punto'),
    andes: buscar('verif_andes'),
  }
}

type ModuloIngreso = typeof import('../../src/lib/acceso')
let porQueNoSeCargo = ''

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
  // registerHooks() existe desde Node 22.15. En uno anterior no se engancha
  // nada y las cuatro del ingreso se saltean como antes, avisando: vale más
  // que corran las otras setenta que tumbar la verificación entera acá.
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

async function main() {
  console.log(`\n  Verificación de permisos · ${describirMotor()}\n`)
  await limpiarRastros()

  const { admin, planta, punto: otroPunto, andes } = await sesionesDePrueba()

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
    'comprobar los permisos, y los saca al terminar. Si se corta en el medio, quedan.',
  comando: 'npm run db:verificar',
})

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
