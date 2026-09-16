/**
 * Capa de datos. Todo pasa por conSesion(), así que las políticas de
 * 0010_rls.sql se aplican siempre: si acá se escapa un filtro, la base
 * igual no devuelve lo que no corresponde.
 */
import 'server-only'
import { conSesion, consultarConSesion, type Sesion } from '@db/sesion'
import type {
  DestinoAFormalizar, Entidad, FilaResumen, FilaValorizacion, FilaVecinos, FiltrosMovimientos,
  ItemListado, ListasDelFormulario,
  Material, MovimientoListado, MovimientoNuevo, Persona, Sitio, TipoMovimiento,
  Unidad, Vehiculo, Flujo,
} from './tipos'

// ── Listas del formulario ───────────────────────────────────────────────

/**
 * Trae en una sola ida todo lo que el celular necesita para armar el
 * formulario. Los materiales ya vienen filtrados por flujo y por si entran o
 * salen: compost no aparece en un ingreso a Planta, y por eso no se puede
 * elegir por error.
 */
export async function listasDelFormulario(
  sesion: Sesion,
  flujo: Flujo,
  tipo: TipoMovimiento,
): Promise<ListasDelFormulario> {
  return conSesion(sesion, async (tx) => {
    const sitioId = sesion.rol === 'admin' ? null : sesion.sitioId

    const [sitio] = await tx.consultar<Sitio>(
      sitioId
        ? `select id, codigo, nombre, tipo, direccion, orden, activo from sitios where id = $1`
        : `select id, codigo, nombre, tipo, direccion, orden, activo from sitios
            where tipo = case when $1::text = 'planta' then 'planta' else 'punto_verde' end
            order by orden limit 1`,
      [sitioId ?? flujo],
    )

    const unidades = await tx.consultar<Unidad>(
      `select id, codigo, nombre, nombre_plural, decimales, factor_m3, orden, activo
         from unidades where activo order by orden`,
    )
    const porUnidad = new Map(unidades.map((u) => [u.id, u]))

    const materialesCrudos = await tx.consultar<Material>(
      `select id, nombre, categoria, flujos, tipos, unidad_default_id,
              unidades_permitidas, sugerencias, color, orden, activo
         from materiales
        where activo
          and (cardinality(flujos) = 0 or $1 = any(flujos))
          and $2 = any(tipos)
        order by orden, nombre`,
      [flujo, tipo],
    )
    const materiales = materialesCrudos.map((m) => {
      const permitidas = (m.unidades_permitidas ?? [])
        .map((id) => porUnidad.get(id))
        .filter((u): u is Unidad => Boolean(u))
      return {
        ...m,
        sugerencias: (m.sugerencias ?? []).map(Number),
        unidad: porUnidad.get(m.unidad_default_id),
        // Si un material no declara recipientes, queda al menos el suyo: el
        // formulario nunca puede quedarse sin ninguno para ofrecer.
        recipientes: permitidas.length
          ? permitidas
          : [porUnidad.get(m.unidad_default_id)].filter((u): u is Unidad => Boolean(u)),
      }
    })

    // Vista pública: sin CUIT ni teléfono.
    const entidades = await tx.consultar<Entidad>(
      `select id, nombre, tipo, habilitada_origen, habilitada_destino, flujos,
              activo, pendiente_revision
         from entidades_publicas
        where cardinality(flujos) = 0 or $1 = any(flujos)
        order by nombre`,
      [flujo],
    )

    const vehiculos = await tx.consultar<Vehiculo>(
      `select id, patente, tipo, capacidad_m3, activo from vehiculos where activo order by patente`,
    )

    const personas = await tx.consultar<Persona>(
      `select id, nombre, rol, sitio_id, activo from personas_publicas order by nombre`,
    )

    return {
      sitio,
      materiales,
      unidades,
      origenes: entidades.filter((e) => e.habilitada_origen),
      destinos: entidades.filter((e) => e.habilitada_destino),
      vehiculos,
      choferes: personas.filter((p) => p.rol === 'chofer'),
      autorizantes: personas.filter((p) => p.rol === 'autorizante'),
      vigiladores: personas.filter(
        (p) => p.rol === 'vigilador' && (!sitio || !p.sitio_id || p.sitio_id === sitio.id),
      ),
    }
  })
}

// ── Alta de movimiento ──────────────────────────────────────────────────

