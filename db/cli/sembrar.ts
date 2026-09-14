/**
 * Datos de arranque para poder probar la app apenas se levanta.
 *
 *     npm run db:sembrar
 *
 * TODO ESTO ES DE EJEMPLO y está para que la coordinadora lo reemplace desde
 * la pantalla de listas maestras: los nombres de los puntos verdes, las
 * patentes, los choferes y los destinos habilitados son inventados. Los
 * materiales y las unidades son los que sí salieron del relevamiento, pero la
 * unidad de cada material es un supuesto marcado (pregunta 1).
 *
 * Es idempotente: correrlo dos veces no duplica nada.
 */
import { comoServicio } from '../sesion'
import { obtenerBase } from '../client'
import { hashearCredencial } from '../credenciales'

const SITIOS = [
  ['PLANTA', 'Planta de Valorización de Residuos Verdes', 'planta',      'Av. Perón s/n',      1],
  ['PV-01',  'Punto Verde Plaza Urquiza',                 'punto_verde', 'Plaza Urquiza',      2],
  ['PV-02',  'Punto Verde Barrio Sur',                    'punto_verde', 'Barrio Sur',         3],
  ['PV-03',  'Punto Verde Villa Luján',                   'punto_verde', 'Villa Luján',        4],
  ['PV-04',  'Punto Verde Parque 9 de Julio',             'punto_verde', 'Parque 9 de Julio',  5],
  ['PV-05',  'Punto Verde Barrio Norte',                  'punto_verde', 'Barrio Norte',       6],
  ['PV-06',  'Punto Verde Villa 9 de Julio',              'punto_verde', 'Villa 9 de Julio',   7],
  ['PV-07',  'Punto Verde Ciudadela',                     'punto_verde', 'Ciudadela',          8],
  ['PV-08',  'Punto Verde Barrio Jardín',                 'punto_verde', 'Barrio Jardín',      9],
] as const

// codigo, nombre, plural, decimales, factor_m3 (SUPUESTO), orden
const UNIDADES = [
  ['m3',     'm³',      'm³',       1, 1,     1],
  ['camion', 'camión',  'camiones', 0, 12,    2], // SUPUESTO: 12 m³ por camión
  ['batea',  'batea',   'bateas',   0, 20,    3], // SUPUESTO: 20 m³ por batea
  ['bolsa',  'bolsa',   'bolsas',   0, 0.05,  4], // SUPUESTO: 50 litros
  ['kg',     'kg',      'kg',       2, null,  5],
  ['tn',     'tonelada','toneladas',2, null,  6],
  ['unidad', 'unidad',  'unidades', 0, null,  7],
] as const

// nombre, categoria, flujos, tipos, unidad, sugerencias, color, orden
const MATERIALES: ReadonlyArray<
  readonly [string, string, string[], string[], string, number[], string, number]
> = [
  ['Poda',                   'verdes',      ['planta'],                       ['ingreso'],           'm3',     [5, 10, 15, 20], '#25d366', 1],
  ['Restos de jardinería',   'verdes',      ['planta'],                       ['ingreso'],           'm3',     [2, 5, 10, 15],  '#10b981', 2],
  ['Tronco y madera gruesa', 'verdes',      ['planta'],                       ['ingreso'],           'm3',     [1, 2, 5],       '#1aa851', 3],
  ['Chipeo',                 'verdes',      ['planta'],                       ['ingreso', 'salida'], 'camion', [1, 2],          '#3cb4f0', 4],
  ['Triturado',              'verdes',      ['planta'],                       ['salida'],            'batea',  [1, 2],          '#2589ea', 5],
  ['Compost',                'verdes',      ['planta'],                       ['salida'],            'm3',     [1, 3, 5, 10],   '#126ff5', 6],
  ['Cartón',                 'reciclables', ['punto_verde'],                  ['ingreso', 'salida'], 'kg',     [5, 10, 20],     '#f5b81c', 7],
  ['Papel',                  'reciclables', ['punto_verde'],                  ['ingreso', 'salida'], 'kg',     [5, 10, 20],     '#f59e0b', 8],
  ['Plástico PET',           'reciclables', ['punto_verde'],                  ['ingreso', 'salida'], 'kg',     [2, 5, 10],      '#28469f', 9],
  ['Vidrio',                 'reciclables', ['punto_verde'],                  ['ingreso', 'salida'], 'kg',     [5, 10, 20],     '#3cb4f0', 10],
  ['Metal y latas',          'reciclables', ['punto_verde'],                  ['ingreso', 'salida'], 'kg',     [2, 5, 10],      '#6b7885', 11],
  ['Aceite vegetal usado',   'especiales',  ['punto_verde'],                  ['ingreso', 'salida'], 'kg',     [1, 3, 5],       '#ef8f16', 12],
  ['Retazos de tela',        'textil',      ['gran_generador', 'punto_verde'],['ingreso', 'salida'], 'kg',     [10, 25, 50],    '#8b5cf6', 13],
  ['Recortes de madera',     'madera',      ['gran_generador', 'punto_verde'],['ingreso', 'salida'], 'kg',     [10, 25, 50],    '#a16207', 14],
]

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

