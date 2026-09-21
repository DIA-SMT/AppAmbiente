/**
 * Los datos base, y las sentencias que los cargan.
 *
 * Están acá y no adentro del sembrador porque hay dos formas de aplicarlos:
 * db/cli/sembrar.ts los ejecuta con parámetros contra la base, y
 * db/cli/exportar-sql.ts los escribe como SQL literal para pegar en el editor
 * de un proveedor. Una sola fuente, así las dos no se separan con el tiempo.
 *
 * "Base" es lo que salió del relevamiento y no depende de nadie: los diez
 * sitios, los recipientes con su capacidad declarada, las veintiuna corrientes,
 * los contenedores de los puntos verdes y los usuarios para entrar. Todo lo
 * demás —choferes, patentes, destinos habilitados, pilas— es inventado y vive
 * en el sembrador, detrás de --ejemplos.
 *
 * DE DÓNDE SALEN LOS DATOS. Hasta ahora buena parte era supuesto nuestro. Se
 * leyeron campo por campo los seis formularios de Google con los que la
 * Secretaría viene trabajando, y las listas de acá son las de esos formularios,
 * no las que habíamos imaginado. Cada vez que un dato sale de un formulario se
 * dice de cuál:
 *
 *   R-05-01  Ingreso de materiales en PVRV
 *   R-05-02  Control de proceso de pilas
 *   R-05-06  Entrega de chips, compost y leña
 *   R-05-07  Recepción de residuos en Punto Verde
 *   R-05-08  Entrega de materiales para reutilizar en Punto Verde
 */
import { hashearCredencial } from './credenciales'

/** Una sentencia con sus parámetros, sin ejecutar. */
export interface Sentencia {
  sql: string
  params: unknown[]
}

/**
 * Los diez sitios: dos predios de la Planta y ocho puntos verdes.
 * codigo, nombre, tipo, dirección, orden
 *
 * LA PLANTA SON DOS. La primera pregunta del formulario R-05-01 es en cuál de
 * los dos predios se recibió el material —Vivero o Huerta—, así que no es un
 * dato de color: el material entra a uno o al otro y lo que hay en cada uno se
 * cuenta por separado. Por eso son dos sitios y no uno con un campo adentro.
 *
 * CUIDADO CON "HUERTA". El nombre aparece dos veces y son dos cosas distintas:
 * PVRV-HUE es el predio de la Planta donde se procesa, y PV-01 es el Punto
 * Verde que funciona en el mismo lugar y donde el vecino deja sus reciclables.
 * Se llaman distinto a propósito —"Planta de Valorización — Huerta" contra
 * "Punto Verde Huerta"—: si en una lista aparecieran los dos como "Huerta",
 * nadie sabría cuál eligió.
 *
 * El código manda: los contenedores se nombran con él ("PV-02 · Cartón"), los
 * usuarios de cada punto se arman a partir de él y los CLI lo usan para buscar
 * un sitio. Cambiarlo no es cosmético.
 */
export const SITIOS = [
  ['PVRV-VIV', 'Planta de Valorización — Vivero', 'planta',      'Vivero Municipal',                1],
  ['PVRV-HUE', 'Planta de Valorización — Huerta', 'planta',      'Huerta Municipal',                2],
  ['PV-01',    'Punto Verde Huerta',              'punto_verde', 'Huerta Municipal — Lamadrid 3900', 3],
  ['PV-02',    'Punto Verde Italia',              'punto_verde', 'Italia y Viamonte — Italia 2800',  4],
  ['PV-03',    'Punto Verde Paso de los Andes',   'punto_verde', 'San Martín y Paso de los Andes',   5],
  ['PV-04',    'Punto Verde Colón',               'punto_verde', 'Colón y Canal Sur',                6],
  ['PV-05',    'Punto Verde Garcilazo',           'punto_verde', 'Inca Garcilazo',                   7],
  ['PV-06',    'Punto Verde Circunvalación',      'punto_verde', 'Circunvalación',                   8],
  ['PV-07',    'Punto Verde América',             'punto_verde', 'América y Fco. de Aguirre',        9],
  ['PV-08',    'Punto Verde Costanera',           'punto_verde', 'Costanera Norte',                 10],
] as const

