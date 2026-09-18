/**
 * Escribe un archivo .sql para pegar en el editor SQL del proveedor.
 *
 *     npm run db:sql                  base nueva: todo, de cero
 *     npm run db:sql -- --desde 0019  sólo de esa migración en adelante
 *     npm run db:sql -- --datos       poner al día las listas de una base en uso
 *
 * Está para cuando no se puede conectar el CLI contra la base remota —la
 * conexión directa de Supabase es sólo IPv6 y muchos proveedores de internet
 * todavía no lo dan—.
 *
 * El archivo completo trae, en este orden:
 *
 *   1. un guardián que aborta si la base ya tiene migraciones aplicadas;
 *   2. las migraciones, en orden, tal cual están en db/migrations/;
 *   3. las filas de app.migraciones, para que un `npm run db:migrar` posterior
 *      no intente re-aplicar nada;
 *   4. los datos base, desde db/datos-base.ts;
 *   5. una comprobación final que falla si algo no quedó como corresponde.
 *
 * El incremental trae 2, 3 y 5, y un guardián al revés: aborta si la base no
 * está exactamente en el punto anterior.
 *
 * El de datos no toca la estructura: pone las listas maestras —sitios,
 * recipientes, corrientes, contenedores— como están hoy en db/datos-base.ts,
 * actualizando lo que cambió de nombre y dando de baja lo que dejó de estar. Es
 * lo que hace falta cuando las listas cambian después de haber entregado la
 * base, que es exactamente lo que pasó al leer los formularios de la Secretaría.
 *
 * En los dos casos, antes de escribir nada, ejecuta el archivo contra un PGlite
 * en memoria y verifica el resultado. Si no sirve, falla y no lo escribe.
 */
import '../entorno'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { sentenciasBase, sentenciasPonerAlDia } from '../datos-base'

const CARPETA = path.join(process.cwd(), 'db', 'migrations')

/** Lo que tiene que haber quedado en una base nueva. Si no, no se escribe. */
const ESPERADO: ReadonlyArray<readonly [string, number]> = [
  ['sitios', 10],
  ['unidades', 9],
  ['materiales', 21],
  ['contenedores', 40],
  ['perfiles', 1],
  ['movimientos', 0],
  ['entidades', 0],
  ['personas', 0],
]

/**
 * Un valor de JavaScript como literal de Postgres.
 *
 * Las cadenas van entre comillas simples con las comillas internas duplicadas.
 * Los backslash quedan tal cual porque `standard_conforming_strings` viene en
 * `on` desde Postgres 9.1: ahí adentro un backslash es un backslash.
 */
function literal(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Número que no se puede escribir: ${v}`)
    return String(v)
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) {
    if (!v.length) return `'{}'`
    return `array[${v.map(literal).join(', ')}]`
  }
  if (typeof v === 'string') return `'${v.replaceAll("'", "''")}'`
  throw new Error(`No sé escribir este valor: ${typeof v}`)
}

/**
 * Reemplaza $1, $2… por sus valores.
 *
 * En una sola pasada y con función de reemplazo, por dos motivos: los hashes de
 * scrypt contienen `$1` y `$8` —`scrypt$16384$8$1$sal$derivado`—, así que una
 * cadena de reemplazo los interpretaría como referencias a grupos de captura, y
 * una segunda pasada volvería a sustituir lo ya sustituido.
 */
function inyectar(sql: string, params: unknown[]): string {
  return sql.replace(/\$(\d+)/g, (entero, n) => {
    const i = Number(n) - 1
    if (i < 0 || i >= params.length) throw new Error(`Falta el parámetro ${entero} en: ${sql}`)
    return literal(params[i])
  })
}

const marco = (titulo: string) =>
  ['', `-- ${'═'.repeat(71)}`, `-- ${titulo}`, `-- ${'═'.repeat(71)}`, ''].join('\n')

