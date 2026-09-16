/**
 * Datos de arranque.
 *
 *     npm run db:sembrar                  base + ejemplos (PGlite local)
 *     npm run db:sembrar -- --sin-ejemplos solo la base
 *
 * La BASE es lo que salió del relevamiento y no depende de nadie: los nueve
 * sitios, los recipientes con su capacidad, las catorce corrientes, los
 * contenedores de los puntos verdes y los usuarios para entrar.
 *
 * Lo demás —choferes, patentes, destinos habilitados, pilas y movimientos—
 * es INVENTADO. Sirve para mirar la app con algo adentro; en una base de
 * verdad lo carga la coordinadora desde Listas maestras, y los destinos se
 * formalizan desde lo que los vigiladores escriben.
 *
 * Es idempotente: correrlo dos veces no duplica nada.
 */
import { comoServicio } from '../sesion'
import { obtenerBase } from '../client'
import { hashearCredencial } from '../credenciales'

const SITIOS = [
  ['PVRV',  'Planta de Valorización de Residuos Verdes', 'planta',      'Huerta y Vivero Municipal', 1],
  ['PV-01', 'Punto Verde Huerta',                        'punto_verde', 'Huerta Municipal',          2],
  ['PV-02', 'Punto Verde Italia',                        'punto_verde', 'Av. Italia',                3],
  ['PV-03', 'Punto Verde Paso de los Andes',             'punto_verde', 'Paso de los Andes',         4],
  ['PV-04', 'Punto Verde Colón',                         'punto_verde', 'Av. Colón',                 5],
  ['PV-05', 'Punto Verde Garcilaso',                     'punto_verde', 'Garcilaso',                 6],
  ['PV-06', 'Punto Verde Circunvalación',                'punto_verde', 'Av. de Circunvalación',     7],
  ['PV-07', 'Punto Verde América',                       'punto_verde', 'Av. América',               8],
  ['PV-08', 'Punto Verde Costanera',                     'punto_verde', 'Costanera',                 9],
] as const

// Relevado con la Secretaría: no hay balanza y todo se estima en m³. Estos son
// los recipientes con los que se estima, con su capacidad declarada.
// codigo, nombre, plural, decimales, factor_m3, orden
const UNIDADES = [
  ['m3',          'm³',              'm³',                1, 1,    1],
  ['tambor_200',  'tambor de 200 L', 'tambores de 200 L', 0, 0.2,  2],
  ['carro_delfi', 'carro de delfi',  'carros de delfi',   0, 4,    3],
  ['camion',      'camión',          'camiones',          0, 6,    4],
  ['contenedor',  'contenedor',      'contenedores',      0, 6,    5],
  ['batea',       'batea',           'bateas',            0, 20,   6],
  ['batea_larga', 'batea alargada',  'bateas alargadas',  0, 30,   7],
  ['kg',          'kg',              'kg',                2, null, 8],
] as const

// Las corrientes que se registran de verdad. En la Planta salieron del
// relevamiento; en los puntos verdes son las cinco de la pizarra de seguimiento.
// nombre, categoria, flujos, tipos, unidad por defecto, sugerencias, color, orden
const MATERIALES: ReadonlyArray<
  readonly [string, string, string[], string[], string, number[], string, number]
> = [
  ['Poda',                   'verdes',      ['planta'],      ['ingreso'],           'm3', [4, 6, 20, 30], '#25d366', 1],
  ['Restos de jardinería',   'verdes',      ['planta'],      ['ingreso'],           'm3', [0.2, 4, 6],    '#10b981', 2],
  ['Tronco y madera gruesa', 'verdes',      ['planta'],      ['ingreso'],           'm3', [4, 6],         '#1aa851', 3],
  ['Chipeo',                 'verdes',      ['planta'],      ['ingreso', 'salida'], 'm3', [6, 20, 30],    '#3cb4f0', 4],
  ['Triturado',              'verdes',      ['planta'],      ['salida'],            'm3', [20, 30],       '#2589ea', 5],
  ['Compost',                'verdes',      ['planta'],      ['salida'],            'm3', [0.2, 4, 6],    '#126ff5', 6],
  ['Leña',                   'verdes',      ['planta'],      ['salida'],            'm3', [0.2, 4, 6],    '#a16207', 7],
  ['Plástico',               'reciclables', ['punto_verde'], ['ingreso', 'salida'], 'm3', [0.2, 6],       '#28469f', 8],
  ['Cartón',                 'reciclables', ['punto_verde'], ['ingreso', 'salida'], 'm3', [0.2, 6],       '#f5b81c', 9],
  ['Vidrio y metal',         'reciclables', ['punto_verde'], ['ingreso', 'salida'], 'm3', [0.2, 6],       '#6b7885', 10],
  ['Residuos de poda',       'verdes',      ['punto_verde'], ['ingreso', 'salida'], 'm3', [0.2, 6],       '#25d366', 11],
  ['RSU',                    'especiales',  ['punto_verde'], ['ingreso', 'salida'], 'm3', [6],            '#6b7885', 12],
  ['Retazos de tela',        'textil',      ['gran_generador', 'punto_verde'], ['ingreso', 'salida'], 'kg', [10, 25, 50], '#8b5cf6', 13],
  ['Recortes de madera',     'madera',      ['gran_generador', 'punto_verde'], ['ingreso', 'salida'], 'kg', [10, 25, 50], '#a16207', 14],
]

