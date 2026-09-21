'use server'

/**
 * Importación del Excel de pesos que manda la planta externa de la 9 de Julio.
 *
 * Lo que entra por acá NO son movimientos. El movimiento lo carga el vigilador
 * en el punto verde; esto es la contramedición contra la que se cruza, y por
 * eso termina entero en pesos_externos y no toca la tabla de movimientos.
 *
 * El archivo viaja completo en cada paso del asistente. Es chico —unos 40 KB—
 * y a cambio no queda estado del servidor entre pasos ni archivos temporales
 * que después haya que limpiar: cada llamada se basta a sí misma y se puede
 * reintentar sin arrastrar nada de la anterior.
 *
 * Acá tampoco se borra. Revertir una importación es ponerle estado
 * 'revertida': las filas de pesos_externos quedan donde están y las consultas
 * del cruce filtran por estado = 'confirmada'. El DELETE está revocado en la
 * base desde la 0019, así que ni escribiéndolo por error pasaría otra cosa.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { Conexion } from '@db/client'
import { conSesion, consultarConSesion } from '@db/sesion'
import { mensajeDeError } from '@/lib/datos'
import { fechaDeCalendario } from '@/lib/formato'
import { analizar, huella, leerHoja, resumirPorSitio } from '@/lib/importacion'
import type {
  Analisis, Catalogo, FilaMapeada, Mapeo, Rechazo, ResumenDeSitio, SinResolver, Vistazo,
} from '@/lib/importacion'
import { TAMANO_MAXIMO, TOPE_FILAS, avisoDeTamano } from '@/lib/limites'
import { UUID } from '@/lib/recursos'
import { exigirAdminCompleto } from '@/lib/sesion'

/**
 * El análisis, recortado a lo que la pantalla realmente muestra.
 *
 * `Analisis` trae una `FilaMapeada` por cada fila del Excel y cada una arrastra
 * adentro la fila cruda entera. Mandarlo al navegador es pagar el archivo dos
 * veces en payload RSC para dibujar unos contadores y una tabla de ocho
 * renglones, y con un archivo grande son decenas de megas. Las filas se quedan
 * del lado del servidor, que es el único que las va a escribir.
 *
 * Los tres listados viajan cortados y con su total al lado: nadie lee dos mil
 * rechazos en una tabla, y un mapeo mal elegido puede generar un valor sin
 * resolver por fila —o sea, un <select> por fila—.
 */
export interface AnalisisParaPantalla {
  filasOk: number
  totalKg: number
  desde: string | null
  hasta: string | null
  filasSinPeso: number
  filasSalteadas: number
  filasVacias: number
  mesDelArchivo: string | null
  filasDeOtroMes: number
  porSitio: ResumenDeSitio[]
  /** Los primeros nomás; `rechazosTotal` dice cuántos son. */
  rechazos: Rechazo[]
  rechazosTotal: number
  /** Motivo → cuántas filas, contado sobre todos y no sólo sobre los que viajan. */
  motivos: Array<[motivo: string, veces: number]>
  sitiosSinResolver: SinResolver[]
  sitiosSinResolverTotal: number
  materialesSinResolver: SinResolver[]
  materialesSinResolverTotal: number
}

export type ResultadoPrevisualizar =
  | { ok: true; vistazo: Vistazo; analisis: AnalisisParaPantalla; mapeo: Mapeo; catalogo: Catalogo }
  | { ok: false; error?: string }

export type ResultadoConfirmar =
  | {
      ok: true
      id: string
      filasOk: number
      filasError: number
      /** Filas guardadas con peso 0 porque el archivo no informó los kilos. */
      sinPeso: number
      desde: string | null
      hasta: string | null
      totalKg: number
      aviso: string
    }
  | {
      ok: false
      error?: string
      /**
       * El error se arregla apretando de nuevo, a sabiendas: es el aviso de que
       * el período se pisa con otra importación confirmada. No es lo mismo que
       * un archivo que no se puede leer, y la pantalla tiene que poder ofrecer
       * «guardar igual» sin hacer pasar todos los errores por ese botón.
       */
      pedirConfirmacion?: true
    }

/** El único tipo de mapeo que esta pantalla escribe; el otro es del CLI. */
const TIPO_MAPEO = 'pesos_contenedores'