// Relevado con la Secretaría: no hay balanza y todo se estima en m³. Estos son
// los recipientes con los que se estima, con su capacidad declarada.
// codigo, nombre, plural, decimales, factor_m3, orden
//
// LA BOLSA VUELVE. La migración 0015 la había desactivado junto con 'tn' y
// 'unidad' por considerarla un supuesto nuestro, pero el formulario R-05-06
// —entrega de chips, compost y leña— pregunta literalmente "Cantidad en bolsas
// o m3": la bolsa es la forma real en que se entrega el compost y la leña al
// vecino, y sin ella ese formulario no se puede cargar.
//
// SIN FACTOR A M³, a propósito. Una bolsa de compost no tiene volumen fijo: no
// es un recipiente rígido como el tambor o la batea, y lo que entra depende de
// cuánto se cargue. Poner un factor inventado ensuciaría todos los m³ del
// tablero con una conversión que nadie midió. Con factor_m3 nulo la cantidad se
// guarda y se informa en bolsas —"12 bolsas"— y no se suma a los m³, que es
// exactamente lo que hace 'kg' desde la fase 1.
export const UNIDADES = [
  ['m3',          'm³',              'm³',                1, 1,    1],
  ['tambor_200',  'tambor de 200 L', 'tambores de 200 L', 0, 0.2,  2],
  ['carro_delfi', 'carro de delfi',  'carros de delfi',   0, 4,    3],
  ['camion',      'camión',          'camiones',          0, 6,    4],
  ['contenedor',  'contenedor',      'contenedores',      0, 6,    5],
  ['batea',       'batea',           'bateas',            0, 20,   6],
  ['batea_larga', 'batea alargada',  'bateas alargadas',  0, 30,   7],
  ['kg',          'kg',              'kg',                2, null, 8],
  ['bolsa',       'bolsa',           'bolsas',            0, null, 9],
] as const

/**
 * Las corrientes que se registran de verdad, tal como las nombran los
 * formularios. Antes había catorce y varias eran invento nuestro.
 * nombre, categoría, flujos, tipos, unidad por defecto, sugerencias, color, orden
 *
 * LA PLANTA (R-05-01 lo que entra, R-05-06 lo que sale). Entra material verde
 * separado por grosor —fina, media, gruesa—, más lo que llega mezclado o de
 * origen puntual: corteza, naranja, algas, descarte de verdura. Sale producto
 * terminado: compost, leña social, troncos, rodajas, triturado. El chipeo es el
 * único que hace las dos cosas: entra chipeado de la calle y sale chipeado de
 * la Planta.
 *
 * EL PUNTO VERDE (R-05-07 lo que recibe, R-05-08 lo que entrega). Las cinco
 * corrientes de la pizarra más neumáticos, que el formulario recibe y que
 * nosotros no teníamos.
 *
 * RSU ES UNA BOLSA GRANDE. En el punto verde "RSU" incluye objetos, muebles,
 * madera, electrodomésticos, retazos, pallets, bines y tierra filtrante: el
 * formulario los agrupa ahí y no los pregunta por separado. Por eso
 * desaparecen "Retazos de tela" y "Recortes de madera", que eran una lista
 * nuestra y nunca existieron como corrientes propias.
 *
 * LOS COLORES siguen el criterio que ya había: lo que entra verde a la Planta
 * en gama verde —más claro cuanto más fino—, el producto terminado en la gama
 * fría o marrón con que se lo reconoce, y cada corriente de punto verde con su
 * color de siempre (plástico azul, cartón amarillo, vidrio y metal gris). RSU
 * se oscurece para que no se confunda con vidrio y metal en el mismo gráfico, y
 * neumáticos va casi negro, que es el color de la goma.
 */
export const MATERIALES: ReadonlyArray<
  readonly [string, string, string[], string[], string, number[], string, number]
