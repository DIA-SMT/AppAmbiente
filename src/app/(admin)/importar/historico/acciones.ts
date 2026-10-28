'use server'

/**
 * Importación del histórico de ingresos a la Planta, desde el R-05 de la
 * Secretaría.
 *
 * A diferencia de los pesos de la 9 de Julio, esto SÍ crea movimientos: cada
 * fila de la planilla es un viaje que entró a la Planta antes de que lo cargara
 * el celular. Por eso tiene su propia pantalla y sus propias reglas:
 *
 *   · Se puede subir el mismo archivo todos los meses. Cada fila lleva una
 *     clave calculada por lo que dice (historicoPlanta.ts), y una fila que ya
 *     está vigente no vuelve a entrar. La planilla crece, y lo que se carga es
 *     sólo lo nuevo.
 *
 *   · Revertir anula los movimientos, con motivo y con quién. No se borra
 *     nada: el DELETE está revocado desde la 0019.
 *
 *   · La pantalla muestra, mes por mes, lo que entra al lado de lo que la propia
 *     planilla informa en su hoja de indicadores y de lo que el sistema ya
 *     tiene. Es lo que permite decir que lo importado es fiel antes de
 *     guardarlo.
 *
 * El archivo viaja entero en cada paso, como en la otra importación: pesa unos
 * 700 KB y así no queda nada a medio hacer en el servidor.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { Conexion } from '@db/client'
import { conSesion } from '@db/sesion'
import { mensajeDeError } from '@/lib/datos'
import {
  HOJA_R05, analizarR05, leerR05, predioPorNombre,
  type Analisis, type CatalogoPlanta, type FilaHistorica, type Forma, type LibroR05,
  type Rechazo, type Resoluciones, type SinResolver,
} from '@/lib/historicoPlanta'
import { UUID } from '@/lib/recursos'
import { exigirAdminCompleto } from '@/lib/sesion'

/** El R-05 pesa unos 700 KB con dos años adentro; esto deja lugar para varios más. */
const TAMANO_MAXIMO_R05 = 6 * 1024 * 1024

/** El tipo de mapeo y de importación que escribe esta pantalla. */
const TIPO = 'movimientos_historicos'

/**
 * El nombre del mapeo que guarda lo que se decidió sobre predios y corrientes.
 * No se exporta: un archivo 'use server' sólo puede exportar acciones.
 */
const NOMBRE_MAPEO = 'R-05 · Ingresos a la Planta'

/** Filas por sentencia: once parámetros por movimiento, lejos del tope de 65535. */
const LOTE = 500

const TOPE_RECHAZOS = 200

// ── Lo que viaja a la pantalla ──────────────────────────────────────────

export interface PredioDelMes {
  codigo: string
  /**
   * Lo que el archivo dice que entró, contando también las filas que ya se
   * habían importado antes: es lo que se compara contra la planilla.
   */
  m3: number
  viajes: number
  /** Cuántos de esos viajes ya estaban en el sistema y no se vuelven a cargar. */
  yaEstaban: number
  /** Lo que la hoja de indicadores de la propia planilla dice para este mes. */
  planillaM3: number | null
  planillaViajes: number | null
  /** Lo que el sistema ya tiene vigente para este mes, venga de donde venga. */
  sistemaM3: number
  sistemaViajes: number
}

export interface MesEnPantalla {
  mes: string
  predios: PredioDelMes[]
}

export interface AnalisisParaPantalla {
  filasConDatos: number
  /** Las que entran y todavía no están en el sistema. */
  filasNuevas: number
  /** Las que entrarían pero ya se importaron antes. */
  filasYaEstaban: number
  m3Nuevos: number
  desde: string | null
  hasta: string | null
  primerMes: string | null
  ultimoMes: string | null
  fueraDelPeriodo: number
  filasVacias: number
  formas: Record<Forma, number>
  cantidadesConTexto: number
  pilaRepetiaCantidad: number
  hayIndicadores: boolean
  porMes: MesEnPantalla[]
  rechazos: Rechazo[]
  rechazosTotal: number
  motivos: Array<[motivo: string, veces: number]>
  prediosSinResolver: SinResolver[]
  materialesSinResolver: SinResolver[]
  /**
   * El primer viaje a la Planta que el sistema tiene y no salió de ninguna
   * importación —lo que cargó el celular—, como aaaa-mm-dd. Desde ese día la
   * planilla y el sistema cuentan los mismos viajes dos veces.
   */
  primerViajeDelSistema: string | null
}