/**
 * Filas por sentencia. De a una serían 287 idas y vueltas a São Paulo dentro
 * de la misma transacción; en un solo insert, el protocolo de Postgres no
 * admite más de 65535 parámetros y un archivo de un año entero los pasaría.
 */
const LOTE = 500

/**
 * Cuántos rechazos y cuántos valores sin resolver viajan al navegador. El resto
 * se cuenta y no se manda: la tabla de rechazos se mira para ir a buscar una
 * fila al Excel, y para eso doscientas ya son más de las que nadie revisa.
 */
const TOPE_RECHAZOS = 200
const TOPE_SIN_RESOLVER = 40

// ── Lo que llega del formulario ─────────────────────────────────────────

function texto(fd: FormData, campo: string): string {
  const v = fd.get(campo)
  return typeof v === 'string' ? v.trim() : ''
}

function aEntero(v: string): number | null {
  if (!/^\d{1,4}$/.test(v)) return null
  const n = Number(v)
  return n >= 1 && n <= 5000 ? n : null
}

/** Sin acentos, en minúsculas y sin dobles espacios, sólo para comparar. */
function llave(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

async function tomarArchivo(
  fd: FormData,
): Promise<{ nombre: string; datos: ArrayBuffer } | { error: string }> {
  const archivo = fd.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'Elegí el archivo que mandó la planta antes de seguir.' }
  }
  if (!archivo.name.toLowerCase().endsWith('.xlsx')) {
    return {
      error:
        'El archivo tiene que ser un Excel .xlsx, tal cual lo manda la planta. Si te lo pasaron en otro formato, abrilo en Excel y guardalo como .xlsx.',
    }
  }
  // El tope está bien por debajo del bodySizeLimit de next.config.ts, así que
  // este chequeo llega a correr y el mensaje se puede leer. Pegado al límite de
  // Next era inalcanzable: el cuerpo del pedido lleva el archivo más el mapeo y
  // los separadores, así que Next cortaba antes y la acción nunca arrancaba.
  if (archivo.size > TAMANO_MAXIMO) return { error: avisoDeTamano(archivo.size) }
  return { nombre: archivo.name, datos: await archivo.arrayBuffer() }
}

/**
 * El mapeo llega como JSON desde el navegador, así que es un dato de
 * formulario como cualquier otro y hay que validarlo antes de creerle: acá se
 * revisa la forma, y más abajo que estén las columnas sin las que no hay
 * importación posible.
 */
const ESQUEMA_MAPEO = z.object({
  columnas: z
    .object({
      fecha: z.string().optional(),
      sitio: z.string().optional(),
      material: z.string().optional(),
      peso: z.string().optional(),
      contenedores: z.string().optional(),
      remito: z.string().optional(),
      destino: z.string().optional(),
    })
    .optional(),
  transformaciones: z
    .object({
      sitios: z.record(z.string(), z.string()).optional(),
      materiales: z.record(z.string(), z.string()).optional(),
      saltear: z.array(z.string()).optional(),
      aceptarOtrosMeses: z.boolean().optional(),
    })
    .optional(),
})

function aMapeo(bruto: unknown): Mapeo | null {
  const analisis = ESQUEMA_MAPEO.safeParse(bruto)
  if (!analisis.success) return null

  const c = analisis.data.columnas ?? {}
  const t = analisis.data.transformaciones ?? {}
  // Una columna en blanco es una columna que no se eligió: para los campos
  // opcionales eso es `undefined` y no la cadena vacía, que el analizador
  // podría confundir con un encabezado sin nombre.
  const opcional = (v: string | undefined) => v?.trim() || undefined

  return {
    columnas: {
      fecha: (c.fecha ?? '').trim(),
      sitio: (c.sitio ?? '').trim(),
      material: opcional(c.material),
      peso: (c.peso ?? '').trim(),
      contenedores: opcional(c.contenedores),
      remito: opcional(c.remito),
      destino: opcional(c.destino),
    },
    transformaciones: {
      sitios: t.sitios,
      materiales: t.materiales,
      saltear: t.saltear?.map((v) => v.trim()).filter(Boolean),
      aceptarOtrosMeses: t.aceptarOtrosMeses,
    },
  }
}