/**
 * Qué recipientes se pueden usar para cada material.
 *
 * Todo se estima en m³, así que el vigilador elige el recipiente y cuántos. En
 * los puntos verdes también se usan kilos: el retiro para reutilización se
 * estima por peso, que es lo que después alimenta el registro del programa
 * CIRCULA, y el Excel de la 9 de Julio llega en kilos.
 */
const RECIPIENTES_POR_FLUJO: Record<string, string[]> = {
  planta:          ['m3', 'tambor_200', 'carro_delfi', 'camion', 'contenedor', 'batea', 'batea_larga'],
  punto_verde:     ['m3', 'tambor_200', 'contenedor', 'camion', 'kg'],
  gran_generador:  ['kg', 'm3', 'camion'],
}

// nombre, tipo, origen, destino, flujos
const ENTIDADES: ReadonlyArray<readonly [string, string, boolean, boolean, string[]]> = [
  ['Cuadrilla de poda — Zona Norte',   'dependencia_municipal', true,  false, ['planta']],
  ['Cuadrilla de poda — Zona Sur',     'dependencia_municipal', true,  false, ['planta']],
  ['Cuadrilla de poda — Zona Este',    'dependencia_municipal', true,  false, ['planta']],
  ['Cuadrilla de poda — Zona Oeste',   'dependencia_municipal', true,  false, ['planta']],
  ['Cuadrilla de poda — Centro',       'dependencia_municipal', true,  false, ['planta']],
  ['Dirección de Espacios Verdes',     'dependencia_municipal', true,  true,  ['planta']],
  ['Vivero Municipal',                 'dependencia_municipal', false, true,  ['planta']],
  ['Escuela Agrotécnica',              'organizacion',          false, true,  ['planta', 'punto_verde']],
  ['Emprendimiento Tierra Buena',      'emprendimiento',        false, true,  ['planta', 'punto_verde']],
  ['Cooperativa de recuperadores',     'organizacion',          false, true,  ['punto_verde']],
  ['Textil del Norte S.A.',            'empresa',               true,  false, ['gran_generador']],
  ['Carpintería Los Nogales',          'empresa',               true,  false, ['gran_generador']],
  ['Planta de transferencia 9 de Julio','planta_externa',       false, true,  ['punto_verde']],
]

// patente, tipo, capacidad_m3 — alineadas con los recipientes relevados
const VEHICULOS: ReadonlyArray<readonly [string, string, number | null]> = [
  ['AB 123 CD', 'camion',    6],
  ['AC 456 EF', 'camion',    6],
  ['AD 789 GH', 'batea',     20],
  ['AE 012 IJ', 'batea',     30],
  ['AF 345 KL', 'camioneta',  4],
  ['NPQ 678',   'camion',     6],
  ['NRS 901',   'tractor',  null],
]

// nombre, rol
const PERSONAS: ReadonlyArray<readonly [string, string]> = [
  ['Ramón Gómez',        'chofer'],
  ['Luis Paz',           'chofer'],
  ['Carlos Ibáñez',      'chofer'],
  ['Miguel Sosa',        'chofer'],
  ['Jorge Ledesma',      'autorizante'],
  ['Analía Roldán',      'autorizante'],
  ['Sergio Cabrera',     'vigilador'],
  ['Marta Villagra',     'vigilador'],
  ['Héctor Juárez',      'vigilador'],
  ['Nadia Coronel',      'vigilador'],
  ['Rubén Ovejero',      'operario'],
]

// Dos por punto, que es lo que permite que el selector de turno tenga algo que
// elegir y que se note el cambio de guardia.
const VIGILADORES_POR_PUNTO: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['PV-01', ['Gustavo Nieva', 'Silvia Barrionuevo']],
  ['PV-02', ['Elena Quiroga', 'Pablo Tejerina']],
  ['PV-03', ['Rosa Maldonado', 'Julio Ale']],
  ['PV-04', ['Mónica Assaf', 'Damián Correa']],
  ['PV-05', ['Fabián Toledo', 'Lucía Brandán']],
  ['PV-06', ['Norma Agüero', 'Cristian Herrera']],
  ['PV-07', ['Vanesa Robles', 'Emanuel Díaz']],
  ['PV-08', ['Patricia Leiva', 'Marcos Figueroa']],
]

/**
 * Los datos inventados se generan solo si se piden.
 *
 * Contra la base local sí, porque un tablero vacío no se puede mirar. Contra
 * un Postgres de verdad NO: dos mil movimientos falsos en la base de la
 * Secretaría no se distinguen después de los reales, y borrarlos no se puede
 * —en este sistema nada se borra—, así que habría que empezar de cero.
 */
function quiereEjemplos(): boolean {
  if (process.argv.includes('--ejemplos')) return true
  if (process.argv.includes('--sin-ejemplos')) return false
  return !process.env.DATABASE_URL?.trim()
}