export type ResultadoPrevisualizar =
  | { ok: true; analisis: AnalisisParaPantalla; resoluciones: Resoluciones; catalogo: CatalogoPlanta }
  | { ok: false; error: string }

export type ResultadoConfirmar =
  | { ok: true; id: string; filas: number; m3: number; yaEstaban: number; desde: string | null; hasta: string | null }
  | { ok: false; error: string }

// ── Lo que llega del formulario ─────────────────────────────────────────

function texto(fd: FormData, campo: string): string {
  const v = fd.get(campo)
  return typeof v === 'string' ? v.trim() : ''
}

async function tomarArchivo(
  fd: FormData,
): Promise<{ nombre: string; datos: ArrayBuffer } | { error: string }> {
  const archivo = fd.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'Elegí el Excel del R-05 antes de seguir.' }
  }
  if (!archivo.name.toLowerCase().endsWith('.xlsx')) {
    return {
      error: 'El archivo tiene que ser un Excel .xlsx. Si la planilla está en Google, descargala con Archivo → Descargar → Microsoft Excel.',
    }
  }
  if (archivo.size > TAMANO_MAXIMO_R05) {
    const mb = (archivo.size / (1024 * 1024)).toFixed(1).replace('.', ',')
    return { error: `El archivo pesa ${mb} MB y el máximo son 6 MB. El R-05 con dos años adentro pesa menos de 1 MB: fijate que no tenga imágenes pegadas.` }
  }
  return { nombre: archivo.name, datos: await archivo.arrayBuffer() }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

function leerPeriodo(fd: FormData): { desde: string | null; hasta: string | null } {
  const desde = texto(fd, 'desde')
  const hasta = texto(fd, 'hasta')
  return { desde: FECHA.test(desde) ? desde : null, hasta: FECHA.test(hasta) ? hasta : null }
}

const ESQUEMA_RESOLUCIONES = z.object({
  predios: z.record(z.string(), z.string()).optional(),
  materiales: z.record(z.string(), z.string()).optional(),
})

function aResoluciones(bruto: unknown): Resoluciones {
  const r = ESQUEMA_RESOLUCIONES.safeParse(bruto)
  return r.success
    ? { predios: r.data.predios ?? {}, materiales: r.data.materiales ?? {} }
    : { predios: {}, materiales: {} }
}

function leerResoluciones(fd: FormData): Resoluciones | null {
  const crudo = texto(fd, 'resoluciones')
  if (!crudo) return null
  try {
    return aResoluciones(JSON.parse(crudo))
  } catch {
    return null
  }
}

// ── Lo que se lee de la base ────────────────────────────────────────────

/** Hoy en Tucumán, como aaaa-mm-dd: lo que pase después todavía no pasó. */
function hoyEnTucuman(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Tucuman' }).format(new Date())
}

interface Catalogo {
  catalogo: CatalogoPlanta
  predios: Map<string, string>
  materiales: Map<string, string>
  m3: string | null
}

/**
 * Los predios van sin filtrar por activo, como en la otra importación: un
 * viaje de 2024 a un predio que después se dio de baja tiene que poder entrar.
 * Las corrientes sí van filtradas: las viejas se reemplazaron por las de los
 * formularios, y un viaje no puede caer en una que ya no se usa.
 */