function leerMapeo(fd: FormData): Mapeo | null {
  const crudo = texto(fd, 'mapeo')
  if (!crudo) return null
  try {
    return aMapeo(JSON.parse(crudo))
  } catch {
    return null
  }
}

/** Las tres sin las que no hay nada que cruzar. */
function loQueFalta(m: Mapeo): string | null {
  if (!m.columnas.fecha) return 'Falta decir cuál es la columna de la fecha. Volvé al paso 3.'
  if (!m.columnas.sitio) {
    return 'Falta decir cuál es la columna que identifica el punto verde. Volvé al paso 3.'
  }
  if (!m.columnas.peso) return 'Falta decir cuál es la columna de los kilos. Volvé al paso 3.'
  return null
}

/**
 * Primera adivinanza de qué columna es cuál, por el nombre del encabezado.
 * Es sólo para que los selects del paso 3 arranquen en algo razonable; la
 * palabra final la tiene la persona.
 *
 * CLIENTE queda deliberadamente afuera de la lista del punto verde: dice NODO
 * o LA HUERTA, que es quién opera el punto y no cuál es. El que lo identifica
 * es el domicilio.
 */
const PISTAS: Array<[campo: string, palabras: string[]]> = [
  ['fecha', ['fecha']],
  ['sitio', ['domicilio', 'direccion', 'punto', 'sitio', 'lugar']],
  ['material', ['residuo', 'material', 'corriente']],
  ['peso', ['kilos', 'kilo', 'neto', 'peso', 'kg']],
  ['contenedores', ['cont', 'bultos', 'cantidad']],
  ['remito', ['remito', 'comprobante']],
  ['destino', ['destino']],
]

function mapeoSugerido(columnas: string[]): Mapeo {
  const disponibles = columnas.map((nombre) => ({ nombre, llave: llave(nombre), tomada: false }))
  const elegidas: Record<string, string> = {}

  for (const [campo, palabras] of PISTAS) {
    // Cada encabezado se usa una sola vez: si «TOT DE CONT» ya fue a
    // contenedores, no puede volver a salir como otra cosa.
    const c = disponibles.find((x) => !x.tomada && palabras.some((p) => x.llave.includes(p)))
    if (c) {
      c.tomada = true
      elegidas[campo] = c.nombre
    }
  }

  return {
    columnas: {
      fecha: elegidas.fecha ?? '',
      sitio: elegidas.sitio ?? '',
      material: elegidas.material,
      peso: elegidas.peso ?? '',
      contenedores: elegidas.contenedores,
      remito: elegidas.remito,
      destino: elegidas.destino,
    },
    transformaciones: {},
  }
}

// ── Lo que se lee de la base ────────────────────────────────────────────

interface FilaSitio {
  id: string
  codigo: string
  nombre: string
  direccion: string | null
}

interface FilaMaterial {
  id: string
  nombre: string
}

interface FilaMapeoGuardado {
  columnas: unknown
  transformaciones: unknown
  hoja: string | null
  fila_encabezado: number
}

/**
 * Los puntos verdes y las corrientes contra los que se resuelve cada fila.
 *
 * Van sin filtrar por `activo` a propósito: el archivo es de agosto y un punto
 * que cerró después igual tiene kilos de agosto para cruzar. Esconderlo acá
 * sería perder el dato justo del punto que más interesa mirar.
 *
 * Devuelve las filas con id además del catálogo porque quien confirma necesita
 * las dos cosas y no tiene sentido pedirlas dos veces.
 */
async function catalogoEnTx(
  tx: Conexion,
): Promise<{ catalogo: Catalogo; sitios: FilaSitio[]; materiales: FilaMaterial[] }> {
  const [sitios, materiales] = await Promise.all([
    tx.consultar<FilaSitio>(
      `select id, codigo, nombre, direccion
         from sitios
        where tipo = 'punto_verde'
        order by orden, codigo`,
    ),
    tx.consultar<FilaMaterial>(
      `select id, nombre
         from materiales
        where cardinality(flujos) = 0 or 'punto_verde' = any(flujos)
        order by orden, nombre`,
    ),
  ])

  return {
    sitios,
    materiales,
    catalogo: {
      sitios: sitios.map((s) => ({ codigo: s.codigo, nombre: s.nombre, direccion: s.direccion })),
      materiales: materiales.map((m) => ({ nombre: m.nombre })),
    },
  }
}