/** El mismo hash que calcula db/migraciones.ts, sobre el archivo tal cual. */
function hashDe(archivo: string): string {
  const sql = readFileSync(path.join(CARPETA, archivo), 'utf8')
  return createHash('sha256').update(sql).digest('hex').slice(0, 16)
}

function todasLasMigraciones(): string[] {
  const archivos = readdirSync(CARPETA).filter((f) => f.endsWith('.sql')).sort()
  if (!archivos.length) throw new Error('No hay migraciones en db/migrations')
  return archivos
}

/** Las migraciones y su registro. Es la parte común a los dos archivos. */
function bloqueMigraciones(archivos: string[], desdeNumero: number): string[] {
  const partes: string[] = []
  archivos.forEach((archivo, i) => {
    partes.push(marco(archivo))
    partes.push(readFileSync(path.join(CARPETA, archivo), 'utf8').trimEnd())
    void i
  })

  // Sin estas filas, un `npm run db:migrar` posterior vería las migraciones como
  // pendientes y las volvería a aplicar sobre tablas que ya existen.
  partes.push(marco(`${desdeNumero + archivos.length} · Registro de migraciones aplicadas`))
  partes.push(
    'insert into app.migraciones (nombre, hash) values\n' +
      archivos.map((a) => `  (${literal(a)}, ${literal(hashDe(a))})`).join(',\n') +
      '\non conflict (nombre) do nothing;',
  )
  return partes
}

export function construirCompleto(): string {
  const archivos = todasLasMigraciones()
  const partes: string[] = []

  partes.push(
    [
      `-- ${'═'.repeat(71)}`,
      '-- Registro y trazabilidad de residuos',
      '-- Secretaría de Ambiente y Desarrollo Sustentable · San Miguel de Tucumán',
      '--',
      `-- Base nueva, de cero: ${archivos.length} migraciones + los datos del relevamiento.`,
      '-- Generado por `npm run db:sql`. No editar a mano: se regenera.',
      '--',
      '-- CÓMO SE USA',
      '--   Supabase → SQL Editor → New query → pegar todo esto → Run.',
      '--   Tarda unos segundos. Al final devuelve una tabla con lo que quedó cargado.',
      '--',
      '-- QUÉ NO TRAE',
      '--   Ningún dato inventado: ni choferes, ni patentes, ni destinos, ni pilas,',
      '--   ni movimientos. Eso lo carga la coordinadora desde la app.',
      '--',
      '-- DESPUÉS',
      '--   Las credenciales de fábrica están publicadas en el repositorio.',
      '--   Cambiarlas desde la pantalla Usuarios antes de darle el link a nadie.',
      `-- ${'═'.repeat(71)}`,
    ].join('\n'),
  )

  // Si la base ya tiene el registro de migraciones, esto no es una base nueva y
  // aplicar todo de nuevo la rompe. Mejor cortar antes de tocar nada.
  partes.push(marco('0 · Guardián: esto es para una base vacía'))
  partes.push(
    [
      'do $guardian$',
      'begin',
      '  if exists (',
      '    select 1 from information_schema.tables',
      "     where table_schema = 'app' and table_name = 'migraciones'",
      '  ) then',
      "    raise exception 'Esta base ya tiene migraciones aplicadas. Este archivo es para una base vacía; " +
        "para actualizar una que ya está en uso: npm run db:sql -- --desde <la primera que falte>.';",
      '  end if;',
      'end',
      '$guardian$;',
    ].join('\n'),
  )

  partes.push(...bloqueMigraciones(archivos, 0))

  partes.push(marco(`${archivos.length + 2} · Datos base`))
  for (const { sql, params } of sentenciasBase()) {
    partes.push(`${inyectar(sql, params).trim()};`)
  }

  // Si algo salió distinto, mejor que reviente ahora: el editor corre todo el
  // script en una transacción, así que una excepción acá deja la base como
  // estaba en vez de dejarla a medio armar.
  partes.push(marco(`${archivos.length + 3} · Comprobación`))
  partes.push(
    [
      'do $control$',
      'declare',
      '  n bigint;',
      'begin',
      ...ESPERADO.flatMap(([tabla, cuenta]) => [
        `  select count(*) into n from ${tabla};`,
        `  if n <> ${cuenta} then`,
        `    raise exception 'Se esperaban ${cuenta} filas en ${tabla} y hay %', n;`,
        '  end if;',
      ]),
      'end',
      '$control$;',
    ].join('\n'),
  )

  partes.push(
    [
      '',
      '-- Lo que quedó cargado. Esta es la tabla que devuelve el editor.',
      "select 'sitios' as tabla, count(*) as filas from sitios",
      "union all select 'recipientes', count(*) from unidades",
      "union all select 'corrientes', count(*) from materiales",
      "union all select 'contenedores', count(*) from contenedores",
      "union all select 'usuarios', count(*) from perfiles",
      "union all select 'migraciones', count(*) from app.migraciones",
      'order by 1;',
      '',
    ].join('\n'),
  )

  return partes.join('\n') + '\n'
}