async function catalogoEnTx(tx: Conexion): Promise<Catalogo> {
  const [predios, materiales, unidades] = await Promise.all([
    tx.consultar<{ id: string; codigo: string; nombre: string; direccion: string | null; activo: boolean }>(
      `select id, codigo, nombre, direccion, activo from sitios where tipo = 'planta' order by activo desc, orden, codigo`,
    ),
    tx.consultar<{ id: string; nombre: string }>(
      `select id, nombre from materiales
        where activo and 'planta' = any(flujos) and 'ingreso' = any(tipos)
        order by orden, nombre`,
    ),
    tx.consultar<{ id: string }>(`select id from unidades where codigo = 'm3'`),
  ])
  return {
    catalogo: {
      predios: predios.map(({ codigo, nombre, direccion, activo }) => ({ codigo, nombre, direccion, activo })),
      materiales: materiales.map(({ nombre }) => ({ nombre })),
    },
    predios: new Map(predios.map((p) => [p.codigo, p.id])),
    materiales: new Map(materiales.map((m) => [m.nombre, m.id])),
    m3: unidades[0]?.id ?? null,
  }
}

async function resolucionesGuardadas(tx: Conexion): Promise<Resoluciones | null> {
  const [fila] = await tx.consultar<{ transformaciones: unknown }>(
    `select transformaciones from mapeos_importacion
      where tipo = $1 and activo
      order by actualizado_en desc limit 1`,
    [TIPO],
  )
  return fila ? aResoluciones(fila.transformaciones) : null
}

/** Las claves que ya están vigentes en la base, de entre las que trae el archivo. */
async function clavesQueYaEstan(tx: Conexion, filas: FilaHistorica[]): Promise<Set<string>> {
  if (!filas.length) return new Set()
  const encontradas = await tx.consultar<{ importacion_clave: string }>(
    `select importacion_clave from movimientos
      where estado = 'vigente' and importacion_clave = any($1::text[])`,
    [filas.map((f) => f.clave)],
  )
  return new Set(encontradas.map((f) => f.importacion_clave))
}

// ── Errores ─────────────────────────────────────────────────────────────

function noSePudoLeer(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/[áéíóúñ¿¡«]/i.test(m)) return m
  return 'No se pudo leer el archivo. Fijate que sea el R-05 descargado como .xlsx, sin contraseña.'
}

function traducir(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('movimientos_importacion_clave_idx')) {
    return 'Otra persona importó estas mismas filas mientras las estabas importando vos. Previsualizá de nuevo: las que ya entraron no se vuelven a cargar.'
  }
  if (/statement timeout|canceling statement/i.test(m)) {
    return 'La base tardó demasiado en guardar tantas filas juntas y no se guardó ninguna. Elegí un período más corto —un año por vez— y probá de nuevo.'
  }
  return mensajeDeError(e)
}

// ── El análisis, para la pantalla ───────────────────────────────────────

interface Sistema {
  porMes: Map<string, Map<string, { m3: number; viajes: number }>>
  primerViaje: string | null
}

/** Lo que el sistema ya tiene vigente de ingresos a la Planta, por mes y predio. */
async function sistemaEnTx(tx: Conexion): Promise<Sistema> {
  const [filas, primero] = await Promise.all([
    tx.consultar<{ mes: string; codigo: string; m3: string; viajes: string }>(
      `select to_char(m.ocurrido_en at time zone 'America/Argentina/Tucuman', 'YYYY-MM') as mes,
              s.codigo,
              coalesce(sum(i.cantidad * coalesce(u.factor_m3, 0)), 0)::text as m3,
              count(distinct m.id)::text as viajes
         from movimientos m
         join sitios s on s.id = m.sitio_id
         join movimiento_items i on i.movimiento_id = m.id
         join unidades u on u.id = i.unidad_id
        where m.flujo = 'planta' and m.tipo = 'ingreso' and m.estado = 'vigente'
        group by 1, 2`,
    ),
    tx.consultar<{ dia: string | null }>(
      `select to_char(min(ocurrido_en) at time zone 'America/Argentina/Tucuman', 'YYYY-MM-DD') as dia
         from movimientos
        where flujo = 'planta' and tipo = 'ingreso' and estado = 'vigente' and importacion_id is null`,
    ),
  ])
  const porMes = new Map<string, Map<string, { m3: number; viajes: number }>>()
  for (const f of filas) {
    const mes = porMes.get(f.mes) ?? new Map()
    mes.set(f.codigo, { m3: Number(f.m3), viajes: Number(f.viajes) })
    porMes.set(f.mes, mes)
  }
  return { porMes, primerViaje: primero[0]?.dia ?? null }
}