// ── Errores ─────────────────────────────────────────────────────────────

function traducir(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('pesos_externos_sitio_id_fkey')) {
    return 'Uno de los puntos verdes dejó de existir mientras se importaba. Actualizá la pantalla y previsualizá de nuevo.'
  }
  if (m.includes('pesos_externos_material_id_fkey')) {
    return 'Una de las corrientes dejó de existir mientras se importaba. Actualizá la pantalla y previsualizá de nuevo.'
  }
  // Postgres no nombra la columna cuando un numeric no entra, así que esta
  // rama tiene que ir antes que la de peso_kg: si no, cae en el mensaje
  // genérico de «probá de nuevo», y probar de nuevo falla siempre. Con el tope
  // de TOPE_PESO_KG la fila se rechaza antes con su número; esto queda de red.
  if (/numeric field overflow|out of range|fuera de rango/i.test(m)) {
    return 'Hay un número demasiado grande en la columna de kilos. Previsualizá de nuevo: la pantalla te dice en qué fila del Excel está.'
  }
  if (m.includes('peso_kg')) {
    return 'Hay un peso negativo en el archivo. Revisá la columna de kilos: un neto no puede dar menos que cero.'
  }
  if (m.includes('importaciones_hash_confirmado_idx')) {
    return 'Otra persona confirmó este mismo archivo mientras lo estabas confirmando vos, y entró primero. Actualizá la pantalla: si ya figura abajo, no hace falta hacerlo de nuevo.'
  }
  if (m.includes('mapeos_nombre_idx')) {
    return 'Ya hay otro mapeo guardado con ese nombre. Poné uno distinto para no pisarlo.'
  }
  if (m.includes('mapeos_importacion_creado_por_id_fkey') || m.includes('importado_por_id_fkey')) {
    return 'Tu usuario ya no existe en la base. Volvé a entrar.'
  }
  return mensajeDeError(e)
}

/**
 * Lo que tira exceljs cuando el archivo no es un xlsx de verdad no le dice
 * nada a nadie («Can't find end of central directory»). Lo que tira
 * importacion.ts sí está escrito para la pantalla, así que pasa tal cual: se
 * lo reconoce porque está en castellano y habla de hojas, filas o columnas.
 */
function noSePudoLeer(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/[áéíóúñ¿¡]/i.test(m) || /\b(hoja|fila|columna|encabezado)\b/i.test(m)) return m
  return 'No se pudo leer el archivo. Fijate que sea el Excel original de la planta, sin contraseña y sin haber pasado por otro formato.'
}

// ── Lo que se le manda a la pantalla ────────────────────────────────────

function paraPantalla(a: Analisis): AnalisisParaPantalla {
  const cuenta = new Map<string, number>()
  for (const r of a.rechazos) cuenta.set(r.motivo, (cuenta.get(r.motivo) ?? 0) + 1)

  return {
    filasOk: a.filas.length,
    totalKg: a.totalKg,
    desde: a.desde,
    hasta: a.hasta,
    filasSinPeso: a.filasSinPeso,
    filasSalteadas: a.filasSalteadas,
    filasVacias: a.filasVacias,
    mesDelArchivo: a.mesDelArchivo,
    filasDeOtroMes: a.filasDeOtroMes,
    porSitio: resumirPorSitio(a.filas),
    rechazos: a.rechazos.slice(0, TOPE_RECHAZOS),
    rechazosTotal: a.rechazos.length,
    motivos: [...cuenta.entries()].sort((x, y) => y[1] - x[1]),
    sitiosSinResolver: a.sitiosSinResolver.slice(0, TOPE_SIN_RESOLVER),
    sitiosSinResolverTotal: a.sitiosSinResolver.length,
    materialesSinResolver: a.materialesSinResolver.slice(0, TOPE_SIN_RESOLVER),
    materialesSinResolverTotal: a.materialesSinResolver.length,
  }
}

// ── 1. Previsualizar ────────────────────────────────────────────────────

/**
 * Lee el archivo y muestra qué se entendió. No escribe una sola fila: se puede
 * volver acá todas las veces que haga falta, cambiando la hoja, la fila de
 * encabezado o el mapeo, hasta que lo que se ve en pantalla sea lo que dice el
 * Excel.
 */
