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
    // Choferes, autorizantes y operarios trabajan en la Planta. Los vigiladores
    // van repartidos: el selector de "quién está de turno" solo ofrece los del
    // propio punto, así que si todos quedan en la Planta, los ocho puntos
    // verdes abren diciendo que no hay nadie cargado.
    for (const [nombre, rol] of PERSONAS) {
      await tx.consultar(
        `insert into personas (nombre, rol, sitio_id)
         select $1, $2, (select id from sitios where codigo = 'PLANTA')
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
             where s.tipo = 'punto_verde' and s.activo
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
         where s.tipo = 'punto_verde' and s.activo
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

  const totales = await comoServicio((tx) =>
    tx.consultar<{ flujo: string; total: string }>(
      `select flujo, count(*)::text as total from movimientos group by flujo`,
    ),
  )
  const porFlujo = (flujo: string) => totales.find((t) => t.flujo === flujo)?.total ?? '0'

  console.log(`
  Listo. Movimientos cargados: ${porFlujo('planta')} de la Planta y ${porFlujo('punto_verde')} de puntos verdes.

  Usuarios de desarrollo:

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