export function construirIncremental(desde: string): { texto: string; nuevas: string[] } {
  const archivos = todasLasMigraciones()
  const corte = archivos.findIndex((a) => a.startsWith(desde))
  if (corte < 0) throw new Error(`No hay ninguna migración que empiece con "${desde}"`)
  if (corte === 0) throw new Error('Para la primera migración el archivo es el completo: npm run db:sql')

  const previas = archivos.slice(0, corte)
  const nuevas = archivos.slice(corte)
  const ultimaPrevia = previas[previas.length - 1]

  const partes: string[] = []
  partes.push(
    [
      `-- ${'═'.repeat(71)}`,
      '-- Registro y trazabilidad de residuos',
      '-- Secretaría de Ambiente y Desarrollo Sustentable · San Miguel de Tucumán',
      '--',
      `-- Actualización de una base que ya está andando: ${nuevas.length} migración(es).`,
      `--   ${nuevas.join('\n--   ')}`,
      '--',
      '-- Generado por `npm run db:sql -- --desde ' + desde + '`. No editar a mano.',
      '--',
      '-- CÓMO SE USA',
      '--   Supabase → SQL Editor → New query → pegar todo esto → Run.',
      '--   No toca ningún dato: sólo estructura y permisos.',
      `-- ${'═'.repeat(71)}`,
    ].join('\n'),
  )

  // Al revés que el completo: acá el peligro es aplicarlo sobre una base que no
  // está en el punto justo. Si falta alguna anterior, o si ésta ya se aplicó, no
  // se toca nada.
  partes.push(marco('0 · Guardián: la base tiene que estar en el punto anterior'))
  partes.push(
    [
      'do $guardian$',
      'declare',
      '  faltan text;',
      'begin',
      '  if not exists (',
      '    select 1 from information_schema.tables',
      "     where table_schema = 'app' and table_name = 'migraciones'",
      '  ) then',
      "    raise exception 'Esta base no tiene ninguna migración aplicada. Va el archivo completo, no éste.';",
      '  end if;',
      '',
      '  select string_agg(m, \', \' order by m) into faltan',
      `    from unnest(array[${previas.map(literal).join(', ')}]) m`,
      '   where not exists (select 1 from app.migraciones x where x.nombre = m);',
      '  if faltan is not null then',
      "    raise exception 'Faltan migraciones anteriores: %. Aplicarlas primero.', faltan;",
      '  end if;',
      '',
      `  if exists (select 1 from app.migraciones where nombre = ${literal(nuevas[0])}) then`,
      `    raise exception 'La migración % ya está aplicada en esta base.', ${literal(nuevas[0])};`,
      '  end if;',
      'end',
      '$guardian$;',
    ].join('\n'),
  )

  partes.push(...bloqueMigraciones(nuevas, 0))

  partes.push(marco(`${nuevas.length + 2} · Comprobación`))
  partes.push(
    [
      'do $control$',
      'declare',
      '  n bigint;',
      'begin',
      '  select count(*) into n from app.migraciones;',
      `  if n <> ${archivos.length} then`,
      `    raise exception 'Se esperaban ${archivos.length} migraciones registradas y hay %', n;`,
      '  end if;',
      'end',
      '$control$;',
    ].join('\n'),
  )

  partes.push(
    [
      '',
      '-- Las migraciones que quedaron registradas. Esta es la tabla que devuelve el editor.',
      'select nombre, aplicada_en from app.migraciones order by nombre;',
      '',
    ].join('\n'),
  )

  void ultimaPrevia
  return { texto: partes.join('\n') + '\n', nuevas }
}