function paraPantalla(
  a: Analisis,
  libro: LibroR05,
  catalogo: CatalogoPlanta,
  yaEstan: Set<string>,
  sistema: Sistema,
): AnalisisParaPantalla {
  const huerta = predioPorNombre('huerta', catalogo)
  const vivero = predioPorNombre('vivero', catalogo)

  // Lo que ya estaba se cuenta acá: el resumen del análisis no sabe qué hay en
  // la base.
  const yaEstabanPorMes = new Map<string, number>()
  let m3Nuevos = 0
  let filasNuevas = 0
  for (const f of a.filas) {
    if (yaEstan.has(f.clave)) {
      const llave = `${f.fecha.slice(0, 7)}|${f.predioCodigo}`
      yaEstabanPorMes.set(llave, (yaEstabanPorMes.get(llave) ?? 0) + 1)
    } else {
      m3Nuevos += f.m3
      filasNuevas++
    }
  }
  const delArchivo = new Map(a.porMes.map((m) => [m.mes, m.predios]))

  // Los meses de la tabla son los del archivo dentro del período, aunque no
  // entre ninguna fila: un mes en cero al lado de un indicador que dice 900 es
  // justo lo que hay que ver.
  const meses = new Set(a.porMes.map((m) => m.mes))
  if (libro.indicadores) {
    for (const mes of Object.keys(libro.indicadores)) {
      if (a.desde && a.hasta && mes >= a.desde.slice(0, 7) && mes <= a.hasta.slice(0, 7)) meses.add(mes)
    }
  }

  const porMes: MesEnPantalla[] = [...meses].sort().map((mes) => ({
    mes,
    predios: catalogo.predios.map(({ codigo }) => {
      const n = delArchivo.get(mes)?.[codigo]
      const ind = libro.indicadores?.[mes]
      const planilla = codigo === huerta ? ind?.huerta : codigo === vivero ? ind?.vivero : undefined
      const s = sistema.porMes.get(mes)?.get(codigo)
      return {
        codigo,
        m3: n?.m3 ?? 0,
        viajes: n?.viajes ?? 0,
        yaEstaban: yaEstabanPorMes.get(`${mes}|${codigo}`) ?? 0,
        planillaM3: planilla?.m3 ?? null,
        planillaViajes: planilla?.viajes ?? null,
        sistemaM3: Math.round((s?.m3 ?? 0) * 100) / 100,
        sistemaViajes: s?.viajes ?? 0,
      }
    }),
  }))

  const cuenta = new Map<string, number>()
  for (const r of a.rechazos) cuenta.set(r.motivo, (cuenta.get(r.motivo) ?? 0) + 1)

  return {
    filasConDatos: a.filasConDatos,
    filasNuevas,
    filasYaEstaban: a.filas.length - filasNuevas,
    m3Nuevos: Math.round(m3Nuevos * 100) / 100,
    desde: a.desde,
    hasta: a.hasta,
    primerMes: a.primerMes,
    ultimoMes: a.ultimoMes,
    fueraDelPeriodo: a.fueraDelPeriodo,
    filasVacias: a.filasVacias,
    formas: a.formas,
    cantidadesConTexto: a.cantidadesConTexto,
    pilaRepetiaCantidad: a.pilaRepetiaCantidad,
    hayIndicadores: Boolean(libro.indicadores),
    porMes,
    rechazos: a.rechazos.slice(0, TOPE_RECHAZOS),
    rechazosTotal: a.rechazos.length,
    motivos: [...cuenta.entries()].sort((x, y) => y[1] - x[1]),
    prediosSinResolver: a.prediosSinResolver,
    materialesSinResolver: a.materialesSinResolver,
    primerViajeDelSistema: sistema.primerViaje,
  }
}