export async function previsualizar(
  _previo: unknown,
  fd: FormData,
): Promise<ResultadoPrevisualizar> {
  const sesion = await exigirAdminCompleto().catch(() => null)
  if (!sesion) return { ok: false, error: 'Se cerró la sesión. Entrá de nuevo.' }

  const archivo = await tomarArchivo(fd)
  if ('error' in archivo) return { ok: false, error: archivo.error }

  const mapeoId = texto(fd, 'mapeoId')
  if (mapeoId && !UUID.test(mapeoId)) {
    return { ok: false, error: 'No se pudo identificar el mapeo guardado. Volvé a empezar el asistente.' }
  }

  // Una sola transacción para todo lo que hay que traer de la base: el
  // catálogo contra el que se resuelven punto y corriente, y el mapeo guardado
  // si se eligió uno. El Excel se abre afuera, que no necesita conexión.
  let catalogo: Catalogo
  let guardado: FilaMapeoGuardado | null
  try {
    const leido = await conSesion(sesion, async (tx) => {
      const [cat, mapeos] = await Promise.all([
        catalogoEnTx(tx),
        mapeoId
          ? tx.consultar<FilaMapeoGuardado>(
              `select columnas, transformaciones, hoja, fila_encabezado
                 from mapeos_importacion
                where id = $1`,
              [mapeoId],
            )
          : Promise.resolve([] as FilaMapeoGuardado[]),
      ])
      return { catalogo: cat.catalogo, guardado: mapeos[0] ?? null }
    })
    catalogo = leido.catalogo
    guardado = leido.guardado
  } catch (e) {
    return { ok: false, error: traducir(e) }
  }

  if (!catalogo.sitios.length) {
    return {
      ok: false,
      error: 'No hay ningún punto verde cargado en las listas maestras, así que no habría contra qué cruzar los kilos. Cargalos primero en Listas.',
    }
  }

  try {
    // Lo que la persona acaba de elegir manda sobre lo que trae el mapeo
    // guardado; recién si no hay ninguno de los dos decide la heurística.
    const hoja = texto(fd, 'hoja') || guardado?.hoja || null
    const filaEncabezado = aEntero(texto(fd, 'filaEncabezado')) ?? guardado?.fila_encabezado ?? null

    // Una sola apertura del libro para la vista y para las filas, y con el tope
    // de filas adentro: cortar por bytes no alcanza, porque un .xlsx comprime
    // lo bastante bien como para que unos pocos megas sean cientos de miles de
    // filas y el proceso se quede sin memoria antes de poder devolver un error.
    const { vistazo: v, filas } = await leerHoja(archivo.datos, hoja, filaEncabezado, TOPE_FILAS)

    const mapeo =
      leerMapeo(fd) ??
      (guardado &&
        aMapeo({ columnas: guardado.columnas, transformaciones: guardado.transformaciones })) ??
      mapeoSugerido(v.columnas)

    return {
      ok: true,
      vistazo: v,
      analisis: paraPantalla(analizar(v, filas, mapeo, catalogo)),
      mapeo,
      catalogo,
    }
  } catch (e) {
    return { ok: false, error: noSePudoLeer(e) }
  }
}

// ── 2. Confirmar ────────────────────────────────────────────────────────

interface Guardable {
  fila: FilaMapeada
  sitioId: string
  materialId: string | null
}

/**
 * El mapeo se guarda para que el mes que viene el archivo llegue igual y esto
 * ya venga resuelto. Si se venía editando uno, se actualiza ése; si no, manda
 * el nombre, y repetir un nombre pisa el anterior en vez de dejar dos mapeos
 * idénticos con distinto id.
 */