// patente, tipo, capacidad_m3
const VEHICULOS: ReadonlyArray<readonly [string, string, number | null]> = [
  ['AB 123 CD', 'camion',    12],
  ['AC 456 EF', 'camion',    14],
  ['AD 789 GH', 'batea',     20],
  ['AE 012 IJ', 'batea',     22],
  ['AF 345 KL', 'camioneta',  3],
  ['NPQ 678',   'camion',    10],
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

async function sembrar() {
  await comoServicio(async (tx) => {
    // ── Sitios ───────────────────────────────────────────────────────────
    for (const [codigo, nombre, tipo, direccion, orden] of SITIOS) {
      await tx.consultar(
        `insert into sitios (codigo, nombre, tipo, direccion, orden)
         values ($1, $2, $3, $4, $5) on conflict (codigo) do nothing`,
        [codigo, nombre, tipo, direccion, orden],
      )
    }

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
      await tx.consultar(
        `insert into materiales
           (nombre, categoria, flujos, tipos, unidad_default_id, unidades_permitidas, sugerencias, color, orden)
         select $1, $2, $3::text[], $4::text[], u.id, array[u.id], $5::numeric[], $6, $7
           from unidades u where u.codigo = $8
         on conflict do nothing`,
        [nombre, categoria, flujos, tipos, sugerencias, color, orden, unidad],
      )
    }

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
    for (const [nombre, rol] of PERSONAS) {
      await tx.consultar(
        `insert into personas (nombre, rol, sitio_id)
         select $1, $2, (select id from sitios where codigo = 'PLANTA')
         where not exists (select 1 from personas where nombre = $1 and rol = $2)`,
        [nombre, rol],
      )
    }

    // ── Pilas de compost (creadas, sin pantalla en la fase 1) ────────────
    await tx.consultar(
      `insert into pilas (codigo, sitio_id, estado)
       select 'P-' || lpad(n::text, 2, '0'), (select id from sitios where codigo = 'PLANTA'), 'madurando'
         from generate_series(1, 17) n
       on conflict (codigo) do nothing`,
    )

    // ── Usuarios ─────────────────────────────────────────────────────────
    // CREDENCIALES DE DESARROLLO. Cambiar antes de cualquier despliegue.
    const usuarios: Array<[string, string, 'admin' | 'vigilador', string | null, string, number | null]> = [
      ['coordinacion', 'Coordinación de Ambiente', 'admin', null, 'ambiente2026', 12],
      ['planta', 'Planta de Valorización — turno', 'vigilador', 'PLANTA', '1234', null],
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
        select (select id from sitios   where codigo = 'PLANTA')          as planta,
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
      'select count(*)::text as total from movimientos',
    )
    console.log(`  ${creados} movimientos de ejemplo generados (últimos 4 meses).`)
  })

  console.log(`
  Listo. Usuarios de desarrollo:

    Coordinadora   usuario: coordinacion   clave: ambiente2026
    Planta         usuario: planta         PIN:   1234
    Puntos verdes  usuario: pv01 … pv08    PIN:   1234

  Cambiar antes de cualquier despliegue.
`)
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