> = [
  // ── Planta: lo que entra (R-05-01) ────────────────────────────────────
  ['Jardinería (pasto y hojas)', 'verdes',      ['planta'],      ['ingreso'],           'm3', [4.5, 6, 10, 20], '#84cc16', 1],
  ['Poda fina',                  'verdes',      ['planta'],      ['ingreso'],           'm3', [4.5, 6, 10, 20], '#4ade80', 2],
  ['Poda media',                 'verdes',      ['planta'],      ['ingreso'],           'm3', [4.5, 6, 10, 20], '#25d366', 3],
  ['Poda gruesa',                'verdes',      ['planta'],      ['ingreso'],           'm3', [4.5, 6, 10, 20], '#1aa851', 4],
  ['Chipeo',                     'verdes',      ['planta'],      ['ingreso', 'salida'], 'm3', [4.5, 6, 10, 20], '#3cb4f0', 5],
  ['Corteza',                    'verdes',      ['planta'],      ['ingreso'],           'm3', [4.5, 6, 10, 20], '#8f6b3f', 6],
  ['Naranja',                    'verdes',      ['planta'],      ['ingreso'],           'm3', [4.5, 6, 10, 20], '#f97316', 7],
  ['Poda y chipeo',              'verdes',      ['planta'],      ['ingreso'],           'm3', [4.5, 6, 10, 20], '#10b981', 8],
  ['Algas',                      'verdes',      ['planta'],      ['ingreso'],           'm3', [4.5, 6, 10, 20], '#0d9488', 9],
  ['Descarte de verdura',        'verdes',      ['planta'],      ['ingreso'],           'm3', [4.5, 6, 10, 20], '#65a30d', 10],
  // ── Planta: lo que sale (R-05-06) ─────────────────────────────────────
  ['Compost',                    'verdes',      ['planta'],      ['salida'],            'm3', [4.5, 6, 10, 20], '#126ff5', 11],
  ['Leña social',                'verdes',      ['planta'],      ['salida'],            'm3', [4.5, 6, 10, 20], '#a16207', 12],
  ['Troncos',                    'verdes',      ['planta'],      ['salida'],            'm3', [4.5, 6, 10, 20], '#854d0e', 13],
  ['Rodajas',                    'verdes',      ['planta'],      ['salida'],            'm3', [4.5, 6, 10, 20], '#b45309', 14],
  ['Triturado',                  'verdes',      ['planta'],      ['salida'],            'm3', [4.5, 6, 10, 20], '#2589ea', 15],
  // ── Punto verde: entra y sale (R-05-07 y R-05-08) ─────────────────────
  ['Plástico',                   'reciclables', ['punto_verde'], ['ingreso', 'salida'], 'm3', [0.2, 6],         '#28469f', 16],
  ['Cartón',                     'reciclables', ['punto_verde'], ['ingreso', 'salida'], 'm3', [0.2, 6],         '#f5b81c', 17],
  ['Vidrio y metal',             'reciclables', ['punto_verde'], ['ingreso', 'salida'], 'm3', [0.2, 6],         '#6b7885', 18],
  ['Poda y orgánico',            'verdes',      ['punto_verde'], ['ingreso', 'salida'], 'm3', [0.2, 6],         '#25d366', 19],
  ['RSU',                        'especiales',  ['punto_verde'], ['ingreso', 'salida'], 'm3', [6],              '#4b5563', 20],
  ['Neumáticos',                 'especiales',  ['punto_verde'], ['ingreso', 'salida'], 'm3', [6],              '#1f2937', 21],
]

/**
 * Qué recipientes se pueden usar para cada material.
 *
 * Todo se estima en m³, así que el vigilador elige el recipiente y cuántos. En
 * los puntos verdes también se usan kilos: el retiro para reutilización se
 * estima por peso, que es lo que después alimenta el registro del programa
 * CIRCULA, y el Excel de la 9 de Julio llega en kilos.
 *
 * `gran_generador` no lo usa hoy ningún material —las dos corrientes que lo
 * tenían eran invento nuestro y se fueron—, pero el flujo existe en el modelo y
 * en el panel, así que la lista queda esperando la primera corriente real.
 */
export const RECIPIENTES_POR_FLUJO: Record<string, string[]> = {
  planta:          ['m3', 'tambor_200', 'carro_delfi', 'camion', 'contenedor', 'batea', 'batea_larga'],
  punto_verde:     ['m3', 'tambor_200', 'contenedor', 'camion', 'kg'],
  gran_generador:  ['kg', 'm3', 'camion'],
}

/**
 * Recipientes que habilita un material puntual, además de los de su flujo.
 *
 * La bolsa no es de toda la Planta: el formulario R-05-06 pregunta "Cantidad en
 * bolsas o m3" sólo para lo que se entrega al vecino —chips, compost y leña—.
 * Ofrecerla también para un ingreso de poda sería ofrecer algo que nadie usa.
 */
const RECIPIENTES_EXTRA: Record<string, string[]> = {
  Chipeo: ['bolsa'],
  Compost: ['bolsa'],
  'Leña social': ['bolsa'],
}