async function guardarMapeoEnTx(
  tx: Conexion,
  datos: {
    id: string | null
    nombre: string
    mapeo: Mapeo
    hoja: string
    filaEncabezado: number
    perfilId: string
  },
): Promise<string> {
  const columnas = JSON.stringify(datos.mapeo.columnas)
  const transformaciones = JSON.stringify(datos.mapeo.transformaciones)

  if (datos.id) {
    const [fila] = await tx.consultar<{ id: string }>(
      `update mapeos_importacion
          set nombre = $1, columnas = $2::jsonb, transformaciones = $3::jsonb,
              hoja = $4, fila_encabezado = $5, activo = true
        where id = $6
        returning id`,
      [datos.nombre, columnas, transformaciones, datos.hoja, datos.filaEncabezado, datos.id],
    )
    // Si el mapeo que se estaba editando ya no está, se guarda como uno nuevo:
    // perder la configuración recién armada sería lo peor que podría pasar acá.
    if (fila) return fila.id
  }

  const [fila] = await tx.consultar<{ id: string }>(
    `insert into mapeos_importacion
       (nombre, tipo, columnas, transformaciones, hoja, fila_encabezado, activo, creado_por_id)
     values ($1, $6, $2::jsonb, $3::jsonb, $4, $5, true, $7)
     on conflict (lower(nombre)) do update
        set columnas = excluded.columnas,
            transformaciones = excluded.transformaciones,
            hoja = excluded.hoja,
            fila_encabezado = excluded.fila_encabezado,
            activo = true
     returning id`,
    [
      datos.nombre,
      columnas,
      transformaciones,
      datos.hoja,
      datos.filaEncabezado,
      TIPO_MAPEO,
      datos.perfilId,
    ],
  )
  return fila.id
}

/**
 * Todas las filas en un puñado de sentencias y no de a una.
 *
 * La cantidad de contenedores retirados no tiene columna propia en
 * pesos_externos: viaja en fila_origen, que está justamente para eso. Por eso
 * las filas sin kilos se guardan igual con peso 0 —lo que aportan es ese
 * conteo— y perderlas sería perder el dato de los retiros de todo el mes.
 */
async function insertarPesosEnTx(
  tx: Conexion,
  importacionId: string,
  guardables: Guardable[],
): Promise<void> {
  for (let desde = 0; desde < guardables.length; desde += LOTE) {
    const lote = guardables.slice(desde, desde + LOTE)

    // El $1 se repite en cada fila porque la importación es la misma; el resto
    // se numera solo, como en crearMovimiento.
    const valores: unknown[] = [importacionId]
    const tuplas = lote.map(({ fila, sitioId, materialId }) => {
      const p = (v: unknown) => `$${valores.push(v)}`
      return `($1, ${p(sitioId)}, ${p(fila.fecha)}::date, ${p(fila.contenedorCodigo)}, ${p(materialId)}, ${p(fila.pesoKg)}, ${p(JSON.stringify(fila.cruda))}::jsonb)`
    })

    await tx.consultar(
      `insert into pesos_externos
         (importacion_id, sitio_id, fecha, contenedor_codigo, material_id, peso_kg, fila_origen)
       values ${tuplas.join(', ')}`,
      valores,
    )
  }
}

/**
 * Guarda de verdad: el mapeo para la próxima, la importación y sus filas.
 *
 * Todo va en una sola transacción. Si algo falla en la fila 200 no queda media
 * importación cargada, que sería lo peor de todos los mundos: nada se borra,
 * así que la mitad que hubiera entrado quedaría ahí para siempre.
 */