/**
 * Corre el archivo contra un Postgres en memoria y comprueba el resultado. Es la
 * única forma de estar seguro de que lo que se entrega anda: el archivo se arma
 * con concatenación, y la concatenación no avisa cuando se rompe algo.
 */
async function enMemoria<T>(fn: (pg: { exec: Function; query: Function }) => Promise<T>): Promise<T> {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  try {
    return await fn(pg as never)
  } finally {
    await pg.close()
  }
}

const cuantos = async (pg: { query: Function }, tabla: string) => {
  const r = (await pg.query(`select count(*)::int as n from ${tabla}`)) as { rows: Array<{ n: number }> }
  return r.rows[0].n
}

async function probarCompleto(texto: string): Promise<Record<string, number>> {
  const filas = await enMemoria(async (pg) => {
    await pg.exec(texto)
    const r: Record<string, number> = {}
    for (const [tabla] of ESPERADO) r[tabla] = await cuantos(pg, tabla)
    r['app.migraciones'] = await cuantos(pg, 'app.migraciones')
    return r
  })

  // Que el guardián haga su trabajo: correrlo dos veces tiene que fallar.
  let freno = false
  try {
    await enMemoria((pg) => pg.exec(texto + '\n' + texto))
  } catch (e) {
    freno = /ya tiene migraciones aplicadas/.test((e as Error).message)
    if (!freno) throw e
  }
  if (!freno) throw new Error('El guardián no frenó una segunda aplicación. No escribo el archivo.')

  return filas
}

async function probarIncremental(desde: string, texto: string): Promise<number> {
  const archivos = todasLasMigraciones()
  const corte = archivos.findIndex((a) => a.startsWith(desde))
  const previas = archivos.slice(0, corte)

  // La base como está hoy: las migraciones anteriores y su registro, nada más.
  const anterior =
    previas.map((a) => readFileSync(path.join(CARPETA, a), 'utf8')).join('\n') +
    '\ninsert into app.migraciones (nombre, hash) values\n' +
    previas.map((a) => `  (${literal(a)}, ${literal(hashDe(a))})`).join(',\n') +
    '\non conflict (nombre) do nothing;\n'

  const total = await enMemoria(async (pg) => {
    await pg.exec(anterior)
    await pg.exec(texto)
    return cuantos(pg, 'app.migraciones')
  })

  // Sobre una base que ya lo tiene, tiene que frenar.
  let freno = false
  try {
    await enMemoria(async (pg) => {
      await pg.exec(anterior)
      await pg.exec(texto)
      await pg.exec(texto)
    })
  } catch (e) {
    freno = /ya está aplicada/.test((e as Error).message)
    if (!freno) throw e
  }
  if (!freno) throw new Error('El guardián no frenó una segunda aplicación. No escribo el archivo.')

  // Y sobre una base vacía, también.
  let frenoVacia = false
  try {
    await enMemoria((pg) => pg.exec(texto))
  } catch (e) {
    frenoVacia = /no tiene ninguna migración|does not exist/.test((e as Error).message)
    if (!frenoVacia) throw e
  }
  if (!frenoVacia) throw new Error('El guardián no frenó sobre una base vacía. No escribo el archivo.')

  return total
}

