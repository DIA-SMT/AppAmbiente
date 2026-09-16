/**
 * Los datos base, y las sentencias que los cargan.
 *
 * Están acá y no adentro del sembrador porque hay dos formas de aplicarlos:
 * db/cli/sembrar.ts los ejecuta con parámetros contra la base, y
 * db/cli/exportar-sql.ts los escribe como SQL literal para pegar en el editor
 * de un proveedor. Una sola fuente, así las dos no se separan con el tiempo.
 *
 * "Base" es lo que salió del relevamiento y no depende de nadie: los nueve
 * sitios, los recipientes con su capacidad declarada, las catorce corrientes,
 * los contenedores de los puntos verdes y los usuarios para entrar. Todo lo
 * demás —choferes, patentes, destinos habilitados, pilas— es inventado y vive
 * en el sembrador, detrás de --ejemplos.
 */
import { hashearCredencial } from './credenciales'

/** Una sentencia con sus parámetros, sin ejecutar. */
export interface Sentencia {
  sql: string
  params: unknown[]
}

export const SITIOS = [
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
export const UNIDADES = [
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
export const MATERIALES: ReadonlyArray<
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
export const RECIPIENTES_POR_FLUJO: Record<string, string[]> = {
  planta:          ['m3', 'tambor_200', 'carro_delfi', 'camion', 'contenedor', 'batea', 'batea_larga'],
  punto_verde:     ['m3', 'tambor_200', 'contenedor', 'camion', 'kg'],
  gran_generador:  ['kg', 'm3', 'camion'],
}

/**
 * Las cinco corrientes de la pizarra de seguimiento, que son las que tienen
 * contenedor. Los retazos de tela y los recortes de madera pasan por los puntos
 * pero vienen de grandes generadores y se retiran de otra forma.
 */
const CORRIENTES_CON_CONTENEDOR = ['Plástico', 'Cartón', 'Vidrio y metal', 'Residuos de poda', 'RSU']

/**
 * Los usuarios con los que se entra la primera vez.
 * usuario, nombre, rol, código de sitio, credencial, horas de sesión
 *
 * CREDENCIALES DE FÁBRICA, publicadas en el repositorio: se cambian desde la
 * pantalla Usuarios antes de darle el link a nadie. Contra un Postgres de verdad,
 * `npm run db:verificar` falla mientras alguna siga puesta.
 *
 * No hay un rol por encima de `admin`: el modelo tiene dos roles y admin ya puede
 * todo. El acceso de la Dirección de IA es un admin más, para entrar sin usar la
 * cuenta de la coordinación y que la auditoría distinga quién hizo qué.
 */
export const USUARIOS: ReadonlyArray<
  readonly [string, string, 'admin' | 'vigilador', string | null, string, number | null]
> = [
  ['direccionia',  'Dirección de Inteligencia Artificial', 'admin', null, '123456', 12],
  ['coordinacion', 'Coordinación de Ambiente',             'admin', null, 'ambiente2026', 12],
  ['planta',       'Planta de Valorización — turno',       'vigilador', 'PVRV', '1234', null],
  ...SITIOS.slice(1).map(
    (s) =>
      [
        s[0].toLowerCase().replace('-', ''),
        `${s[1]} — turno`,
        'vigilador',
        s[0],
        '1234',
        null,
      ] as readonly [string, string, 'vigilador', string, string, null],
  ),
]

/**
 * Las sentencias que dejan la base lista para usar, en orden: los materiales
 * necesitan las unidades, los contenedores necesitan sitios y materiales, y los
 * perfiles necesitan los sitios.
 *
 * Cada llamada genera hashes nuevos —scrypt sala al azar—, así que dos llamadas
 * no devuelven el mismo SQL. Es lo esperado.
 */
export function sentenciasBase(): Sentencia[] {
  const s: Sentencia[] = []

  for (const [codigo, nombre, tipo, direccion, orden] of SITIOS) {
    s.push({
      sql: `insert into sitios (codigo, nombre, tipo, direccion, orden)
            values ($1, $2, $3, $4, $5) on conflict (codigo) do nothing`,
      params: [codigo, nombre, tipo, direccion, orden],
    })
  }

  // Paso de los Andes no carga desde el celular: el personal es de otra
  // Secretaría. La migración 0017 también lo marca, pero ahí el sitio todavía no
  // existe —una migración que actualiza datos corre sobre una tabla vacía en una
  // base nueva—, así que el valor real se fija acá.
  s.push({
    sql: `update sitios set carga_detallada = false where codigo = 'PV-03'`,
    params: [],
  })

  for (const [codigo, nombre, plural, decimales, factor, orden] of UNIDADES) {
    s.push({
      sql: `insert into unidades (codigo, nombre, nombre_plural, decimales, factor_m3, orden)
            values ($1, $2, $3, $4, $5, $6) on conflict (codigo) do nothing`,
      params: [codigo, nombre, plural, decimales, factor, orden],
    })
  }

  for (const [nombre, categoria, flujos, tipos, unidad, sugerencias, color, orden] of MATERIALES) {
    // La unión de los recipientes de cada flujo donde aparece el material.
    const codigos = [...new Set(flujos.flatMap((f) => RECIPIENTES_POR_FLUJO[f] ?? ['m3']))]
    s.push({
      sql: `insert into materiales
              (nombre, categoria, flujos, tipos, unidad_default_id, unidades_permitidas, sugerencias, color, orden)
            select $1, $2, $3::text[], $4::text[], u.id,
                   (select coalesce(array_agg(x.id order by x.orden), array[u.id])
                      from unidades x where x.codigo = any($5::text[]) and x.activo),
                   $6::numeric[], $7, $8
              from unidades u where u.codigo = $9
            on conflict do nothing`,
      params: [nombre, categoria, flujos, tipos, codigos, sugerencias, color, orden, unidad],
    })
  }

  // Un contenedor no tiene numeración física: es el par punto + corriente, "el
  // de cartón de Italia".
  s.push({
    sql: `insert into contenedores (codigo, tipo, capacidad_m3, sitio_actual_id, material_id, estado)
          select s.codigo || ' · ' || m.nombre, 'contenedor', 6, s.id, m.id, 'en_sitio'
            from sitios s
            cross join materiales m
           where s.tipo = 'punto_verde' and s.activo and m.activo
             and m.nombre = any($1::text[])
          on conflict (codigo) do nothing`,
    params: [CORRIENTES_CON_CONTENEDOR],
  })

  for (const [usuario, nombre, rol, sitioCodigo, credencial, horas] of USUARIOS) {
    s.push({
      sql: `insert into perfiles (usuario, nombre, rol, sitio_id, credencial_hash, sesion_horas)
            select $1, $2, $3,
                   case when $4::text is null then null else (select id from sitios where codigo = $4) end,
                   $5, $6
            where not exists (select 1 from perfiles where lower(usuario) = lower($1))`,
      params: [usuario, nombre, rol, sitioCodigo, hashearCredencial(credencial), horas],
    })
  }

  return s
}
