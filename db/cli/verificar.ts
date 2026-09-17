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
import { randomUUID } from 'node:crypto'
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

/** Corre una consulta esperando que la base la rechace. */
async function debeFallar(descripcion: string, sesion: Sesion, sql: string, params: unknown[] = []) {
  try {
    await conSesion(sesion, (tx) => tx.consultar(sql, params))
    revisar(descripcion, false, 'la consulta pasó y no debería')
  } catch (e) {
    revisar(descripcion, true, (e as Error).message.slice(0, 60))
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
  ['verif_planta', 'Verificación — Planta',       'vigilador', 'PVRV'],
  ['verif_punto',  'Verificación — punto verde',  'vigilador', 'PV-02'],
  // PV-03 es el punto que solo informa el conteo del día (carga_detallada en
  // false), y eso es justo lo que separa "visitas" de "vecinos identificados".
  ['verif_andes',  'Verificación — solo conteo',  'vigilador', 'PV-03'],
]

/**
 * Una comprobación que no se puede hacer sobre esta base.
 *
 * No es lo mismo que fallar. Las que miran la cadena del compost necesitan
 * movimientos vinculados a pilas, y una base recién creada no los tiene —ni los
 * va a tener hasta que la Planta cargue el primer camión—. Contarlas como
 * fallas haría que una base sana se vea rota.
 */
function omitir(descripcion: string, porque: string) {
  omitidas++
  console.log(`  · ${descripcion}  → ${porque}`)
}

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
      PERFILES_PRUEBA.map((p) => p[0]),
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
    `select count(*) c from movimientos where sitio_id = (select id from sitios where codigo = 'PVRV')`,
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
     values ('planta', 'ingreso', (select id from sitios where codigo = 'PVRV'),
             'texto', 'prueba', 'sitio', (select id from sitios where codigo = 'PVRV'), $1)`,
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
  const cadena = await conSesion(admin, (tx) =>
    tx.consultar<{ pila: string; m3: string; procedencias: string | null }>(
      `select pila, m3_que_la_formaron::text as m3, procedencias
         from v_trazabilidad_salidas
        where m3_que_la_formaron > 0 and procedencias is not null
        limit 1`,
    ),
  )
  const hayCadena = await contar(admin, 'select count(*) c from movimientos where pila_id is not null')
  if (hayCadena === 0) {
    omitir(
      'una salida de compost sabe de qué pila y de qué poda viene',
      'todavía no hay movimientos vinculados a pilas',
    )
  } else {
    revisar(
      'una salida de compost sabe de qué pila y de qué poda viene',
      cadena.length === 1,
      cadena[0] ? `${cadena[0].pila}: ${Number(cadena[0].m3).toFixed(0)} m³ de ${cadena[0].procedencias?.slice(0, 40)}…` : '',
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
    `\n  ${pasaron} bien · ${fallaron} mal${omitidas ? ` · ${omitidas} sin datos para probar` : ''}\n`,
  )
  await (await obtenerBase()).cerrar()
  process.exit(fallaron === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