/**
 * Lo que tiene que quedar activo después de poner las listas al día. Son las
 * mismas cuentas que una base nueva, porque el resultado es el mismo: lo que
 * cambia es de dónde se parte.
 */
const ESPERADO_ACTIVO: ReadonlyArray<readonly [string, number]> = [
  ['sitios', 10],
  ['unidades', 9],
  ['materiales', 21],
  ['contenedores', 40],
]

export function construirDatos(): string {
  const archivos = todasLasMigraciones()
  const ultima = archivos[archivos.length - 1]
  const partes: string[] = []

  partes.push(
    [
      `-- ${'═'.repeat(71)}`,
      '-- Registro y trazabilidad de residuos',
      '-- Secretaría de Ambiente y Desarrollo Sustentable · San Miguel de Tucumán',
      '--',
      '-- Listas maestras al día: sitios, recipientes, corrientes y contenedores.',
      '-- Generado por `npm run db:sql -- --datos`. No editar a mano: se regenera.',
      '--',
      '-- QUÉ HACE',
      '--   Deja las cuatro listas como están hoy en el proyecto. Lo que cambió de',
      '--   nombre o de color se actualiza; lo que ya no está en la lista se marca',
      '--   inactivo y deja de ofrecerse en el celular.',
      '--',
      '-- QUÉ NO HACE',
      '--   No borra nada: un movimiento viejo se sigue viendo con la corriente con',
      '--   la que se cargó. No toca usuarios ni contraseñas. No toca la estructura.',
      '--   Se puede correr las veces que haga falta: el resultado es siempre el mismo.',
      '--',
      '-- CÓMO SE USA',
      '--   Supabase → SQL Editor → New query → pegar todo esto → Run.',
      `-- ${'═'.repeat(71)}`,
    ].join('\n'),
  )

  // Las listas viven adentro de la estructura, así que la estructura tiene que
  // estar completa. Si falta la última migración, las columnas que estas
  // sentencias escriben capaz todavía no existen.
  partes.push(marco('0 · Guardián: la estructura tiene que estar completa'))
  partes.push(
    [
      'do $guardian$',
      'begin',
      '  if not exists (',
      '    select 1 from information_schema.tables',
      "     where table_schema = 'app' and table_name = 'migraciones'",
      '  ) then',
      "    raise exception 'Esta base no tiene ninguna migración aplicada. Va el archivo completo, no éste.';",
      '  end if;',
      '',
      `  if not exists (select 1 from app.migraciones where nombre = ${literal(ultima)}) then`,
      `    raise exception 'Falta aplicar %. Primero la estructura, después las listas.', ${literal(ultima)};`,
      '  end if;',
      'end',
      '$guardian$;',
    ].join('\n'),
  )

  partes.push(marco('1 · Las listas, como están hoy'))
  for (const { sql, params } of sentenciasPonerAlDia()) {
    partes.push(`${inyectar(sql, params).trim()};`)
  }

  partes.push(marco('2 · Comprobación'))
  partes.push(
    [
      'do $control$',
      'declare',
      '  n bigint;',
      'begin',
      ...ESPERADO_ACTIVO.flatMap(([tabla, cuenta]) => [
        `  select count(*) into n from ${tabla} where activo;`,
        `  if n <> ${cuenta} then`,
        `    raise exception 'Se esperaban ${cuenta} filas activas en ${tabla} y hay %', n;`,
        '  end if;',
      ]),
      "  if not exists (select 1 from sitios where codigo = 'PVRV-VIV' and activo)",
      "     or not exists (select 1 from sitios where codigo = 'PVRV-HUE' and activo) then",
      "    raise exception 'Los dos predios de la Planta tienen que quedar activos.';",
      '  end if;',
      'end',
      '$control$;',
    ].join('\n'),
  )

  partes.push(
    [
      '',
      '-- Cómo quedaron las listas. Esta es la tabla que devuelve el editor.',
      "select 'sitios' as lista, count(*) filter (where activo) as en_uso,",
      '       count(*) filter (where not activo) as dados_de_baja from sitios',
      "union all select 'recipientes', count(*) filter (where activo),",
      '       count(*) filter (where not activo) from unidades',
      "union all select 'corrientes', count(*) filter (where activo),",
      '       count(*) filter (where not activo) from materiales',
      "union all select 'contenedores', count(*) filter (where activo),",
      '       count(*) filter (where not activo) from contenedores',
      'order by 1;',
      '',
    ].join('\n'),
  )

  return partes.join('\n') + '\n'
}