export interface ResultadoAlta {
  ok: boolean
  id?: string
  numero?: number
  duplicado?: boolean
  error?: string
}

/**
 * Cabecera e ítems en la misma transacción: o entra todo o no entra nada.
 *
 * client_uuid hace el alta idempotente. Si el celular reintenta porque se
 * cortó la señal justo después de enviar, la segunda vez devuelve el mismo
 * movimiento en vez de duplicarlo.
 */
export async function crearMovimiento(
  sesion: Sesion,
  datos: MovimientoNuevo,
): Promise<ResultadoAlta> {
  if (!datos.items?.length) {
    return { ok: false, error: 'Falta cargar al menos un material.' }
  }
  if (datos.items.some((i) => !(Number(i.cantidad) > 0))) {
    return { ok: false, error: 'La cantidad tiene que ser mayor que cero.' }
  }

  try {
    return await conSesion(sesion, async (tx) => {
      const yaEsta = await tx.consultar<{ id: string; numero: number }>(
        `select id, numero from movimientos where client_uuid = $1`,
        [datos.client_uuid],
      )
      if (yaEsta[0]) return { ok: true, ...yaEsta[0], duplicado: true }

      const sitioId = sesion.rol === 'admin' ? datos.destino_sitio_id ?? datos.origen_sitio_id : sesion.sitioId
      if (!sitioId) return { ok: false, error: 'No se pudo determinar el sitio del movimiento.' }

      // El vecino llega con datos, no con id: el vigilador no puede leer la
      // lista. app.registrar_vecino decide si es alguien que ya vino (lo busca
      // por teléfono) o uno nuevo, y devuelve solo el id.
      let vecinoId: string | null = null
      if (datos.vecino) {
        const [fila] = await tx.consultar<{ id: string }>(
          'select app.registrar_vecino($1, $2, $3, $4) as id',
          [
            datos.vecino.nombre ?? null,
            datos.vecino.telefono ?? null,
            datos.vecino.barrio ?? null,
            sitioId,
          ],
        )
        vecinoId = fila.id
      }

      // Alta en la calle de un carrero o emprendedor. Va por la misma puerta
      // que el vecino: una función definidora que valida el tipo, fuerza las
      // banderas y devuelve solo el id. Un insert directo no serviría — el
      // RETURNING necesita permiso de lectura sobre entidades, que el vigilador
      // no tiene.
      let entidadNuevaId: string | null = null
      if (datos.entidad_nueva) {
        const [fila] = await tx.consultar<{ id: string }>(
          'select app.registrar_entidad_rapida($1, $2, $3) as id',
          [datos.entidad_nueva.nombre, datos.entidad_nueva.tipo, datos.flujo],
        )
        entidadNuevaId = fila.id
      }

      // Un ingreso lo trae el vecino; una salida se la lleva él.
      const esIngreso = datos.tipo === 'ingreso'
      const origenVecino  = esIngreso ? vecinoId : (datos.origen_vecino_id ?? null)
      const destinoVecino = esIngreso ? (datos.destino_vecino_id ?? null) : vecinoId
      const origenEntidad  = datos.origen_entidad_id ?? null
      const destinoEntidad = datos.destino_entidad_id ?? entidadNuevaId
      const origenClase  = origenVecino  ? 'vecino' : datos.origen_clase
      const destinoClase = destinoVecino ? 'vecino' : (entidadNuevaId ? 'entidad' : datos.destino_clase)

      const [mov] = await tx.consultar<{ id: string; numero: number }>(
        `insert into movimientos (
           flujo, tipo, sitio_id, ocurrido_en,
           origen_clase, origen_sitio_id, origen_entidad_id, origen_vecino_id, origen_detalle,
           destino_clase, destino_sitio_id, destino_entidad_id, destino_vecino_id, destino_detalle,
           vehiculo_id, chofer_id, autorizado_por_id, vigilador_id,
           tipo_valorizacion, vecino_sin_datos, observaciones,
           cargado_por_id, client_uuid
         ) values (
           $1, $2, $3, $4,
           $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14,
           $15, $16, $17, $18,
           $19, $20, $21,
           $22, $23
         ) returning id, numero`,
        [
          datos.flujo, datos.tipo, sitioId, datos.ocurrido_en,
          origenClase, datos.origen_sitio_id ?? null, origenEntidad,
          origenVecino, datos.origen_detalle ?? null,
          destinoClase, datos.destino_sitio_id ?? null, destinoEntidad,
          destinoVecino, datos.destino_detalle ?? null,
          datos.vehiculo_id ?? null, datos.chofer_id ?? null,
          datos.autorizado_por_id ?? null, datos.vigilador_id ?? null,
          datos.tipo_valorizacion ?? null, datos.vecino?.sin_datos ?? datos.vecino_sin_datos ?? false,
          datos.observaciones?.trim() || null,
          sesion.perfilId, datos.client_uuid,
        ],
      )

      for (const item of datos.items) {
        await tx.consultar(
          `insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id, observacion)
           values ($1, $2, $3, $4, $5)`,
          [mov.id, item.material_id, item.cantidad, item.unidad_id, item.observacion ?? null],
        )
      }

      return { ok: true, id: mov.id, numero: mov.numero }
    })
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) }
  }
}