// ── 1. Previsualizar ────────────────────────────────────────────────────

/** Lee el archivo y muestra qué entraría. No escribe nada. */
export async function previsualizar(
  _previo: unknown,
  fd: FormData,
): Promise<ResultadoPrevisualizar> {
  const sesion = await exigirAdminCompleto().catch(() => null)
  if (!sesion) return { ok: false, error: 'Se cerró la sesión. Entrá de nuevo.' }

  const archivo = await tomarArchivo(fd)
  if ('error' in archivo) return { ok: false, error: archivo.error }

  // El libro se abre antes de pedir la conexión: es lo lento, y no necesita
  // una transacción abierta esperando.
  let libro: LibroR05
  try {
    libro = await leerR05(archivo.datos)
  } catch (e) {
    return { ok: false, error: noSePudoLeer(e) }
  }

  try {
    return await conSesion(sesion, async (tx): Promise<ResultadoPrevisualizar> => {
      const [cat, guardadas, sistema] = await Promise.all([
        catalogoEnTx(tx), resolucionesGuardadas(tx), sistemaEnTx(tx),
      ])
      if (!cat.catalogo.predios.length) {
        return { ok: false, error: 'No hay ningún predio de la Planta en las listas maestras. Cargalos primero en Listas.' }
      }
      // Lo que la persona eligió en esta pasada manda; si todavía no eligió
      // nada, arranca con lo que quedó guardado de la vez anterior.
      const resoluciones = leerResoluciones(fd) ?? guardadas ?? { predios: {}, materiales: {} }
      const analisis = analizarR05(libro, resoluciones, cat.catalogo, leerPeriodo(fd), hoyEnTucuman(), archivo.nombre)
      const yaEstan = await clavesQueYaEstan(tx, analisis.filas)
      return {
        ok: true,
        analisis: paraPantalla(analisis, libro, cat.catalogo, yaEstan, sistema),
        resoluciones,
        catalogo: cat.catalogo,
      }
    })
  } catch (e) {
    return { ok: false, error: traducir(e) }
  }
}

// ── 2. Confirmar ────────────────────────────────────────────────────────

/** Los vehículos de las patentes que aparecen, creando los que falten. */
async function vehiculosEnTx(tx: Conexion, patentes: string[]): Promise<Map<string, string>> {
  if (!patentes.length) return new Map()
  await tx.consultar(
    `insert into vehiculos (patente, tipo)
     select distinct on (app.normalizar_patente(p)) p, 'camion'
       from unnest($1::text[]) p
      where not exists (select 1 from vehiculos v where v.patente_norm = app.normalizar_patente(p))`,
    [patentes],
  )
  const filas = await tx.consultar<{ patente: string; id: string }>(
    `select distinct on (p) p as patente, v.id
       from unnest($1::text[]) p
       join vehiculos v on v.patente_norm = app.normalizar_patente(p)
      order by p, v.activo desc, v.creado_en`,
    [patentes],
  )
  return new Map(filas.map((f) => [f.patente, f.id]))
}

/**
 * Guarda los viajes nuevos como movimientos de ingreso a la Planta.
 *
 * Todo en una sola transacción: si algo falla en la fila 3.000 no queda media
 * planilla cargada, que acá sería para siempre.
 */