/**
 * La base como estaba antes de leer los formularios: nueve sitios con una sola
 * Planta, catorce corrientes y sus cuarenta contenedores. Es una copia de lo que
 * había de verdad en producción el 18/09/2026, y está acá por un solo motivo: un
 * archivo que pone listas al día hay que probarlo contra las listas viejas, no
 * contra las nuevas. Contra una base recién creada no probaría nada.
 */
const BASE_VIEJA = [
  "insert into sitios (codigo, nombre, tipo, orden) values",
  "  ('PVRV', 'Planta de Valorización de Residuos Verdes', 'planta', 1),",
  "  ('PV-01', 'Punto Verde Huerta', 'punto_verde', 2),",
  "  ('PV-02', 'Punto Verde Italia', 'punto_verde', 3),",
  "  ('PV-03', 'Punto Verde Paso de los Andes', 'punto_verde', 4),",
  "  ('PV-04', 'Punto Verde Colón', 'punto_verde', 5),",
  "  ('PV-05', 'Punto Verde Garcilaso', 'punto_verde', 6),",
  "  ('PV-06', 'Punto Verde Circunvalación', 'punto_verde', 7),",
  "  ('PV-07', 'Punto Verde América', 'punto_verde', 8),",
  "  ('PV-08', 'Punto Verde Costanera', 'punto_verde', 9);",
  // Los recipientes no van acá: los siembra la migración 0015 y la 0020 les
  // agrega la bolsa, así que la estructura ya los trae.
  "insert into materiales (nombre, categoria, flujos, tipos, unidad_default_id, orden)",
  "select v.nombre, v.categoria, v.flujos::text[], array['ingreso', 'salida']::text[], u.id, v.orden",
  "  from unidades u, (values",
  "    ('Poda', 'verdes', '{planta}', 1), ('Restos de jardinería', 'verdes', '{planta}', 2),",
  "    ('Tronco y madera gruesa', 'verdes', '{planta}', 3), ('Chipeo', 'verdes', '{planta}', 4),",
  "    ('Triturado', 'verdes', '{planta}', 5), ('Compost', 'verdes', '{planta}', 6),",
  "    ('Leña', 'verdes', '{planta}', 7), ('Plástico', 'reciclables', '{punto_verde}', 8),",
  "    ('Cartón', 'reciclables', '{punto_verde}', 9), ('Vidrio y metal', 'reciclables', '{punto_verde}', 10),",
  "    ('Residuos de poda', 'verdes', '{punto_verde}', 11), ('RSU', 'especiales', '{punto_verde}', 12),",
  "    ('Retazos de tela', 'textil', '{gran_generador,punto_verde}', 13),",
  "    ('Recortes de madera', 'madera', '{gran_generador,punto_verde}', 14)",
  "  ) as v(nombre, categoria, flujos, orden)",
  " where u.codigo = 'm3';",
  "insert into contenedores (codigo, tipo, capacidad_m3, sitio_actual_id, material_id, estado)",
  "select s.codigo || ' · ' || m.nombre, 'contenedor', 6, s.id, m.id, 'en_sitio'",
  "  from sitios s cross join materiales m",
  " where s.tipo = 'punto_verde'",
  "   and m.nombre = any(array['Plástico', 'Cartón', 'Vidrio y metal', 'Residuos de poda', 'RSU']);",
].join('\n')