/**
 * Las cinco corrientes de la pizarra de seguimiento, que son las que tienen
 * contenedor.
 *
 * NEUMÁTICOS NO ENTRA ACÁ, y es una decisión. Un contenedor no es una corriente
 * que el punto recibe: es un recipiente físico que está parado en el punto y
 * que la 9 de Julio viene a recambiar. Que el formulario R-05-07 reciba
 * neumáticos no significa que los ocho puntos tengan un contenedor de
 * neumáticos, y la Secretaría todavía no nos pasó la grilla de qué contenedor
 * hay en cada punto. Sembrar ocho contenedores de neumáticos sería inventar
 * ocho recipientes que capaz no existen, y después el tablero informaría
 * recambios pendientes de algo que no está. La corriente queda disponible para
 * registrar el ingreso y la salida —que es lo que el formulario hace—, y el
 * contenedor lo da de alta la coordinadora desde el panel cuando sepamos dónde
 * hay uno. Al revés no se puede: un contenedor de más no se borra.
 */
const CORRIENTES_CON_CONTENEDOR = ['Plástico', 'Cartón', 'Vidrio y metal', 'Poda y orgánico', 'RSU']

/**
 * El único usuario con el que se entra la primera vez.
 * usuario, nombre, rol, código de sitio, credencial, horas de sesión
 *
 * Uno solo, y a propósito. Una base nueva se entrega con una sola puerta: la
 * Dirección de IA entra, crea la cuenta de coordinación y los usuarios de cada
 * punto desde la pantalla Usuarios, y desde ahí la Secretaría se maneja sola.
 * Sembrar diez cuentas con el PIN 1234 era cómodo para desarrollar y una puerta
 * abierta en producción: nadie se acuerda de desactivar las que no usa.
 *
 * CREDENCIAL DE FÁBRICA, publicada en el repositorio, y por eso dura un solo
 * ingreso. El insert de más abajo no toca `credencial_cambiada_en`, así que
 * queda en null, y con ella en null el panel no deja ir a ninguna pantalla que
 * no sea /cuenta hasta elegir una contraseña propia. O sea que la clave de
 * fábrica alcanza para abrir la puerta la primera vez y nada más. Contra un
 * Postgres de verdad `npm run db:verificar` falla igual mientras siga puesta.
 *
 * SIN CORREO, a propósito, aunque desde la 0023 la coordinación entra con su
 * correo institucional. La cuenta sembrada entra con su nombre de usuario —el
 * correo es nullable justamente para esto— y lo primero que ve es /cuenta,
 * donde carga su correo y elige su contraseña. Es la única forma de que el
 * primer ingreso a una base nueva no dependa de un correo que acá tendríamos
 * que inventar: un correo de fábrica no es de nadie y nadie lo cambia.
 *
 * No hay un rol por encima de `admin`: el modelo tiene dos roles —admin y
 * vigilador— y admin ya puede todo.
 */
export const USUARIOS: ReadonlyArray<
  readonly [string, string, 'admin' | 'vigilador', string | null, string, number | null]