export async function confirmar(_previo: unknown, fd: FormData): Promise<ResultadoConfirmar> {
  const sesion = await exigirAdminCompleto().catch(() => null)
  if (!sesion) return { ok: false, error: 'Se cerró la sesión. Entrá de nuevo.' }

  const archivo = await tomarArchivo(fd)
  if ('error' in archivo) return { ok: false, error: archivo.error }

  const resoluciones = leerResoluciones(fd)
  if (!resoluciones) {
    return { ok: false, error: 'Lo que elegiste sobre predios y corrientes llegó mal armado. Volvé a revisar.' }
  }
  const periodo = leerPeriodo(fd)

  let libro: LibroR05
  try {
    libro = await leerR05(archivo.datos)
  } catch (e) {
    return { ok: false, error: noSePudoLeer(e) }
  }

  try {
    const resultado = await conSesion(sesion, async (tx): Promise<ResultadoConfirmar> => {
      const cat = await catalogoEnTx(tx)
      if (!cat.m3) return { ok: false, error: 'No existe la unidad m³ en esta base. Avisale a la Dirección de IA.' }

      const analisis = analizarR05(libro, resoluciones, cat.catalogo, periodo, hoyEnTucuman(), archivo.nombre)
      const yaEstan = await clavesQueYaEstan(tx, analisis.filas)
      const nuevas = analisis.filas.filter((f) => !yaEstan.has(f.clave))

      if (!nuevas.length) {
        return {
          ok: false,
          error: analisis.filas.length
            ? `No hay nada nuevo para cargar: las ${analisis.filas.length} filas de este período ya están en el sistema.`
            : 'No quedó ninguna fila para cargar en este período. Revisá el período y lo que quedó sin resolver.',
        }
      }

      // Sin hash del archivo, a propósito. En los pesos es el portero contra el
      // archivo repetido, y su índice único prohibiría cargar otro período del
      // mismo archivo. Acá el portero es la clave de cada fila, que además ve
      // las filas repetidas entre dos archivos distintos.

      // El mapeo guarda lo que se decidió sobre predios y corrientes, para que
      // el mes que viene ya venga resuelto.
      const [mapeo] = await tx.consultar<{ id: string }>(
        `insert into mapeos_importacion
           (nombre, tipo, columnas, transformaciones, hoja, fila_encabezado, activo, creado_por_id)
         values ($1, $2, '{}'::jsonb, $3::jsonb, $4, 1, true, $5)
         on conflict (lower(nombre)) do update
            set transformaciones = excluded.transformaciones, activo = true
         returning id`,
        [NOMBRE_MAPEO, TIPO, JSON.stringify(resoluciones), HOJA_R05, sesion.perfilId],
      )

      const desde = nuevas.reduce((x, f) => (f.fecha < x ? f.fecha : x), nuevas[0].fecha)
      const hasta = nuevas.reduce((x, f) => (f.fecha > x ? f.fecha : x), nuevas[0].fecha)
      const [importacion] = await tx.consultar<{ id: string }>(
        `insert into importaciones
           (mapeo_id, tipo, archivo_nombre, periodo_desde, periodo_hasta,
            filas_ok, filas_error, errores, estado, importado_por_id)
         values ($1, $2, $3, $4::date, $5::date, 0, $6, $7::jsonb, 'confirmada', $8)
         returning id`,
        [mapeo.id, TIPO, archivo.nombre, desde, hasta, analisis.rechazos.length,
         JSON.stringify(analisis.rechazos.slice(0, TOPE_RECHAZOS)), sesion.perfilId],
      )

      const vehiculos = await vehiculosEnTx(
        tx, [...new Set(nuevas.map((f) => f.patente).filter((p): p is string => !!p))],
      )

      let guardadas = 0
      let m3 = 0
      for (let i = 0; i < nuevas.length; i += LOTE) {
        const lote = nuevas.slice(i, i + LOTE)
        const valores: unknown[] = [importacion.id, sesion.perfilId]
        const tuplas = lote.map((f) => {
          const p = (v: unknown) => `$${valores.push(v)}`
          // Sin hora en la planilla, el viaje va al mediodía: cualquier hora
          // del día lo deja en el mismo día de Tucumán, y el mediodía es la que
          // más lejos queda de correrlo al anterior o al siguiente.
          const ocurrido = `${f.fecha}T${f.hora ?? '12:00'}:00-03:00`
          const sitio = p(cat.predios.get(f.predioCodigo))
          return `('planta', 'ingreso', ${sitio}::uuid, ${p(ocurrido)}::timestamptz, true,
                   'texto', ${p(f.origen)}, 'sitio', ${sitio}::uuid,
                   ${p(f.patente ? vehiculos.get(f.patente) ?? null : null)}::uuid,
                   ${p(f.vigilador)}, ${p(f.observaciones)}, $2::uuid, $1::uuid, ${p(f.clave)})`
        })
        // carga_diferida en true: el viaje se anotó en papel o en la planilla y
        // entra al sistema meses después. Sin esto, el detalle decía «Cargado
        // en el momento» de un viaje de 2024.
        const insertados = await tx.consultar<{ id: string; importacion_clave: string }>(
          `insert into movimientos (
             flujo, tipo, sitio_id, ocurrido_en, carga_diferida,
             origen_clase, origen_detalle, destino_clase, destino_sitio_id,
             vehiculo_id, registrado_por, observaciones, cargado_por_id,
             importacion_id, importacion_clave
           ) values ${tuplas.join(', ')}
           on conflict (importacion_clave) where estado = 'vigente' do nothing
           returning id, importacion_clave`,
          valores,
        )
        if (!insertados.length) continue

        const porClave = new Map(lote.map((f) => [f.clave, f]))
        const items: unknown[] = [cat.m3]
        const tuplasItems = insertados.map((mov) => {
          const f = porClave.get(mov.importacion_clave)!
          const p = (v: unknown) => `$${items.push(v)}`
          m3 += f.m3
          return `(${p(mov.id)}::uuid, ${p(cat.materiales.get(f.materialNombre))}::uuid, ${p(f.m3)}, $1::uuid)`
        })
        await tx.consultar(
          `insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id)
           values ${tuplasItems.join(', ')}`,
          items,
        )
        guardadas += insertados.length
      }

      await tx.consultar(`update importaciones set filas_ok = $2 where id = $1`, [importacion.id, guardadas])

      return {
        ok: true,
        id: importacion.id,
        filas: guardadas,
        m3: Math.round(m3 * 100) / 100,
        yaEstaban: analisis.filas.length - guardadas,
        desde,
        hasta,
      }
    })

    if (resultado.ok) {
      revalidatePath('/importar/historico')
      revalidatePath('/tablero')
      revalidatePath('/movimientos')
    }
    return resultado
  } catch (e) {
    return { ok: false, error: traducir(e) }
  }
}