/** La estructura entera y su registro, sin ningún dato. */
function estructuraCompleta(): string {
  const archivos = todasLasMigraciones()
  return (
    archivos.map((a) => readFileSync(path.join(CARPETA, a), 'utf8')).join('\n') +
    '\ninsert into app.migraciones (nombre, hash) values\n' +
    archivos.map((a) => `  (${literal(a)}, ${literal(hashDe(a))})`).join(',\n') +
    '\non conflict (nombre) do nothing;\n'
  )
}

async function activos(pg: { query: Function }, tabla: string) {
  const r = (await pg.query(`select count(*)::int as n from ${tabla} where activo`)) as {
    rows: Array<{ n: number }>
  }
  return r.rows[0].n
}

async function probarDatos(texto: string): Promise<Record<string, string>> {
  const estructura = estructuraCompleta()

  // 1 · Sobre la base vieja, que es el caso que importa.
  const desdeVieja = await enMemoria(async (pg) => {
    await pg.exec(estructura)
    await pg.exec(BASE_VIEJA)
    await pg.exec(texto)

    const r: Record<string, string> = {}
    for (const [tabla, esperado] of ESPERADO_ACTIVO) {
      const enUso = await activos(pg, tabla)
      const total = await cuantos(pg, tabla)
      if (enUso !== esperado) {
        throw new Error(
          `Sobre la base vieja quedaron ${enUso} ${tabla} activos y esperaba ${esperado}.`,
        )
      }
      r[tabla] = `${enUso} en uso · ${total - enUso} dados de baja`
    }

    // Y que haya hecho lo que dice: renombrar, dar de baja y crear.
    const control = (await pg.query(`
      select (select count(*) from sitios where codigo = 'PVRV' and not activo) as planta_vieja,
             (select count(*) from sitios where codigo in ('PVRV-VIV', 'PVRV-HUE') and activo) as predios,
             (select count(*) from materiales where nombre = 'Residuos de poda' and not activo) as poda_vieja,
             (select count(*) from materiales where nombre = 'Poda y orgánico' and activo) as poda_nueva,
             (select count(*) from contenedores where codigo like '%Residuos de poda' and activo) as cont_viejos,
             (select count(*) from contenedores where codigo like '%Poda y orgánico' and activo) as cont_nuevos,
             (select nombre from sitios where codigo = 'PV-05') as garcilazo`)) as {
      rows: Array<Record<string, number | string>>
    }
    const c = control.rows[0]
    const debe: Array<[string, number | string, number | string]> = [
      ['la Planta vieja tiene que quedar inactiva', Number(c.planta_vieja), 1],
      ['los dos predios nuevos tienen que quedar activos', Number(c.predios), 2],
      ['«Residuos de poda» tiene que quedar inactiva', Number(c.poda_vieja), 1],
      ['«Poda y orgánico» tiene que quedar activa', Number(c.poda_nueva), 1],
      ['los contenedores de la corriente vieja tienen que quedar inactivos', Number(c.cont_viejos), 0],
      ['tiene que haber ocho contenedores de la corriente nueva', Number(c.cont_nuevos), 8],
      ['PV-05 tiene que quedar renombrado', c.garcilazo, 'Punto Verde Garcilazo'],
    ]
    for (const [que, fue, esperado] of debe) {
      if (fue !== esperado) {
        throw new Error(
          `${que}: quedó ${JSON.stringify(fue)} y esperaba ${JSON.stringify(esperado)}.`,
        )
      }
    }
    return r
  })

  // 2 · Dos veces seguidas tiene que dar lo mismo: se pega cuando haga falta.
  await enMemoria(async (pg) => {
    await pg.exec(estructura)
    await pg.exec(BASE_VIEJA)
    await pg.exec(texto)
    await pg.exec(texto)
    for (const [tabla, esperado] of ESPERADO_ACTIVO) {
      const n = await activos(pg, tabla)
      if (n !== esperado) {
        throw new Error(`Aplicado dos veces cambia: ${n} ${tabla} activos en vez de ${esperado}.`)
      }
    }
  })

  // 3 · Y sobre una base recién creada, tampoco tiene que romper nada.
  await enMemoria(async (pg) => {
    await pg.exec(construirCompleto())
    await pg.exec(texto)
    for (const [tabla, esperado] of ESPERADO_ACTIVO) {
      const n = await activos(pg, tabla)
      if (n !== esperado) {
        throw new Error(`Sobre una base nueva rompe: ${n} ${tabla} activos en vez de ${esperado}.`)
      }
    }
  })

  // 4 · Sobre una base sin estructura, el guardián tiene que frenar.
  let freno = false
  try {
    await enMemoria((pg) => pg.exec(texto))
  } catch (e) {
    freno = /no tiene ninguna migración|does not exist/.test((e as Error).message)
    if (!freno) throw e
  }
  if (!freno) throw new Error('El guardián no frenó sobre una base sin estructura. No escribo el archivo.')

  return desdeVieja
}

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