> = [
  ['direccionia', 'Dirección de Inteligencia Artificial', 'admin', null, '123456', 12],
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

  // La 0015 desactivó la bolsa cuando la creíamos un supuesto nuestro, y el
  // insert de arriba no la revive: es `do nothing`, a propósito, para no pisar
  // lo que la coordinadora haya cambiado desde el panel. Así que se reactiva
  // explícitamente, igual que se fija el conteo diario de PV-03 unas líneas más
  // arriba. Va antes de los materiales porque unidades_permitidas sólo toma las
  // unidades activas: si la bolsa todavía estuviera apagada, el compost se
  // cargaría sin poder elegirla.
  s.push({
    sql: `update unidades set activo = true where codigo = 'bolsa'`,
    params: [],
  })

  for (const [nombre, categoria, flujos, tipos, unidad, sugerencias, color, orden] of MATERIALES) {
    // La unión de los recipientes de cada flujo donde aparece el material, más
    // los que ese material habilita por su cuenta (la bolsa de R-05-06).
    const codigos = [
      ...new Set([
        ...flujos.flatMap((f) => RECIPIENTES_POR_FLUJO[f] ?? ['m3']),
        ...(RECIPIENTES_EXTRA[nombre] ?? []),
      ]),
    ]
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
  // de cartón de Italia". Sólo en los puntos verdes: los dos predios de la
  // Planta no tienen contenedores de corriente, ahí el material se acopia en
  // pilas y parvas.
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

/**
 * Pone al día una base que ya existe.
 *
 * `sentenciasBase()` sirve para una base nueva: inserta lo que falta y no toca
 * lo que está. Eso es lo correcto la primera vez y no alcanza después. Cuando
 * las listas de este archivo cambian —y cambiaron entero al leer los
 * formularios de la Secretaría— una base ya creada queda con los nombres
 * viejos, los sitios viejos y las corrientes que ya nadie usa, y sembrar de
 * nuevo no arregla nada porque no actualiza.
 *
 * Esto sí actualiza, y da de baja lo que dejó de estar en las listas. No borra:
 * en este sistema nada se borra, así que lo que sale de la lista queda inactivo
 * —deja de ofrecerse en el celular— y los movimientos que lo usaron se siguen
 * viendo igual.
 *
 * LO QUE NO TOCA: los usuarios. Una credencial cambiada desde la pantalla no se
 * pisa nunca desde acá.
 */
export function sentenciasPonerAlDia(): Sentencia[] {
  const s: Sentencia[] = []

  // ── Sitios ────────────────────────────────────────────────────────────
  for (const [codigo, nombre, tipo, direccion, orden] of SITIOS) {
    s.push({
      sql: `insert into sitios (codigo, nombre, tipo, direccion, orden)
            values ($1, $2, $3, $4, $5)
            on conflict (codigo) do update
              set nombre = excluded.nombre, tipo = excluded.tipo,
                  direccion = excluded.direccion, orden = excluded.orden,
                  activo = true`,
      params: [codigo, nombre, tipo, direccion, orden],
    })
  }
  s.push({
    sql: `update sitios set activo = false
           where codigo <> all ($1::text[]) and activo`,
    params: [SITIOS.map((x) => x[0])],
  })

  // ── Recipientes ───────────────────────────────────────────────────────
  for (const [codigo, nombre, plural, decimales, factor, orden] of UNIDADES) {
    s.push({
      sql: `insert into unidades (codigo, nombre, nombre_plural, decimales, factor_m3, orden)
            values ($1, $2, $3, $4, $5, $6)
            on conflict (codigo) do update
              set nombre = excluded.nombre, nombre_plural = excluded.nombre_plural,
                  decimales = excluded.decimales, factor_m3 = excluded.factor_m3,
                  orden = excluded.orden, activo = true`,
      params: [codigo, nombre, plural, decimales, factor, orden],
    })
  }
  s.push({
    sql: `update unidades set activo = false where codigo <> all ($1::text[]) and activo`,
    params: [UNIDADES.map((x) => x[0])],
  })

  // ── Corrientes ────────────────────────────────────────────────────────
  // El nombre es la llave acá: no hay código. Una corriente que cambia de
  // nombre se carga como nueva y la vieja queda inactiva, que es lo honesto —
  // no sabemos si «Residuos de poda» y «Poda y orgánico» son lo mismo, eso lo
  // dice la Secretaría.
  for (const [nombre, categoria, flujos, tipos, unidad, sugerencias, color, orden] of MATERIALES) {
    const codigos = [
      ...new Set([
        ...flujos.flatMap((f) => RECIPIENTES_POR_FLUJO[f] ?? ['m3']),
        ...(RECIPIENTES_EXTRA[nombre] ?? []),
      ]),
    ]
    s.push({
      sql: `insert into materiales
              (nombre, categoria, flujos, tipos, unidad_default_id, unidades_permitidas, sugerencias, color, orden)
            select $1, $2, $3::text[], $4::text[], u.id,
                   (select coalesce(array_agg(x.id order by x.orden), array[u.id])
                      from unidades x where x.codigo = any($5::text[]) and x.activo),
                   $6::numeric[], $7, $8
              from unidades u where u.codigo = $9
            on conflict (lower(nombre)) do update
              set categoria = excluded.categoria, flujos = excluded.flujos,
                  tipos = excluded.tipos, unidad_default_id = excluded.unidad_default_id,
                  unidades_permitidas = excluded.unidades_permitidas,
                  sugerencias = excluded.sugerencias, color = excluded.color,
                  orden = excluded.orden, activo = true`,
      params: [nombre, categoria, flujos, tipos, codigos, sugerencias, color, orden, unidad],
    })
  }
  s.push({
    sql: `update materiales set activo = false
           where activo
             and lower(nombre) <> all (array(select lower(x) from unnest($1::text[]) as x))`,
    params: [MATERIALES.map((x) => x[0])],
  })

  // ── Contenedores ──────────────────────────────────────────────────────
  // Los que quedaron apuntando a una corriente dada de baja dejan de ofrecerse.
  s.push({
    sql: `update contenedores set activo = false
           where activo and material_id in (select id from materiales where not activo)`,
    params: [],
  })
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

  // Y PV-03 sigue siendo el único que sólo informa el conteo del día.
  s.push({
    sql: `update sitios set carga_detallada = (codigo <> 'PV-03') where tipo = 'punto_verde'`,
    params: [],
  })

  return s
}