// ── 3. Revertir ─────────────────────────────────────────────────────────

/**
 * Anula todos los movimientos vigentes de una importación del histórico y la
 * marca como revertida. Nada se borra: cada movimiento queda anulado con su
 * motivo y con quién lo hizo, igual que si lo hubiera anulado a mano.
 */
export async function revertir(
  _previo: unknown,
  fd: FormData,
): Promise<{ ok: boolean; error?: string; anulados?: number }> {
  const sesion = await exigirAdminCompleto().catch(() => null)
  if (!sesion) return { ok: false, error: 'Se cerró la sesión. Entrá de nuevo.' }

  const id = texto(fd, 'id')
  if (!UUID.test(id)) return { ok: false, error: 'No se pudo identificar la importación. Actualizá la pantalla.' }

  try {
    const anulados = await conSesion(sesion, async (tx) => {
      const [imp] = await tx.consultar<{ archivo_nombre: string }>(
        `update importaciones set estado = 'revertida'
          where id = $1 and estado = 'confirmada' and tipo = $2
          returning archivo_nombre`,
        [id, TIPO],
      )
      if (!imp) return null
      const filas = await tx.consultar<{ id: string }>(
        `update movimientos
            set estado = 'anulado',
                motivo_anulacion = $2,
                anulado_por_id = $3,
                anulado_en = now()
          where importacion_id = $1 and estado = 'vigente'
          returning id`,
        [id, `Se revirtió la importación del histórico «${imp.archivo_nombre}».`, sesion.perfilId],
      )
      return filas.length
    })
    if (anulados === null) {
      return { ok: false, error: 'Esa importación ya estaba revertida, o no existe. Actualizá la pantalla.' }
    }
    revalidatePath('/importar/historico')
    revalidatePath('/tablero')
    revalidatePath('/movimientos')
    return { ok: true, anulados }
  } catch (e) {
    return { ok: false, error: traducir(e) }
  }
}