async function sembrar() {
  const conEjemplos = quiereEjemplos()

  await comoServicio(async (tx) => {
    // ── Sitios ───────────────────────────────────────────────────────────
    for (const [codigo, nombre, tipo, direccion, orden] of SITIOS) {
      await tx.consultar(
        `insert into sitios (codigo, nombre, tipo, direccion, orden)
         values ($1, $2, $3, $4, $5) on conflict (codigo) do nothing`,
        [codigo, nombre, tipo, direccion, orden],
      )
    }

    // Paso de los Andes no carga desde el celular: el personal es de otra
    // Secretaría. La migración 0017 también lo marca, pero ahí el sitio todavía
    // no existe —una migración que actualiza datos corre sobre una tabla vacía
    // en una base nueva—, así que el valor real se fija acá.
    await tx.consultar(
      "update sitios set carga_detallada = false where codigo = 'PV-03'",
    )

    // ── Unidades ─────────────────────────────────────────────────────────
    for (const [codigo, nombre, plural, decimales, factor, orden] of UNIDADES) {
      await tx.consultar(
        `insert into unidades (codigo, nombre, nombre_plural, decimales, factor_m3, orden)
         values ($1, $2, $3, $4, $5, $6) on conflict (codigo) do nothing`,
        [codigo, nombre, plural, decimales, factor, orden],
      )
    }

    // ── Materiales ───────────────────────────────────────────────────────
    for (const [nombre, categoria, flujos, tipos, unidad, sugerencias, color, orden] of MATERIALES) {
      // La unión de los recipientes de cada flujo donde aparece el material.
      const codigos = [...new Set(flujos.flatMap((f) => RECIPIENTES_POR_FLUJO[f] ?? ['m3']))]
      await tx.consultar(
        `insert into materiales
           (nombre, categoria, flujos, tipos, unidad_default_id, unidades_permitidas, sugerencias, color, orden)
         select $1, $2, $3::text[], $4::text[], u.id,
                (select coalesce(array_agg(x.id order by x.orden), array[u.id])
                   from unidades x where x.codigo = any($5::text[]) and x.activo),
                $6::numeric[], $7, $8
           from unidades u where u.codigo = $9
         on conflict do nothing`,
        [nombre, categoria, flujos, tipos, codigos, sugerencias, color, orden, unidad],
      )
    }

    // ── Contenedores de los puntos verdes ────────────────────────────────
    // No tienen numeración física: un contenedor es el par punto + corriente,
    // "el de cartón de Italia". Se arman desde las corrientes de la pizarra.
    await tx.consultar(
      `insert into contenedores (codigo, tipo, capacidad_m3, sitio_actual_id, material_id, estado)
       select s.codigo || ' · ' || m.nombre, 'contenedor', 6, s.id, m.id, 'en_sitio'
         from sitios s
         cross join materiales m
        where s.tipo = 'punto_verde' and s.activo and m.activo
          -- Las cinco corrientes de la pizarra de seguimiento, que son las que
          -- tienen contenedor. Los retazos de tela y los recortes de madera
          -- pasan por los puntos pero vienen de grandes generadores y se
          -- retiran de otra forma.
          and m.nombre in ('Plástico', 'Cartón', 'Vidrio y metal',
                           'Residuos de poda', 'RSU')
       on conflict (codigo) do nothing`,
    )

    // ── Usuarios ─────────────────────────────────────────────────────────
    // CREDENCIALES DE DESARROLLO. Cambiar antes de cualquier despliegue.
    //
    // No hay un rol por encima de 'admin': el modelo tiene dos roles y admin ya
    // puede todo —los tres flujos, las listas maestras, anular movimientos, los
    // datos de vecinos y la auditoría—. El acceso de la Dirección de IA es un
    // admin más, para poder entrar sin usar la cuenta de la coordinación y que
    // la auditoría distinga quién hizo qué.
    const usuarios: Array<[string, string, 'admin' | 'vigilador', string | null, string, number | null]> = [
      ['direccionia', 'Dirección de Inteligencia Artificial', 'admin', null, '123456', 12],
      ['coordinacion', 'Coordinación de Ambiente', 'admin', null, 'ambiente2026', 12],
      ['planta', 'Planta de Valorización — turno', 'vigilador', 'PVRV', '1234', null],
    ]
    for (const s of SITIOS.slice(1)) {
      usuarios.push([s[0].toLowerCase().replace('-', ''), `${s[1]} — turno`, 'vigilador', s[0], '1234', null])
    }

    for (const [usuario, nombre, rol, sitioCodigo, credencial, horas] of usuarios) {
      await tx.consultar(
        `insert into perfiles (usuario, nombre, rol, sitio_id, credencial_hash, sesion_horas)
         select $1, $2, $3,
                case when $4::text is null then null else (select id from sitios where codigo = $4) end,
                $5, $6
         where not exists (select 1 from perfiles where lower(usuario) = lower($1))`,
        [usuario, nombre, rol, sitioCodigo, hashearCredencial(credencial), horas],
      )
    }
  })

  if (!conEjemplos) {
    console.log(`
  Base cargada: los 9 sitios, los recipientes, las 14 corrientes, los
  contenedores de los puntos verdes y los usuarios.

  Nada inventado: ni choferes, ni patentes, ni destinos, ni pilas, ni
  movimientos. Los choferes y las patentes se cargan desde Listas maestras;
  los destinos se formalizan en Revisiones desde lo que escriben los
  vigiladores; las pilas, desde la pantalla de Compost.

  Para cargar los datos de ejemplo igual —solo en una base de prueba—:
      npm run db:sembrar -- --ejemplos
`)
    avisoDeUsuarios()
    return
  }

  // ── Listas inventadas ───────────────────────────────────────────────────
  // Choferes, patentes, destinos y pilas con nombre y apellido. En una base
  // de verdad los carga la coordinadora desde Listas maestras, y los destinos
  // se formalizan desde lo que los vigiladores escriben.
  await comoServicio(async (tx) => {
    // ── Entidades ────────────────────────────────────────────────────────
    for (const [nombre, tipo, origen, destino, flujos] of ENTIDADES) {
      await tx.consultar(
        `insert into entidades (nombre, tipo, habilitada_origen, habilitada_destino, flujos)
         values ($1, $2, $3, $4, $5::text[]) on conflict do nothing`,
        [nombre, tipo, origen, destino, flujos],
      )
    }

    // ── Vehículos ────────────────────────────────────────────────────────
    for (const [patente, tipo, capacidad] of VEHICULOS) {
      await tx.consultar(
        `insert into vehiculos (patente, tipo, capacidad_m3)
         values ($1, $2, $3) on conflict do nothing`,
        [patente, tipo, capacidad],
      )
    }

    // ── Personas ─────────────────────────────────────────────────────────
    // Choferes, autorizantes y operarios trabajan en la Planta. Los vigiladores
    // van repartidos: el selector de "quién está de turno" solo ofrece los del
    // propio punto, así que si todos quedan en la Planta, los ocho puntos
    // verdes abren diciendo que no hay nadie cargado.
    for (const [nombre, rol] of PERSONAS) {
      await tx.consultar(
        `insert into personas (nombre, rol, sitio_id)
         select $1, $2, (select id from sitios where codigo = 'PVRV')
         where not exists (select 1 from personas where nombre = $1 and rol = $2)`,
        [nombre, rol],
      )
    }

    for (const [codigo, nombres] of VIGILADORES_POR_PUNTO) {
      for (const nombre of nombres) {
        await tx.consultar(
          `insert into personas (nombre, rol, sitio_id)
           select $1, 'vigilador', (select id from sitios where codigo = $2)
           where not exists (select 1 from personas where nombre = $1 and rol = 'vigilador')`,
          [nombre, codigo],
        )
      }
    }

    // ── Pilas de compost ─────────────────────────────────────────────────
    // Diecisiete pilas de 1 × 1 × 100 m escalonadas en el tiempo: las más
    // viejas ya se despacharon, la última se está armando. Sin ese escalonado
    // no se puede ver si el tablero distingue una pila lista de una atrasada.
    await tx.consultar(
      `insert into pilas (codigo, sitio_id, estado, fecha_armado, fecha_cierre, largo_m, ancho_m, alto_m)
       select
         'P-' || lpad(n::text, 2, '0'),
         (select id from sitios where codigo = 'PVRV'),
         case
           when n <= 3  then 'despachada'
           when n <= 6  then 'lista'
           when n <= 15 then 'madurando'
           else 'en_formacion'
         end,
         (current_date - ((18 - n) * 21))::date,
         case when n <= 15 then (current_date - ((18 - n) * 21) + 18)::date end,
         100, 1, 1
         from generate_series(1, 17) n
       on conflict (codigo) do nothing`,
    )

  })

  // ── Movimientos de ejemplo ─────────────────────────────────────────────
  // Para que el tablero y el listado no abran vacíos. Se generan solo si la
  // tabla está vacía, así no se mezclan con datos reales.
  await comoServicio(async (tx) => {
    const [{ total }] = await tx.consultar<{ total: string }>('select count(*)::text as total from movimientos')
    if (Number(total) > 0) {
      console.log('  Ya hay movimientos cargados: no se generan ejemplos.')
      return
    }

    await tx.consultar(`
      with cfg as (
        select (select id from sitios   where codigo = 'PVRV')          as planta,
               (select id from perfiles where usuario = 'planta')         as perfil,
               (select id from personas where rol = 'vigilador' limit 1)  as vigilador
      ),
      -- 120 días hacia atrás, entre 1 y 3 movimientos por día hábil
      dias as (
        select generate_series(current_date - interval '119 days', current_date, interval '1 day')::date as d
      ),
      slots as (
        -- La semilla sale de un md5 y no de la fecha en segundos: el epoch de
        -- una fecha siempre es múltiplo de 86400, así que cualquier resto
        -- calculado sobre él se repite y la variedad desaparece.
        -- 28 bits para que el entero nunca salga negativo.
        select d, g,
               ('x' || substr(md5(d::text || '-' || g::text), 1, 7))::bit(28)::int as semilla
          from dias, generate_series(1, 3) g
         where extract(isodow from d) < 6
      ),
      elegidos as (
        select d, semilla,
               (semilla % 10) as r,
               case when (semilla % 10) < 6 then 'ingreso' else 'salida' end as tipo
          from slots
         where (semilla % 10) < 8
      ),
      insertados as (
        insert into movimientos (
          flujo, tipo, sitio_id, ocurrido_en,
          origen_clase, origen_entidad_id, origen_sitio_id,
          destino_clase, destino_sitio_id, destino_entidad_id,
          vehiculo_id, chofer_id, autorizado_por_id, vigilador_id, cargado_por_id, creado_en
        )
        select
          'planta', e.tipo, cfg.planta,
          least(
            e.d + make_interval(hours => 7 + (e.semilla % 9)::int, mins => (e.semilla % 60)::int),
            now() - interval '20 minutes'
          ),
          case when e.tipo = 'ingreso' then 'entidad' else 'sitio'   end,
          case when e.tipo = 'ingreso'
               then (select id from entidades where habilitada_origen and 'planta' = any(flujos)
                      order by nombre offset (e.semilla % 5) limit 1) end,
          case when e.tipo = 'salida'  then cfg.planta end,
          case when e.tipo = 'ingreso' then 'sitio' else 'entidad' end,
          case when e.tipo = 'ingreso' then cfg.planta end,
          case when e.tipo = 'salida'
               then (select id from entidades where habilitada_destino and 'planta' = any(flujos)
                      order by nombre offset (e.semilla % 3) limit 1) end,
          (select id from vehiculos order by patente offset (e.semilla % 5) limit 1),
          (select id from personas where rol = 'chofer' order by nombre offset (e.semilla % 4) limit 1),
          case when e.tipo = 'salida'
               then (select id from personas where rol = 'autorizante' order by nombre offset (e.semilla % 2) limit 1) end,
          cfg.vigilador, cfg.perfil,
          -- Se cargó pocos minutos después del hecho, como en la operación real.
          least(
            e.d + make_interval(hours => 7 + (e.semilla % 9)::int, mins => 4 + (e.semilla % 60)::int),
            now() - interval '15 minutes'
          )
        from elegidos e, cfg
        returning id, tipo, numero
      )
      insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id)
      select i.id, m.id,
             case u.codigo
               when 'm3'     then (5 + (i.numero * 7) % 16)::numeric
               when 'camion' then (1 + (i.numero % 2))::numeric
               when 'batea'  then (1 + (i.numero % 2))::numeric
               else (10 + (i.numero * 3) % 40)::numeric
             end,
             m.unidad_default_id
        from insertados i
        join lateral (
          select mt.*, row_number() over (order by mt.orden) as rn
            from materiales mt
           where 'planta' = any(mt.flujos) and i.tipo = any(mt.tipos)
        ) m on m.rn = 1 + (i.numero % greatest(1, (
               select count(*) from materiales mt2
                where 'planta' = any(mt2.flujos) and i.tipo = any(mt2.tipos))))
        join unidades u on u.id = m.unidad_default_id
    `)

    const [{ total: creados }] = await tx.consultar<{ total: string }>(
      `select count(*)::text as total from movimientos where flujo = 'planta'`,
    )
    console.log(`  ${creados} movimientos de la Planta generados (últimos 4 meses).`)
  })

  // ── Movimientos de puntos verdes (fase 2) ──────────────────────────────
  // Un punto verde recibe gente cuando la gente no trabaja: acá los fines de
  // semana pesan más que los días hábiles, justo al revés que la Planta.
  await comoServicio(async (tx) => {
    const [{ total }] = await tx.consultar<{ total: string }>(
      `select count(*)::text as total from movimientos where flujo = 'punto_verde'`,
    )
    if (Number(total) > 0) {
      console.log('  Ya hay movimientos de puntos verdes: no se generan ejemplos.')
      return
    }

    // Dos contrapartes dadas de alta "en la calle", para que la pantalla de
    // revisión de la coordinadora tenga algo que revisar.
    await tx.consultar(`
      insert into entidades (
        nombre, tipo, habilitada_origen, habilitada_destino, flujos,
        pendiente_revision, creado_por_id
      )
      select e.nombre, e.tipo, false, true, array['punto_verde']::text[], true,
             (select p.id from perfiles p where p.usuario = e.usuario)
        from (values ('Carrero Don Ramón',      'carrero',        'pv03'),
                     ('Taller Manos a la Obra', 'emprendimiento', 'pv06'))
             as e(nombre, tipo, usuario)
      on conflict do nothing
    `)

    // ── Vecinos que vuelven ──────────────────────────────────────────────
    // Sin gente repetida, "vecinos identificados" daría lo mismo que
    // "visitas" y el tablero parecería correcto aunque confundiera las dos
    // cosas. Estos 60 tienen teléfono y vuelven varias veces en los 4 meses.
    // El teléfono se guarda normalizado, igual que lo hace app.registrar_vecino.
    await tx.consultar(`
      insert into vecinos (nombre, telefono, barrio, sitio_alta_id, creado_por_id, creado_en)
      select nuevo.nombre, nuevo.telefono, nuevo.barrio,
             nuevo.sitio_id, nuevo.perfil_id, nuevo.creado_en
        from (
          select
            (array['Ana','Marcela','Silvia','Lucía','Carla','Rosa','Mirta','Julieta',
                   'Noelia','Vanina','Juan','Carlos','Sergio','Ramón','Pablo','Diego',
                   'Martín','Alberto','Néstor','Facundo'])[1 + (n % 20)]
              || ' ' ||
            (array['Gómez','Juárez','Ríos','Coronel','Villagra','Sosa','Ledesma','Paz',
                   'Ibáñez','Ovejero','Córdoba','Herrera','Nieva','Toledo','Brizuela',
                   'Robles','Costilla'])[1 + ((n * 3) % 17)]                      as nombre,
            -- 381 + 7 dígitos, que es un número de Tucumán.
            app.normalizar_telefono(
              '381' || (4 + n % 3)::text || lpad(((n * 137 + 41) % 1000000)::text, 6, '0')
            )                                                                     as telefono,
            (array['Barrio Sur','Villa Luján','Barrio Norte','Villa 9 de Julio','Ciudadela',
                   'Barrio Jardín','Villa Amalia','Villa Mariano Moreno','San Cayetano',
                   'El Bajo','Barrio Ejército del Norte','Villa Alem','Barrio Policial',
                   'Los Vázquez'])[1 + ((n * 5) % 14)]                            as barrio,
            pt.sitio_id, pt.perfil_id,
            now() - make_interval(days => 90 + (n % 30))                          as creado_en
          from generate_series(0, 59) n
          join lateral (
            select s.id as sitio_id,
                   (select p.id from perfiles p
                     where p.sitio_id = s.id order by p.usuario limit 1) as perfil_id
              from sitios s
             where s.tipo = 'punto_verde' and s.activo and s.carga_detallada
             order by s.orden
            offset (n % greatest(1, (select count(*) from sitios
                                      where tipo = 'punto_verde' and activo)))
             limit 1
          ) pt on true
        ) nuevo
       where not exists (select 1 from vecinos v where v.telefono = nuevo.telefono)
    `)

    // ── Visitas, movimientos e ítems ─────────────────────────────────────
    await tx.consultar(`
      with puntos as (
        select s.id as sitio_id, s.codigo as sitio_codigo, pf.id as perfil_id,
               (row_number() over (order by s.orden)) - 1 as idx
          from sitios s
          join lateral (
            select p.id from perfiles p where p.sitio_id = s.id order by p.usuario limit 1
          ) pf on true
         where s.tipo = 'punto_verde' and s.activo and s.carga_detallada
      ),
      vigiladores as (
        select p.id, (row_number() over (order by p.nombre)) - 1 as rn,
               count(*) over () as total
          from personas p where p.rol = 'vigilador' and p.activo
      ),
      destinos as (
        select e.id, (row_number() over (order by e.nombre)) - 1 as rn,
               count(*) over () as total
          from entidades e
         where e.activo and e.habilitada_destino and 'punto_verde' = any(e.flujos)
      ),
      conocidos as (
        select v.id, (row_number() over (order by v.telefono)) - 1 as rn,
               count(*) over () as total
          from vecinos v where v.telefono is not null and not v.anonimizado
      ),
      dias as (
        select generate_series(current_date - interval '119 days', current_date, interval '1 day')::date as d
      ),
      crudo as (
        select d.d, pt.sitio_id, pt.perfil_id, pt.idx,
               md5(d.d::text || '-pv-' || g::text || '-' || pt.sitio_codigo) as h
          from dias d, puntos pt, generate_series(1, 6) g
      ),
      slots as (
        -- La semilla sale del md5 y no de la fecha en segundos, por lo mismo
        -- que en el bloque de la Planta. El sufijo '-pv-' hace que los puntos
        -- verdes no repitan la secuencia de allá. 28 bits para que el entero
        -- nunca salga negativo.
        -- Cada decisión usa su propia semilla: si dos salieran del mismo
        -- número, los restos quedan atados entre sí y la variedad se pierde
        -- sin que se note (p. ej. todas las salidas al mismo destino).
        select c.d, c.sitio_id, c.perfil_id, c.idx,
               ('x' || substr(c.h,  1, 7))::bit(28)::int as semilla,
               ('x' || substr(c.h,  8, 7))::bit(28)::int as semilla_b,
               ('x' || substr(c.h, 15, 7))::bit(28)::int as semilla_c,
               ('x' || substr(c.h, 22, 7))::bit(28)::int as semilla_d,
               ('x' || substr(c.h, 25, 7))::bit(28)::int as semilla_e,
               md5(c.h || '-vecino')::uuid               as vecino_anonimo_id
          from crudo c
      ),
      elegidos as (
        select s.*,
               case when s.semilla_b % 5 = 0 then 'salida' else 'ingreso' end as tipo,
               (s.semilla_b % 5 <> 0 and s.semilla_d % 100 < 35)             as sin_datos
          from slots s
         -- 6 franjas por día y por punto: 4 se usan el fin de semana y 1 o 2
         -- entre semana.
         where (s.semilla % 12) < case when extract(isodow from s.d) >= 6 then 8 else 3 end
      ),
      visitas as (
        select e.d, e.sitio_id, e.perfil_id, e.tipo, e.sin_datos, e.vecino_anonimo_id,
               co.id as vecino_conocido_id,
               de.id as destino_id,
               vg.id as vigilador_id,
               case when e.tipo = 'salida' then
                 (array['venta','venta','venta','venta',
                        'emprendimiento','emprendimiento','emprendimiento',
                        'reutilizacion','reutilizacion','otro'])[1 + (e.semilla_c % 10)]
               end as tipo_valorizacion,
               -- El disparador rechaza fechas futuras: el último día del rango
               -- se recorta contra el reloj.
               least(e.d + make_interval(hours => 8 + (e.semilla_e % 11),
                                         mins  => e.semilla_b % 60),
                     now() - interval '20 minutes') as ocurrido_en,
               least(e.d + make_interval(hours => 8 + (e.semilla_e % 11),
                                         mins  => (e.semilla_b % 60) + 3 + (e.semilla_e % 9)),
                     now() - interval '15 minutes') as creado_en
          from elegidos e
          -- Cada punto tiene su vecindario: una ventana de 12 vecinos del
          -- padrón, así el mismo teléfono vuelve mes a mes al mismo lugar.
          left join conocidos co
            on e.tipo = 'ingreso' and not e.sin_datos
           and co.rn = ((e.idx * 7) + (e.semilla_c % 12)) % co.total
          left join destinos de
            on e.tipo = 'salida' and de.rn = e.semilla_d % de.total
          left join vigiladores vg on vg.rn = e.semilla_e % vg.total
         where e.tipo = 'ingreso' or de.id is not null
      ),
      anonimos as (
        -- Una fila de vecino vacía por visita, que es lo que hace
        -- app.registrar_vecino cuando no hay teléfono con el que reconocer a
        -- nadie: cuenta como visita y nunca como vecino identificado.
        insert into vecinos (id, sitio_alta_id, creado_por_id, creado_en)
        select v.vecino_anonimo_id, v.sitio_id, v.perfil_id, v.creado_en
          from visitas v
         where v.tipo = 'ingreso' and (v.sin_datos or v.vecino_conocido_id is null)
        returning id
      ),
      insertados as (
        insert into movimientos (
          flujo, tipo, sitio_id, ocurrido_en,
          origen_clase, origen_vecino_id, origen_sitio_id,
          destino_clase, destino_sitio_id, destino_entidad_id,
          tipo_valorizacion, vecino_sin_datos,
          vigilador_id, cargado_por_id, creado_en
        )
        select
          'punto_verde', v.tipo, v.sitio_id, v.ocurrido_en,
          case when v.tipo = 'ingreso' then 'vecino' else 'sitio' end,
          case when v.tipo = 'ingreso'
               then coalesce(v.vecino_conocido_id, v.vecino_anonimo_id) end,
          case when v.tipo = 'salida'  then v.sitio_id end,
          case when v.tipo = 'ingreso' then 'sitio' else 'entidad' end,
          case when v.tipo = 'ingreso' then v.sitio_id end,
          case when v.tipo = 'salida'  then v.destino_id end,
          v.tipo_valorizacion, v.sin_datos,
          v.vigilador_id, v.perfil_id, v.creado_en
        from visitas v
        returning id, tipo, numero
      ),
      materiales_pv as (
        select mt.id, mt.unidad_default_id, t.tipo,
               row_number() over (partition by t.tipo order by mt.orden) as rn,
               count(*)     over (partition by t.tipo)                   as total
          from materiales mt
          cross join (values ('ingreso'::text), ('salida')) as t(tipo)
         where mt.activo and 'punto_verde' = any(mt.flujos) and t.tipo = any(mt.tipos)
      ),
      items as (
        select i.id, i.tipo, i.numero, 0 as desplazamiento from insertados i
        union all
        -- Tres de cada diez visitas traen dos materiales: cartón y plástico
        -- en la misma bolsa es lo más común del punto verde.
        select i.id, i.tipo, i.numero, 3 from insertados i where i.numero % 10 < 3
      )
      insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id)
      select it.id, m.id,
             -- Todo se pesa en kg: el vecino deja unos kilos, la salida se
             -- lleva cientos.
             case when it.tipo = 'ingreso'
                  then (20  + ((it.numero + it.desplazamiento) * 7)  % 180)::numeric  / 10
                  else (800 + ((it.numero + it.desplazamiento) * 13) % 4200)::numeric / 10
             end,
             m.unidad_default_id
        from items it
        join materiales_pv m
          on m.tipo = it.tipo
         and m.rn = 1 + ((it.numero + it.desplazamiento) % m.total)
    `)

    const [{ total: creados }] = await tx.consultar<{ total: string }>(
      `select count(*)::text as total from movimientos where flujo = 'punto_verde'`,
    )
    console.log(`  ${creados} movimientos de puntos verdes generados (últimos 4 meses).`)
  })

  // ── Conteo diario en Paso de los Andes ──────────────────────────────────
  // Ese punto no carga desde el celular: el personal es de otra Secretaría.
  // Sin estos conteos aparece en cero y el tablero informa una caída que no
  // existe, que es justamente lo que hay que poder distinguir.
  await comoServicio(async (tx) => {
    const [{ ya }] = await tx.consultar<{ ya: string }>(
      'select count(*)::text as ya from conteos_diarios',
    )
    if (Number(ya) > 0) {
      console.log('  Los conteos diarios ya están cargados: no se tocan.')
      return
    }
    await tx.consultar(`
      insert into conteos_diarios (sitio_id, fecha, vecinos, cargado_por_id)
      select
        s.id,
        d::date,
        -- Entre 6 y 25 por día, más los fines de semana, que es cuando la gente
        -- puede acercarse. Algunos días sin carga: nadie anota todos los días.
        6 + (('x' || substr(md5(d::text || s.codigo), 1, 4))::bit(16)::int % 20)
          + case when extract(isodow from d) >= 6 then 8 else 0 end,
        (select id from perfiles where usuario = 'pv03')
      from sitios s,
           generate_series(current_date - 119, current_date, interval '1 day') d
      where s.codigo = 'PV-03'
        and (('x' || substr(md5(d::text || 'carga'), 1, 4))::bit(16)::int % 10) < 8
      on conflict (sitio_id, fecha) do nothing
    `)
    const [{ c }] = await tx.consultar<{ c: string }>('select count(*)::text as c from conteos_diarios')
    console.log(`  ${c} conteos diarios cargados en Paso de los Andes.`)
  })

  // ── La cadena del compost ───────────────────────────────────────────────
  // Sin esto las pilas quedan como cajas vacías y no se puede evaluar lo único
  // que la Secretaría nombró como necesidad no cubierta: saber de dónde salió
  // un camión de compost. Se arma en dos pasos.
  await comoServicio(async (tx) => {
    const [{ ya }] = await tx.consultar<{ ya: string }>(
      'select count(*)::text as ya from movimientos where pila_id is not null',
    )
    if (Number(ya) > 0) {
      console.log('  La cadena del compost ya está armada: no se toca.')
      return
    }

    // 1. Cada ingreso a la Planta entra a la pila que estaba abierta ese día,
    //    hasta llenarla. Una pila mide 1 × 1 × 100 m: no le entran veinte
    //    camiones. Sin el tope, toda la ventana caía en la misma pila y la
    //    ficha mostraba 700 m³ en una cancha de 100.
    //
    //    Los ingresos que no entran quedan sin pila, que también es realista:
    //    no todos los camiones se anotan, sobre todo al principio. Y hace que
    //    el indicador de "cuántas salidas declaran pila" tenga algo que medir.
    await tx.consultar(`
      with ordenados as (
        select
          m.id,
          p.id as pila_id,
          sum(i.m3) over (partition by p.id order by m.ocurrido_en
                          rows between unbounded preceding and current row) as acumulado
        from movimientos m
        join pilas p
          on p.sitio_id = m.sitio_id
         and m.ocurrido_en::date between p.fecha_armado
                                     and coalesce(p.fecha_cierre, current_date)
        join lateral (
          select sum(it.cantidad * coalesce(u.factor_m3, 0)) as m3
            from movimiento_items it join unidades u on u.id = it.unidad_id
           where it.movimiento_id = m.id
        ) i on true
        where m.flujo = 'planta' and m.tipo = 'ingreso' and m.pila_id is null
      )
      update movimientos m
         set pila_id = o.pila_id
        from ordenados o
       where m.id = o.id
         and o.acumulado <= (select largo_m * ancho_m * alto_m from pilas where id = o.pila_id)
    `)

    // 2. Cada salida de compost, triturado o leña sale de una pila que ya podía
    //    despacharse a esa fecha. Las salidas de chipeo no: el chipeo no pasa
    //    por pila, se tritura y se va.
    await tx.consultar(`
      update movimientos m
         set pila_id = elegida.id
        from (
          select m2.id as movimiento_id,
                 -- Nunca de una pila en formación: de esas todavía no sale nada.
                 (select p.id
                    from pilas p
                   where p.sitio_id = m2.sitio_id
                     and p.estado <> 'en_formacion'
                     and p.fecha_cierre is not null
                     and p.fecha_cierre < m2.ocurrido_en::date
                   order by p.fecha_cierre desc
                   limit 1) as id
            from movimientos m2
           where m2.flujo = 'planta' and m2.tipo = 'salida' and m2.pila_id is null
             and exists (
               select 1 from movimiento_items i join materiales mt on mt.id = i.material_id
                where i.movimiento_id = m2.id
                  and mt.nombre in ('Compost', 'Triturado', 'Leña'))
        ) elegida
       where m.id = elegida.movimiento_id and elegida.id is not null
    `)

    // 3. Controles: un volteo cada dos semanas desde el cierre y riegos entre
    //    medio. La pila P-13 queda sin voltear a propósito, para que el tablero
    //    tenga al menos una atrasada que mostrar.
    await tx.consultar(
      `insert into pila_controles (pila_id, tipo, ocurrido_en, registrado_por_id)
       select p.id, 'volteo',
              (p.fecha_cierre + (n * 14))::timestamptz + interval '9 hours',
              (select id from perfiles where usuario = 'planta')
         from pilas p, generate_series(1, 8) n
        where p.fecha_cierre is not null
          and p.codigo <> 'P-13'
          and (p.fecha_cierre + (n * 14)) <= current_date`,
    )
    await tx.consultar(
      `insert into pila_controles (pila_id, tipo, ocurrido_en, registrado_por_id)
       select p.id, 'riego',
              (p.fecha_cierre + (n * 7))::timestamptz + interval '16 hours',
              (select id from perfiles where usuario = 'planta')
         from pilas p, generate_series(1, 16) n
        where p.fecha_cierre is not null
          and (p.fecha_cierre + (n * 7)) <= current_date`,
    )
    // Una temperatura por pila, que es el otro control que se anota.
    await tx.consultar(
      `insert into pila_controles (pila_id, tipo, ocurrido_en, valor, registrado_por_id)
       select p.id, 'temperatura',
              (coalesce(p.fecha_cierre, p.fecha_armado) + 30)::timestamptz + interval '10 hours',
              48 + (('x' || substr(md5(p.codigo), 1, 4))::bit(16)::int % 22),
              (select id from perfiles where usuario = 'planta')
         from pilas p
        where (coalesce(p.fecha_cierre, p.fecha_armado) + 30) <= current_date`,
    )

    const [r] = await tx.consultar<{ ing: string; sal: string; ctrl: string }>(
      `select
         (select count(*)::text from movimientos where pila_id is not null and tipo = 'ingreso') as ing,
         (select count(*)::text from movimientos where pila_id is not null and tipo = 'salida')  as sal,
         (select count(*)::text from pila_controles) as ctrl`,
    )
    console.log(
      `  Cadena del compost: ${r.ing} ingresos y ${r.sal} salidas vinculados a pilas, ${r.ctrl} controles.`,
    )
  })

  const totales = await comoServicio((tx) =>
    tx.consultar<{ flujo: string; total: string }>(
      `select flujo, count(*)::text as total from movimientos group by flujo`,
    ),
  )
  const porFlujo = (flujo: string) => totales.find((t) => t.flujo === flujo)?.total ?? '0'

  console.log(`
  Listo. Movimientos cargados: ${porFlujo('planta')} de la Planta y ${porFlujo('punto_verde')} de puntos verdes.`)
  avisoDeUsuarios()
}

/**
 * Las credenciales que quedaron puestas. Contra un Postgres de verdad el aviso
 * es otro: ahí son una puerta abierta, no una comodidad.
 */
function avisoDeUsuarios() {
  console.log(`
  Usuarios creados:

    Dirección de IA  usuario: direccionia    clave: 123456
    Coordinadora     usuario: coordinacion   clave: ambiente2026
    Planta           usuario: planta         PIN:   1234
    Puntos verdes    usuario: pv01 … pv08    PIN:   1234
`)
  if (process.env.DATABASE_URL?.trim()) {
    console.log(`
  ⚠  Esta base no es la local. Esas claves están publicadas en el repositorio:
     cambialas desde Usuarios antes de darle el link a nadie.
     npm run db:verificar falla mientras alguna siga puesta.
`)
  } else {
    console.log('  Cambiar antes de cualquier despliegue.')
  }
}

const esEntrada = process.argv[1]?.replace(/\\/g, '/').endsWith('db/cli/sembrar.ts')
if (esEntrada) {
  sembrar()
    .then(async () => (await obtenerBase()).cerrar())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}

export { sembrar }