async function exportar() {
  const desde = argumento('--desde')

  if (process.argv.includes('--datos')) {
    const texto = construirDatos()
    const salida = path.join(process.cwd(), 'db', 'datos.sql')
    const kb = Math.round(Buffer.byteLength(texto, 'utf8') / 1024)
    console.log(`\n  Armando las listas maestras (${kb} KB).`)
    console.log('  Probándolas contra la base vieja, en memoria…')
    const filas = await probarDatos(texto)
    writeFileSync(salida, texto, 'utf8')

    console.log('\n  Va a quedar:')
    for (const [tabla, resumen] of Object.entries(filas)) {
      console.log(`    ${tabla.padEnd(14)} ${resumen}`)
    }
    console.log(`
  Escrito en db/datos.sql (${kb} KB).
  Supabase → SQL Editor → New query → pegar el archivo entero → Run.
`)
    return
  }

  if (desde) {
    const { texto, nuevas } = construirIncremental(desde)
    const salida = path.join(process.cwd(), 'db', 'actualizacion.sql')
    const kb = Math.round(Buffer.byteLength(texto, 'utf8') / 1024)
    console.log(`\n  Armando la actualización: ${nuevas.join(', ')} (${kb} KB).`)
    console.log('  Probándola contra un Postgres en memoria…')
    const total = await probarIncremental(desde, texto)
    writeFileSync(salida, texto, 'utf8')
    console.log(`
  Quedan ${total} migraciones registradas.

  Escrito en db/actualizacion.sql (${kb} KB).
  Supabase → SQL Editor → New query → pegar el archivo entero → Run.
`)
    return
  }

  const texto = construirCompleto()
  const salida = path.join(process.cwd(), 'db', 'produccion.sql')
  const kb = Math.round(Buffer.byteLength(texto, 'utf8') / 1024)
  console.log(`\n  Armando el SQL: ${todasLasMigraciones().length} migraciones, ${kb} KB.`)
  console.log('  Probándolo contra un Postgres en memoria…')

  const filas = await probarCompleto(texto)
  writeFileSync(salida, texto, 'utf8')

  console.log('\n  Quedó:')
  for (const [tabla, n] of Object.entries(filas)) {
    console.log(`    ${tabla.padEnd(18)} ${String(n).padStart(4)}`)
  }
  console.log(`
  Escrito en db/produccion.sql (${kb} KB).

  Supabase → SQL Editor → New query → pegar el archivo entero → Run.
  Al final devuelve una tabla con lo que quedó cargado.
`)
}

const esEntrada = process.argv[1]?.replace(/\\/g, '/').endsWith('db/cli/exportar-sql.ts')
if (esEntrada) {
  exportar()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`\n  ${(e as Error).message}\n`)
      process.exit(1)
    })
}

export { exportar }
