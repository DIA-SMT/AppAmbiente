/**
 * Escribe un único archivo .sql con todo lo que necesita una base nueva, para
 * pegarlo en el editor SQL del proveedor.
 *
 *     npm run db:sql
 *
 * Está para cuando no se puede conectar el CLI contra la base remota —la
 * conexión directa de Supabase es sólo IPv6 y muchos proveedores de internet
 * todavía no lo dan—. El archivo trae, en este orden:
 *
 *   1. un guardián que aborta si la base ya tiene migraciones aplicadas;
 *   2. las 18 migraciones, en orden, tal cual están en db/migrations/;
 *   3. las filas de app.migraciones, para que un `npm run db:migrar` posterior
 *      no intente re-aplicar nada;
 *   4. los datos base, desde db/datos-base.ts;
 *   5. una comprobación final que falla si algo no quedó como corresponde.
 *
 * Antes de escribirlo lo ejecuta entero contra un PGlite en memoria y verifica
 * el resultado. Si el archivo no sirve, este comando falla y no lo escribe.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { sentenciasBase } from '../datos-base'

const CARPETA = path.join(process.cwd(), 'db', 'migrations')
const SALIDA = path.join(process.cwd(), 'db', 'produccion.sql')

/** Lo que tiene que haber quedado. Si no, el archivo no se escribe. */
const ESPERADO: ReadonlyArray<readonly [string, number]> = [
  ['sitios', 9],
  ['unidades', 8],
  ['materiales', 14],
  ['contenedores', 40],
  ['perfiles', 11],
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
  [
    '',
    `-- ${'═'.repeat(71)}`,
    `-- ${titulo}`,
    `-- ${'═'.repeat(71)}`,
    '',
  ].join('\n')

export function construirSql(): { texto: string; migraciones: string[] } {
  const archivos = readdirSync(CARPETA).filter((f) => f.endsWith('.sql')).sort()
  if (!archivos.length) throw new Error('No hay migraciones en db/migrations')

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
        "para actualizar una base que ya está en uso, correr las migraciones que falten con npm run db:migrar.';",
      '  end if;',
      'end',
      '$guardian$;',
    ].join('\n'),
  )

  const migraciones: Array<{ nombre: string; hash: string }> = []
  for (const archivo of archivos) {
    // El mismo hash que calcula db/migraciones.ts, sobre el archivo tal cual.
    const sql = readFileSync(path.join(CARPETA, archivo), 'utf8')
    migraciones.push({ nombre: archivo, hash: createHash('sha256').update(sql).digest('hex').slice(0, 16) })
    partes.push(marco(`${archivo}`))
    partes.push(sql.trimEnd())
  }

  // Sin estas filas, un `npm run db:migrar` posterior vería las 18 como
  // pendientes y las volvería a aplicar sobre tablas que ya existen.
  partes.push(marco(`${archivos.length + 1} · Registro de migraciones aplicadas`))
  partes.push(
    'insert into app.migraciones (nombre, hash) values\n' +
      migraciones.map((m) => `  (${literal(m.nombre)}, ${literal(m.hash)})`).join(',\n') +
      '\non conflict (nombre) do nothing;',
  )

  partes.push(marco(`${archivos.length + 2} · Datos base`))
  for (const { sql, params } of sentenciasBase()) {
    partes.push(`${inyectar(sql, params).trim()};`)
  }

  // Si algo salió distinto, mejor que reviente ahora: el editor de Supabase
  // corre todo el script en una transacción, así que una excepción acá deja la
  // base como estaba en vez de dejarla a medio armar.
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

  return { texto: partes.join('\n') + '\n', migraciones: archivos }
}

/**
 * Corre el archivo entero contra un Postgres en memoria y comprueba el
 * resultado. Es la única forma de estar seguro de que lo que se entrega anda:
 * el archivo se arma con concatenación, y la concatenación no avisa cuando se
 * rompe algo.
 */
async function probar(texto: string): Promise<Record<string, number>> {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  try {
    await pg.exec(texto)
    const filas: Record<string, number> = {}
    for (const [tabla] of ESPERADO) {
      const r = (await pg.query(`select count(*)::int as n from ${tabla}`)) as { rows: Array<{ n: number }> }
      filas[tabla] = r.rows[0].n
    }
    const r = (await pg.query('select count(*)::int as n from app.migraciones')) as {
      rows: Array<{ n: number }>
    }
    filas['app.migraciones'] = r.rows[0].n
    return filas
  } finally {
    await pg.close()
  }
}

async function exportar() {
  const { texto, migraciones } = construirSql()
  const kb = Math.round(Buffer.byteLength(texto, 'utf8') / 1024)

  console.log(`\n  Armando el SQL: ${migraciones.length} migraciones, ${kb} KB.`)
  console.log('  Probándolo contra un Postgres en memoria…')

  const filas = await probar(texto)

  // Que el guardián haga su trabajo: correrlo dos veces tiene que fallar.
  let guardianAnduvo = false
  try {
    await probar(texto + '\n' + texto)
  } catch (e) {
    guardianAnduvo = /ya tiene migraciones aplicadas/.test((e as Error).message)
    if (!guardianAnduvo) throw e
  }
  if (!guardianAnduvo) {
    throw new Error('El guardián no frenó una segunda aplicación. No escribo el archivo.')
  }

  writeFileSync(SALIDA, texto, 'utf8')

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