/** Traduce los errores de la base a algo que se pueda leer en la pantalla. */
export function mensajeDeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('row-level security')) {
    return 'No tenés permiso para registrar eso en este punto.'
  }
  if (m.includes('48 horas')) {
    return 'No se puede cargar un movimiento de más de 48 horas atrás. Pedile a la coordinadora que lo cargue.'
  }
  if (m.includes('futuro')) return 'La fecha no puede estar en el futuro.'
  if (m.includes('movimiento_items_movimiento_id_material_id_key')) {
    return 'Ese material ya está cargado en este movimiento.'
  }
  if (m.includes('permission denied')) return 'No tenés permiso para hacer eso.'
  if (m.includes('origen_coherente') || m.includes('destino_coherente')) {
    return 'Falta indicar de dónde viene o a dónde va.'
  }
  return 'No se pudo guardar. Probá de nuevo; si sigue fallando, avisale a la coordinadora.'
}

// ── Anulación ───────────────────────────────────────────────────────────

export async function anularMovimiento(
  sesion: Sesion,
  id: string,
  motivo: string,
): Promise<{ ok: boolean; error?: string }> {
  const limpio = motivo.trim()
  if (limpio.length < 5) return { ok: false, error: 'El motivo tiene que decir algo (mínimo 5 caracteres).' }

  try {
    const filas = await consultarConSesion<{ id: string }>(
      sesion,
      `update movimientos
          set estado = 'anulado', motivo_anulacion = $2,
              anulado_por_id = $3, anulado_en = now()
        where id = $1 and estado = 'vigente'
        returning id`,
      [id, limpio, sesion.perfilId],
    )
    if (!filas.length) {
      return {
        ok: false,
        error: sesion.rol === 'admin'
          ? 'Ese movimiento no existe o ya estaba anulado.'
          : 'Pasaron más de diez minutos. Pedile la anulación a la coordinadora.',
      }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) }
  }
}

// ── Consultas de listado ────────────────────────────────────────────────

const COLUMNAS_MOV = `
  id, numero, flujo, tipo, estado, ocurrido_en, carga_diferida, creado_en,
  observaciones, tipo_valorizacion, vecino_sin_datos, motivo_anulacion, anulado_en,
  sitio_id, sitio_nombre, sitio_codigo,
  origen_clase, origen_nombre, destino_clase, destino_nombre, destino_entidad_tipo,
  patente, vehiculo_tipo, chofer_nombre, autorizante_nombre, vigilador_nombre,
  cargado_por_nombre, cargado_por_id, items, materiales, cantidad_total,
  unidad_nombre, unidad_plural, unidad_decimales`

/**
 * Arma el WHERE de los filtros del listado. Devuelve texto y parámetros.
 * `par(valor)` agrega un parámetro y devuelve su marcador, así el número nunca
 * se escribe a mano y reusar el mismo valor en tres columnas es trivial.
 */