export async function confirmar(_previo: unknown, fd: FormData): Promise<ResultadoConfirmar> {
  const sesion = await exigirAdminCompleto().catch(() => null)
  if (!sesion) return { ok: false, error: 'Se cerró la sesión. Entrá de nuevo.' }

  const archivo = await tomarArchivo(fd)
  if ('error' in archivo) return { ok: false, error: archivo.error }

  const nombreMapeo = texto(fd, 'nombreMapeo')
  if (nombreMapeo.length < 3) {
    return {
      ok: false,
      error: 'Poné un nombre para el mapeo: es el que vas a elegir la próxima vez que llegue un archivo igual a éste.',
    }
  }

  const mapeoId = texto(fd, 'mapeoId')
  if (mapeoId && !UUID.test(mapeoId)) {
    return { ok: false, error: 'No se pudo identificar el mapeo guardado. Volvé a empezar el asistente.' }
  }

  const mapeo = leerMapeo(fd)
  if (!mapeo) {
    return {
      ok: false,
      error: 'El mapeo de columnas llegó mal armado. Volvé al paso 3 y elegí de nuevo qué columna es cuál.',
    }
  }
  const falta = loQueFalta(mapeo)
  if (falta) return { ok: false, error: falta }

  const hoja = texto(fd, 'hoja')
  const filaEncabezado = aEntero(texto(fd, 'filaEncabezado'))
  if (!hoja || !filaEncabezado) {
    return { ok: false, error: 'Falta decir qué hoja se lee y en qué fila están los encabezados. Volvé al paso 2.' }
  }

  // Quien ya vio el aviso de que el período se pisa y apretó igual.
  const pisarPeriodo = texto(fd, 'pisarPeriodo') === 'si'

  // El libro se abre antes de pedir la conexión: es la parte lenta y no tiene
  // por qué hacerse con una transacción abierta esperando.
  let v: Vistazo
  let filasCrudas: Array<Record<string, string>>
  try {
    const leido = await leerHoja(archivo.datos, hoja, filaEncabezado, TOPE_FILAS)
    v = leido.vistazo
    filasCrudas = leido.filas
  } catch (e) {
    return { ok: false, error: noSePudoLeer(e) }
  }
  const hash = huella(archivo.datos)

  try {
    const resultado = await conSesion(sesion, async (tx): Promise<ResultadoConfirmar> => {
      const { catalogo, sitios, materiales } = await catalogoEnTx(tx)

      // El análisis corre adentro de la transacción porque necesita el catálogo
      // recién leído, pero no vuelve a la base: son microsegundos de CPU sobre
      // filas que ya están en memoria.
      const analisis = analizar(v, filasCrudas, mapeo, catalogo)

      // Nada se borra: un archivo confirmado dos veces deja las filas repetidas
      // para siempre y el cruce cuenta el doble. Como pesos_externos no tiene
      // llave natural, el primer portero es el hash del contenido.
      const [repetido] = await tx.consultar<{ archivo_nombre: string }>(
        `select archivo_nombre
           from importaciones
          where archivo_hash = $1 and estado = 'confirmada'
          limit 1`,
        [hash],
      )
      if (repetido) {
        return {
          ok: false,
          error: `Este mismo archivo ya se importó como «${repetido.archivo_nombre}» y está confirmado. Si lo querés cargar de nuevo, revertí primero esa importación: acá no se borra nada, y las filas repetidas quedarían contadas dos veces en el cruce.`,
        }
      }

      // El hash sólo frena el archivo idéntico byte a byte, y el duplicado real
      // no es ése: la planta reexporta el mismo mes, o lo corrige, y el zip
      // guarda hasta la hora de modificación —dos «guardar como» seguidos del
      // mismo libro ya dan hashes distintos—. Lo que se repite de verdad es el
      // período, así que se avisa y se pide apretar de nuevo a sabiendas. No se
      // prohíbe: reimportar un mes corregido después de revertir el anterior es
      // exactamente lo que se espera que alguien haga.
      if (!pisarPeriodo && analisis.desde && analisis.hasta) {
        // periodo_desde y periodo_hasta son columnas `date`: el driver las
        // entrega como Date a medianoche UTC, y por eso las escribe
        // fechaDeCalendario() y no fecha(), que las correría al día anterior.
        const [solapada] = await tx.consultar<{
          archivo_nombre: string
          periodo_desde: Date | string
          periodo_hasta: Date | string
          filas_ok: number
        }>(
          `select archivo_nombre, periodo_desde, periodo_hasta, filas_ok
             from importaciones
            where estado = 'confirmada'
              and periodo_desde is not null and periodo_hasta is not null
              and periodo_desde <= $2::date and periodo_hasta >= $1::date
            order by importado_en desc
            limit 1`,
          [analisis.desde, analisis.hasta],
        )
        if (solapada) {
          const rango = `${fechaDeCalendario(solapada.periodo_desde)} a ${fechaDeCalendario(solapada.periodo_hasta)}`
          return {
            ok: false,
            pedirConfirmacion: true,
            error:
              `Ya hay una importación confirmada que cubre estos mismos días: «${solapada.archivo_nombre}», `
              + `del ${rango}, con ${solapada.filas_ok} filas. Si éste es el mismo mes que la planta `
              + 'mandó de nuevo, revertí primero aquélla desde la lista de abajo: si no, los kilos '
              + 'quedan contados dos veces en el cruce y de ahí no salen, porque acá no se borra '
              + 'nada. Si son dos períodos distintos que se tocan, o ya revertiste la otra, guardá igual.',
          }
        }
      }

      const porCodigo = new Map(sitios.map((s) => [llave(s.codigo), s.id]))
      const porNombre = new Map(materiales.map((m) => [llave(m.nombre), m.id]))

      // Los rechazos del analizador más lo que se cae recién acá. Una fila sin
      // punto verde no se guarda con sitio_id en null: un peso que no se puede
      // atribuir a ningún punto no sirve para cruzar nada y ensucia el total.
      const errores: Rechazo[] = [...analisis.rechazos]
      const guardables: Guardable[] = []
      for (const fila of analisis.filas) {
        const sitioId = porCodigo.get(llave(fila.sitioCodigo))
        if (!sitioId) {
          errores.push({
            fila: fila.fila,
            motivo: `El punto verde «${fila.sitioCodigo}» no existe en las listas maestras.`,
            dato: fila.sitioCodigo,
          })
          continue
        }
        const materialId = fila.materialNombre
          ? porNombre.get(llave(fila.materialNombre)) ?? null
          : null
        guardables.push({ fila, sitioId, materialId })
      }

      if (!guardables.length) {
        return {
          ok: false,
          error: 'No quedó ninguna fila para guardar. Volvé al paso 3: si está mal elegida la columna del punto verde o la de los kilos, se cae el archivo entero.',
        }
      }

      const mapeoGuardadoId = await guardarMapeoEnTx(tx, {
        id: mapeoId || null,
        nombre: nombreMapeo,
        mapeo,
        hoja: v.hoja,
        filaEncabezado: v.filaEncabezado,
        perfilId: sesion.perfilId,
      })

      const [importacion] = await tx.consultar<{ id: string }>(
        `insert into importaciones
           (mapeo_id, archivo_nombre, archivo_hash, periodo_desde, periodo_hasta,
            filas_ok, filas_error, errores, estado, importado_por_id)
         values ($1, $2, $3, $4::date, $5::date, $6, $7, $8::jsonb, 'confirmada', $9)
         returning id`,
        [
          mapeoGuardadoId,
          archivo.nombre,
          hash,
          analisis.desde,
          analisis.hasta,
          guardables.length,
          errores.length,
          JSON.stringify(errores),
          sesion.perfilId,
        ],
      )

      await insertarPesosEnTx(tx, importacion.id, guardables)

      const sinPeso = guardables.filter(({ fila }) => fila.pesoKg === 0).length
      return {
        ok: true,
        id: importacion.id,
        filasOk: guardables.length,
        filasError: errores.length,
        sinPeso,
        desde: analisis.desde,
        hasta: analisis.hasta,
        totalKg: analisis.totalKg,
        aviso:
          `Se guardaron ${guardables.length} filas` +
          (errores.length ? `, ${errores.length} quedaron afuera` : '') +
          (sinPeso ? ` y ${sinPeso} entraron sin kilos informados, sólo por los contenedores` : '') +
          '.',
      }
    })

    if (resultado.ok) revalidatePath('/importar')
    return resultado
  } catch (e) {
    return { ok: false, error: traducir(e) }
  }
}

// ── 3. Revertir ─────────────────────────────────────────────────────────

/**
 * Sacar una importación del cruce. No borra nada —el DELETE está revocado en
 * la base y además la regla es que nada se borra—: las filas de pesos_externos
 * quedan, y dejan de contar porque el cruce mira sólo las confirmadas.
 */
export async function revertir(
  _previo: unknown,
  fd: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const sesion = await exigirAdminCompleto().catch(() => null)
  if (!sesion) return { ok: false, error: 'Se cerró la sesión. Entrá de nuevo.' }

  const id = texto(fd, 'id')
  if (!UUID.test(id)) {
    return { ok: false, error: 'No se pudo identificar la importación. Actualizá la pantalla.' }
  }

  try {
    const filas = await consultarConSesion<{ id: string }>(
      sesion,
      `update importaciones
          set estado = 'revertida'
        where id = $1 and estado = 'confirmada'
        returning id`,
      [id],
    )
    if (!filas.length) {
      return { ok: false, error: 'Esa importación ya estaba revertida, o no existe. Actualizá la pantalla.' }
    }
  } catch (e) {
    return { ok: false, error: traducir(e) }
  }

  revalidatePath('/importar')
  return { ok: true }
}