function armarFiltros(f: FiltrosMovimientos) {
  const valores: unknown[] = []
  const par = (valor: unknown) => `$${valores.push(valor)}`
  const cond: string[] = []

  if (f.flujo)   cond.push(`flujo = ${par(f.flujo)}`)
  if (f.tipo)    cond.push(`tipo = ${par(f.tipo)}`)
  if (f.sitioId) cond.push(`sitio_id = ${par(f.sitioId)}`)
  if (f.desde)   cond.push(`ocurrido_en >= ${par(f.desde)}::timestamptz`)
  if (f.hasta)   cond.push(`ocurrido_en < (${par(f.hasta)}::date + interval '1 day')`)
  if (f.patente) cond.push(`patente ilike ${par(`%${f.patente}%`)}`)
  if (f.destinoId) {
    cond.push(`destino_nombre = (select nombre from entidades_publicas where id = ${par(f.destinoId)})`)
  }
  if (f.texto) {
    const t = par(`%${f.texto}%`)
    cond.push(`(materiales ilike ${t} or origen_nombre ilike ${t} or destino_nombre ilike ${t})`)
  }
  if (f.materialId) {
    cond.push(
      `exists (select 1 from movimiento_items mi
                where mi.movimiento_id = v_movimientos.id
                  and mi.material_id = ${par(f.materialId)})`,
    )
  }

  const estado = f.estado ?? 'vigente'
  if (estado !== 'todos') cond.push(`estado = ${par(estado)}`)

  return { where: cond.length ? `where ${cond.join(' and ')}` : '', par: valores }
}

export async function buscarMovimientos(
  sesion: Sesion,
  filtros: FiltrosMovimientos = {},
): Promise<{ filas: MovimientoListado[]; total: number }> {
  const { where, par } = armarFiltros(filtros)
  const porPagina = Math.min(Math.max(filtros.porPagina ?? 50, 1), 500)
  const pagina = Math.max(filtros.pagina ?? 1, 1)

  return conSesion(sesion, async (tx) => {
    const [{ total }] = await tx.consultar<{ total: string }>(
      `select count(*)::text as total from v_movimientos ${where}`, par,
    )
    const filas = await tx.consultar<MovimientoListado>(
      `select ${COLUMNAS_MOV} from v_movimientos ${where}
        order by ocurrido_en desc, numero desc
        limit ${porPagina} offset ${(pagina - 1) * porPagina}`,
      par,
    )
    return { filas, total: Number(total) }
  })
}

/** Sin paginar. Solo para exportar. */
export async function movimientosParaExportar(
  sesion: Sesion,
  filtros: FiltrosMovimientos = {},
): Promise<ItemListado[]> {
  const { where, par } = armarFiltros(filtros)
  const sub = `select id from v_movimientos ${where}`
  return consultarConSesion<ItemListado>(
    sesion,
    `select i.* from v_movimiento_items i
      where i.movimiento_id in (${sub})
      order by i.ocurrido_en desc, i.numero desc`,
    par,
  )
}

export async function movimientoPorId(
  sesion: Sesion,
  id: string,
): Promise<{ movimiento: MovimientoListado; items: ItemListado[] } | null> {
  return conSesion(sesion, async (tx) => {
    const [movimiento] = await tx.consultar<MovimientoListado>(
      `select ${COLUMNAS_MOV} from v_movimientos where id = $1`, [id],
    )
    if (!movimiento) return null
    const items = await tx.consultar<ItemListado>(
      `select * from v_movimiento_items where movimiento_id = $1 order by material_nombre`, [id],
    )
    return { movimiento, items }
  })
}

/** Lo cargado en el turno: desde las 0 h de hoy, hora de Tucumán. */
export async function movimientosDelTurno(sesion: Sesion, limite = 30) {
  return consultarConSesion<MovimientoListado>(
    sesion,
    `select ${COLUMNAS_MOV} from v_movimientos
      where estado in ('vigente', 'anulado')
        and creado_en >= date_trunc('day', now() at time zone 'America/Argentina/Tucuman')
                         at time zone 'America/Argentina/Tucuman'
      order by creado_en desc
      limit ${Math.min(limite, 100)}`,
  )
}

// ── Tablero ─────────────────────────────────────────────────────────────

export async function resumenMensual(
  sesion: Sesion,
  opciones: { flujo?: Flujo; sitioId?: string; meses?: number } = {},
): Promise<FilaResumen[]> {
  const meses = Math.min(Math.max(opciones.meses ?? 6, 1), 36)
  const cond = ["mes >= date_trunc('month', current_date) - make_interval(months => $1)"]
  const par: unknown[] = [meses - 1]
  if (opciones.flujo)   { par.push(opciones.flujo);   cond.push(`flujo = $${par.length}`) }
  if (opciones.sitioId) { par.push(opciones.sitioId); cond.push(`sitio_id = $${par.length}`) }

  return consultarConSesion<FilaResumen>(
    sesion,
    `select * from v_resumen_mensual where ${cond.join(' and ')} order by mes, material_nombre`,
    par,
  )
}

export async function sitiosVisibles(sesion: Sesion): Promise<Sitio[]> {
  return consultarConSesion<Sitio>(
    sesion,
    `select id, codigo, nombre, tipo, direccion, orden, activo from sitios
      where activo order by orden`,
  )
}

export async function materialesVisibles(sesion: Sesion): Promise<Material[]> {
  return consultarConSesion<Material>(
    sesion,
    `select id, nombre, categoria, flujos, tipos, unidad_default_id, sugerencias, color, orden, activo
       from materiales where activo order by orden, nombre`,
  )
}

// ── Puntos Verdes ───────────────────────────────────────────────────────

/**
 * Visitas y vecinos identificados por punto.
 *
 * Son dos números distintos y no se suman: una visita es alguien que vino una
 * vez; un vecino identificado es alguien que dejó el teléfono y se lo puede
 * seguir en el tiempo. Quien vino cuatro veces son cuatro visitas y un vecino.
 */
export async function resumenVecinos(
  sesion: Sesion,
  opciones: { periodo?: 'semana' | 'mes'; sitioId?: string; desde?: string } = {},
): Promise<FilaVecinos[]> {
  const periodo = opciones.periodo === 'semana' ? 'semana' : 'mes'
  const valores: unknown[] = []
  const par = (v: unknown) => `$${valores.push(v)}`
  const cond = [`${periodo} >= ${par(opciones.desde ?? '2000-01-01')}::date`]
  if (opciones.sitioId) cond.push(`sitio_id = ${par(opciones.sitioId)}`)

  return consultarConSesion<FilaVecinos>(
    sesion,
    `select sitio_id, sitio_nombre, sitio_codigo, semana, mes,
            sum(visitas)::int       as visitas,
            sum(sin_datos)::int     as sin_datos,
            sum(identificados)::int as identificados
       from v_vecinos_por_periodo
      where ${cond.join(' and ')}
      group by sitio_id, sitio_nombre, sitio_codigo, semana, mes
      order by ${periodo} desc, sitio_codigo`,
    valores,
  )
}

/** Material recirculado por tipo de valorización. */
export async function resumenValorizacion(
  sesion: Sesion,
  opciones: { flujo?: Flujo; sitioId?: string; meses?: number } = {},
): Promise<FilaValorizacion[]> {
  const meses = Math.min(Math.max(opciones.meses ?? 6, 1), 36)
  const valores: unknown[] = [meses - 1]
  const par = (v: unknown) => `$${valores.push(v)}`
  const cond = ["mes >= date_trunc('month', current_date) - make_interval(months => $1)"]
  if (opciones.flujo)   cond.push(`flujo = ${par(opciones.flujo)}`)
  if (opciones.sitioId) cond.push(`sitio_id = ${par(opciones.sitioId)}`)

  return consultarConSesion<FilaValorizacion>(
    sesion,
    `select * from v_valorizacion where ${cond.join(' and ')} order by mes, tipo_valorizacion`,
    valores,
  )
}

/** Lo que los vigiladores dieron de alta en la calle y falta confirmar. */
export async function entidadesPendientes(sesion: Sesion) {
  return consultarConSesion<{
    id: string; nombre: string; tipo: string; creado_en: string
    creado_por: string | null; usos: number
  }>(
    sesion,
    `select e.id, e.nombre, e.tipo, e.creado_en, p.nombre as creado_por,
            (select count(*) from movimientos m
              where m.destino_entidad_id = e.id or m.origen_entidad_id = e.id)::int as usos
       from entidades e
       left join perfiles p on p.id = e.creado_por_id
      where e.pendiente_revision and e.activo
      order by e.creado_en desc`,
  )
}

/**
 * Los destinos que el vigilador tuvo que escribir porque no estaban en la lista.
 *
 * No existe hoy una lista formal de destinos habilitados: el chofer le dice al
 * portero adónde lleva el material. Esta consulta es la materia prima para
 * formalizarla de a poco — si un destino aparece diez veces, merece ser opción.
 */
export async function destinosAFormalizar(sesion: Sesion): Promise<DestinoAFormalizar[]> {
  return consultarConSesion<DestinoAFormalizar>(
    sesion,
    'select * from v_destinos_a_formalizar order by veces desc, ultima_vez desc',
  )
}
