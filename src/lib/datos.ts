/**
 * Capa de datos. Todo pasa por conSesion(), así que las políticas de
 * 0010_rls.sql se aplican siempre: si acá se escapa un filtro, la base
 * igual no devuelve lo que no corresponde.
 */
import 'server-only'
import { conSesion, consultarConSesion, type Sesion } from '@db/sesion'
import type {
  Contenedor, ConteoDiario, ControlDePila, DestinoAFormalizar, Entidad,
  EstadoPedido, EstadoPila, PedidoRecambio, RespuestaRecambio,
  FilaComposicion, FilaPila, PuntoSinCarga,
  FilaResumen, FilaValorizacion, FilaVecinos, FiltrosMovimientos, TipoControl, TrazaDeSalida,
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

    // Ninguna de las seis usa el resultado de la anterior: los cruces —unidades
    // contra materiales, sitio contra vigiladores— se hacen abajo en JS. Pedidas
    // juntas, la transacción las manda de una vez en lugar de esperar seis idas
    // y vueltas, que es lo que el celular sentía al abrir el formulario.
    const [
      [sitio], unidades, materialesCrudos, entidades, vehiculos, personas,
    ] = await Promise.all([
      tx.consultar<Sitio>(
        sitioId
          ? `select id, codigo, nombre, tipo, direccion, orden, activo, carga_detallada
               from sitios where id = $1`
          : `select id, codigo, nombre, tipo, direccion, orden, activo, carga_detallada
               from sitios
              where tipo = case when $1::text = 'planta' then 'planta' else 'punto_verde' end
              order by orden limit 1`,
        [sitioId ?? flujo],
      ),
      tx.consultar<Unidad>(
        `select id, codigo, nombre, nombre_plural, decimales, factor_m3, orden, activo
           from unidades where activo order by orden`,
      ),
      tx.consultar<Material>(
        `select id, nombre, categoria, flujos, tipos, unidad_default_id,
                unidades_permitidas, sugerencias, color, orden, activo
           from materiales
          where activo
            and (cardinality(flujos) = 0 or $1 = any(flujos))
            and $2 = any(tipos)
          order by orden, nombre`,
        [flujo, tipo],
      ),
      // Vista pública: sin CUIT ni teléfono.
      tx.consultar<Entidad>(
        `select id, nombre, tipo, habilitada_origen, habilitada_destino, flujos,
                activo, pendiente_revision
           from entidades_publicas
          where cardinality(flujos) = 0 or $1 = any(flujos)
          order by nombre`,
        [flujo],
      ),
      tx.consultar<Vehiculo>(
        `select id, patente, tipo, capacidad_m3, activo from vehiculos where activo order by patente`,
      ),
      tx.consultar<Persona>(
        `select id, nombre, rol, sitio_id, activo from personas_publicas order by nombre`,
      ),
    ])

    const porUnidad = new Map(unidades.map((u) => [u.id, u]))

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
           tipo_valorizacion, vecino_sin_datos, observaciones, pila_id,
           cargado_por_id, client_uuid
         ) values (
           $1, $2, $3, $4,
           $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14,
           $15, $16, $17, $18,
           $19, $20, $21, $22,
           $23, $24
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
          datos.pila_id ?? null,
          sesion.perfilId, datos.client_uuid,
        ],
      )

      // Todos los ítems en un solo insert. De a uno eran tantas idas a la base
      // como materiales cargados, y esta es la única espera que el vigilador
      // hace parado en la calle. El $1 se repite en cada fila porque el
      // movimiento es el mismo; el resto se numera solo, como en armarFiltros.
      const valores: unknown[] = [mov.id]
      const filas = datos.items.map((item) => {
        const campos = [item.material_id, item.cantidad, item.unidad_id, item.observacion ?? null]
          .map((v) => `$${valores.push(v)}`)
        return `($1, ${campos.join(', ')})`
      })
      await tx.consultar(
        `insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id, observacion)
         values ${filas.join(', ')}`,
        valores,
      )

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
    // El offset sale de la página pedida, no del total, así que el conteo no
    // condiciona al listado y las dos pueden ir juntas. `par` se pasa a las dos:
    // ni postgres-js ni PGlite escriben sobre el arreglo que reciben (cada uno
    // se copia los valores antes de serializarlos).
    const [[{ total }], filas] = await Promise.all([
      tx.consultar<{ total: string }>(
        `select count(*)::text as total from v_movimientos ${where}`, par,
      ),
      tx.consultar<MovimientoListado>(
        `select ${COLUMNAS_MOV} from v_movimientos ${where}
          order by ocurrido_en desc, numero desc
          limit ${porPagina} offset ${(pagina - 1) * porPagina}`,
        par,
      ),
    ])
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
    // Los ítems filtran por el id que llega, no por la cabecera: van juntas. Si
    // el movimiento no aparece, los ítems tampoco —las dos pasan por RLS— y el
    // resultado se descarta igual.
    const [[movimiento], items] = await Promise.all([
      tx.consultar<MovimientoListado>(
        `select ${COLUMNAS_MOV} from v_movimientos where id = $1`, [id],
      ),
      tx.consultar<ItemListado>(
        `select * from v_movimiento_items where movimiento_id = $1 order by material_nombre`, [id],
      ),
    ])
    if (!movimiento) return null
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
    `select sitio_id, sitio_nombre, sitio_codigo, carga_detallada, semana, mes,
            sum(visitas)::int       as visitas,
            sum(sin_datos)::int     as sin_datos,
            sum(identificados)::int as identificados,
            sum(contadas)::int      as contadas
       from v_vecinos_por_periodo
      where ${cond.join(' and ')}
      group by sitio_id, sitio_nombre, sitio_codigo, carga_detallada, semana, mes
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

// ── Pilas de compost ────────────────────────────────────────────────────

/**
 * El estado de las pilas.
 *
 * Es la respuesta a "el control operativo de las pilas", que la Secretaría
 * nombró como una de las dos cosas que hoy le piden y no puede contestar.
 */
export async function pilas(
  sesion: Sesion,
  opciones: { sitioId?: string; estado?: EstadoPila; incluirBajas?: boolean } = {},
): Promise<FilaPila[]> {
  const valores: unknown[] = []
  const par = (v: unknown) => `$${valores.push(v)}`
  const cond: string[] = []
  if (!opciones.incluirBajas) cond.push('activo')
  if (opciones.sitioId) cond.push(`sitio_id = ${par(opciones.sitioId)}`)
  if (opciones.estado)  cond.push(`estado = ${par(opciones.estado)}`)

  return consultarConSesion<FilaPila>(
    sesion,
    `select * from v_pilas
      ${cond.length ? `where ${cond.join(' and ')}` : ''}
      order by estado, codigo`,
    valores,
  )
}

/** Las que todavía reciben material. Es lo que ofrece el formulario del celular. */
export async function pilasEnFormacion(sesion: Sesion): Promise<FilaPila[]> {
  return consultarConSesion<FilaPila>(
    sesion,
    "select * from v_pilas where activo and estado = 'en_formacion' order by codigo",
  )
}

/** Las que ya pueden despacharse. */
export async function pilasParaDespachar(sesion: Sesion): Promise<FilaPila[]> {
  return consultarConSesion<FilaPila>(
    sesion,
    "select * from v_pilas where activo and estado in ('madurando', 'lista') order by madurez nulls last, codigo",
  )
}

/**
 * La ficha completa de una pila: de qué está hecha, cómo se la trató y qué
 * salió de ella. Las tres puntas de la cadena en una sola consulta.
 */
export async function pilaPorId(sesion: Sesion, id: string) {
  return conSesion(sesion, async (tx) => {
    // Las tres puntas cuelgan del id que llega, no de la fila `pila`: se piden
    // juntas y recién después se decide si la pila existe. Si no existe, las
    // otras tampoco devuelven nada —RLS se aplica a cada una— y se descartan.
    const [[pila], composicion, controles, salidas] = await Promise.all([
      tx.consultar<FilaPila>('select * from v_pilas where id = $1', [id]),
      tx.consultar<FilaComposicion>(
        'select * from v_pila_composicion where pila_id = $1 order by m3 desc',
        [id],
      ),
      tx.consultar<ControlDePila>(
        `select c.id, c.pila_id, c.tipo, c.ocurrido_en, c.valor, c.observacion, p.nombre as registrado_por
           from pila_controles c
           left join perfiles p on p.id = c.registrado_por_id
          where c.pila_id = $1
          order by c.ocurrido_en desc`,
        [id],
      ),
      tx.consultar<TrazaDeSalida>(
        'select * from v_trazabilidad_salidas where pila_id = $1 order by ocurrido_en desc',
        [id],
      ),
    ])
    if (!pila) return null

    return { pila, composicion, controles, salidas }
  })
}

/** De dónde salió este camión. */
export async function trazaDeSalida(sesion: Sesion, movimientoId: string): Promise<TrazaDeSalida | null> {
  const filas = await consultarConSesion<TrazaDeSalida>(
    sesion,
    'select * from v_trazabilidad_salidas where movimiento_id = $1',
    [movimientoId],
  )
  return filas[0] ?? null
}

/** Salidas con pila declarada, para el listado de trazabilidad. */
export async function trazabilidadDeSalidas(
  sesion: Sesion,
  opciones: { desde?: string; limite?: number } = {},
): Promise<TrazaDeSalida[]> {
  const valores: unknown[] = [opciones.desde ?? '2000-01-01']
  return consultarConSesion<TrazaDeSalida>(
    sesion,
    `select * from v_trazabilidad_salidas
      where ocurrido_en >= $1::timestamptz
      order by ocurrido_en desc
      limit ${Math.min(Math.max(opciones.limite ?? 100, 1), 500)}`,
    valores,
  )
}

export async function registrarControl(
  sesion: Sesion,
  datos: { pila_id: string; tipo: TipoControl; valor?: number | null; observacion?: string | null; ocurrido_en?: string },
): Promise<{ ok: boolean; error?: string }> {
  if ((datos.tipo === 'temperatura' || datos.tipo === 'humedad') && !Number.isFinite(Number(datos.valor))) {
    return { ok: false, error: 'Falta el valor: una temperatura o una humedad sin número no dice nada.' }
  }
  try {
    await consultarConSesion(
      sesion,
      `insert into pila_controles (pila_id, tipo, valor, observacion, ocurrido_en, registrado_por_id)
       values ($1, $2, $3, $4, coalesce($5::timestamptz, now()), $6)`,
      [
        datos.pila_id,
        datos.tipo,
        datos.valor ?? null,
        datos.observacion?.trim() || null,
        datos.ocurrido_en ?? null,
        sesion.perfilId,
      ],
    )
    return { ok: true }
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) }
  }
}

// ── Conteo diario de vecinos ────────────────────────────────────────────

/**
 * El total de vecinos de un día en un punto.
 *
 * Donde no se puede usar el celular durante la jornada, el conteo se lleva en
 * papel y se carga una sola vez al cerrar. Es idempotente por (sitio, fecha):
 * volver a cargar el mismo día corrige, no duplica — dos filas para el mismo
 * día serían dos verdades distintas sobre lo mismo.
 */
export async function guardarConteo(
  sesion: Sesion,
  datos: { fecha: string; vecinos: number; observaciones?: string | null; sitioId?: string },
): Promise<{ ok: boolean; error?: string; corregido?: boolean }> {
  const sitioId = sesion.rol === 'admin' ? datos.sitioId : sesion.sitioId
  if (!sitioId) return { ok: false, error: 'Falta indicar el punto.' }

  const cuantos = Math.trunc(Number(datos.vecinos))
  if (!Number.isFinite(cuantos) || cuantos < 0) {
    return { ok: false, error: 'La cantidad de vecinos tiene que ser un número de cero para arriba.' }
  }
  if (cuantos > 5000) {
    return { ok: false, error: 'Ese número es demasiado alto. Revisá el conteo.' }
  }

  try {
    const filas = await consultarConSesion<{ corregido: boolean }>(
      sesion,
      `insert into conteos_diarios (sitio_id, fecha, vecinos, observaciones, cargado_por_id)
       values ($1, $2::date, $3, $4, $5)
       on conflict (sitio_id, fecha) do update
         set vecinos = excluded.vecinos,
             observaciones = excluded.observaciones,
             cargado_por_id = excluded.cargado_por_id
       returning (xmax <> 0) as corregido`,
      [sitioId, datos.fecha, cuantos, datos.observaciones?.trim() || null, sesion.perfilId],
    )
    return { ok: true, corregido: filas[0]?.corregido ?? false }
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) }
  }
}

/** Los últimos conteos del punto, para ver qué días ya se cargaron. */
export async function conteosRecientes(
  sesion: Sesion,
  opciones: { sitioId?: string; dias?: number } = {},
): Promise<ConteoDiario[]> {
  const dias = Math.min(Math.max(opciones.dias ?? 14, 1), 120)
  const valores: unknown[] = []
  const par = (v: unknown) => `$${valores.push(v)}`
  const cond = [`c.fecha >= current_date - ${dias}`]
  const sitioId = sesion.rol === 'admin' ? opciones.sitioId : sesion.sitioId
  if (sitioId) cond.push(`c.sitio_id = ${par(sitioId)}`)

  return consultarConSesion<ConteoDiario>(
    sesion,
    `select c.id, c.sitio_id, s.nombre as sitio_nombre, c.fecha, c.vecinos,
            c.observaciones, p.nombre as cargado_por, c.creado_en, c.actualizado_en
       from conteos_diarios c
       join sitios s on s.id = c.sitio_id
       left join perfiles p on p.id = c.cargado_por_id
      where ${cond.join(' and ')}
      order by c.fecha desc, s.codigo`,
    valores,
  )
}

/**
 * Hace cuánto que cada punto no carga nada.
 *
 * Un punto callado no es un punto sin gente: puede ser que el vigilador dejó de
 * cargar. Distinguirlo es la diferencia entre un indicador y una suposición.
 */
export async function puntosSinCarga(sesion: Sesion): Promise<PuntoSinCarga[]> {
  return consultarConSesion<PuntoSinCarga>(
    sesion,
    'select * from v_puntos_sin_carga order by ultima_carga, codigo',
  )
}

// ── Recambio de contenedores ────────────────────────────────────────────

/**
 * Los contenedores de un punto, con su pedido abierto si lo tiene.
 *
 * Sin numeración física, un contenedor es el par punto + corriente: "el de
 * cartón de Italia". El pedido abierto viaja con cada uno para que la pantalla
 * no ofrezca pedir dos veces lo mismo.
 */
export async function contenedoresDelSitio(
  sesion: Sesion,
  sitioId?: string,
): Promise<Contenedor[]> {
  const destino = sesion.rol === 'admin' ? sitioId : sesion.sitioId
  const valores: unknown[] = []
  const par = (v: unknown) => `$${valores.push(v)}`
  const cond = ['c.activo']
  if (destino) cond.push(`c.sitio_actual_id = ${par(destino)}`)

  return consultarConSesion<Contenedor>(
    sesion,
    `select c.id, c.codigo, c.tipo, c.capacidad_m3, c.sitio_actual_id,
            s.nombre as sitio_nombre, c.material_id, m.nombre as material,
            m.color as material_color, c.estado, c.ultima_retirada, c.activo,
            (select p.id from pedidos_recambio p
              where p.contenedor_id = c.id and p.estado in ('pedido', 'avisado')
              order by p.pedido_en desc limit 1) as pedido_abierto_id
       from contenedores c
       left join sitios s     on s.id = c.sitio_actual_id
       left join materiales m on m.id = c.material_id
      where ${cond.join(' and ')}
      order by s.orden, m.orden`,
    valores,
  )
}

/**
 * El vigilador pide el recambio. Un toque, sin formulario.
 *
 * Si ese contenedor ya tiene un pedido abierto no se crea otro: el segundo no
 * acelera nada y ensuciaría el tiempo de respuesta con esperas duplicadas.
 */
export async function pedirRecambio(
  sesion: Sesion,
  datos: { contenedorId: string; urgente?: boolean; observaciones?: string | null },
): Promise<{ ok: boolean; error?: string; yaPedido?: boolean }> {
  try {
    return await conSesion(sesion, async (tx) => {
      const [cont] = await tx.consultar<{ sitio_actual_id: string; material_id: string | null }>(
        'select sitio_actual_id, material_id from contenedores where id = $1 and activo',
        [datos.contenedorId],
      )
      if (!cont) return { ok: false, error: 'Ese contenedor no existe o está dado de baja.' }

      const abierto = await tx.consultar<{ id: string }>(
        `select id from pedidos_recambio
          where contenedor_id = $1 and estado in ('pedido', 'avisado') limit 1`,
        [datos.contenedorId],
      )
      if (abierto[0]) return { ok: true, yaPedido: true }

      await tx.consultar(
        `insert into pedidos_recambio
           (sitio_id, contenedor_id, material_id, urgente, observaciones, pedido_por_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          cont.sitio_actual_id,
          datos.contenedorId,
          cont.material_id,
          datos.urgente ?? false,
          datos.observaciones?.trim() || null,
          sesion.perfilId,
        ],
      )
      return { ok: true }
    })
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) }
  }
}

export async function pedidosDeRecambio(
  sesion: Sesion,
  opciones: { estado?: EstadoPedido | 'abiertos' | 'todos'; sitioId?: string; limite?: number } = {},
): Promise<PedidoRecambio[]> {
  const valores: unknown[] = []
  const par = (v: unknown) => `$${valores.push(v)}`
  const cond: string[] = []
  const estado = opciones.estado ?? 'abiertos'
  if (estado === 'abiertos') cond.push("estado in ('pedido', 'avisado')")
  else if (estado !== 'todos') cond.push(`estado = ${par(estado)}`)
  if (opciones.sitioId) cond.push(`sitio_id = ${par(opciones.sitioId)}`)

  return consultarConSesion<PedidoRecambio>(
    sesion,
    `select * from v_pedidos_recambio
      ${cond.length ? `where ${cond.join(' and ')}` : ''}
      order by urgente desc, pedido_en
      limit ${Math.min(Math.max(opciones.limite ?? 200, 1), 1000)}`,
    valores,
  )
}

/**
 * Lo que tarda cada punto, del pedido al retiro.
 *
 * Es el número que hoy no existe y el que sirve para reclamarle frecuencia a la
 * empresa. Viene partido en dos tramos a propósito: cuánto tarda el municipio
 * en avisar y cuánto tarda la empresa en venir son dos problemas distintos y
 * se arreglan de maneras distintas.
 */
export async function respuestaDeRecambio(sesion: Sesion): Promise<RespuestaRecambio[]> {
  return consultarConSesion<RespuestaRecambio>(
    sesion,
    'select * from v_respuesta_recambio order by demorados desc, promedio_total desc nulls last',
  )
}

/** La coordinación avisó a la empresa: el tramo que hoy no queda registrado. */
export async function marcarAvisado(
  sesion: Sesion,
  ids: string[],
): Promise<{ ok: boolean; cuantos?: number; error?: string }> {
  if (!ids.length) return { ok: false, error: 'No elegiste ningún pedido.' }
  try {
    const filas = await consultarConSesion<{ id: string }>(
      sesion,
      `update pedidos_recambio
          set estado = 'avisado', avisado_en = now(), avisado_por_id = $2
        where id = any($1::uuid[]) and estado = 'pedido'
        returning id`,
      [ids, sesion.perfilId],
    )
    return { ok: true, cuantos: filas.length }
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) }
  }
}

/**
 * Se confirma el retiro. El remito es el enganche con el Excel que la empresa
 * manda a fin de mes: con él, lo que se pidió y lo que se retiró se pueden
 * cruzar, que es lo que hoy no se puede hacer.
 */
export async function confirmarRetiro(
  sesion: Sesion,
  datos: { id: string; retirado_en?: string; remito?: string | null; peso_kg?: number | null },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const filas = await consultarConSesion<{ id: string }>(
      sesion,
      `update pedidos_recambio
          set estado = 'retirado',
              retirado_en = coalesce($2::timestamptz, now()),
              remito = $3,
              peso_kg = $4,
              avisado_en = coalesce(avisado_en, now()),
              avisado_por_id = coalesce(avisado_por_id, $5)
        where id = $1 and estado in ('pedido', 'avisado')
        returning id`,
      [
        datos.id,
        datos.retirado_en ?? null,
        datos.remito?.trim() || null,
        datos.peso_kg ?? null,
        sesion.perfilId,
      ],
    )
    if (!filas.length) return { ok: false, error: 'Ese pedido ya estaba cerrado.' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) }
  }
}

export async function cancelarPedido(
  sesion: Sesion,
  id: string,
  motivo: string,
): Promise<{ ok: boolean; error?: string }> {
  const limpio = motivo.trim()
  if (limpio.length < 3) return { ok: false, error: 'Decí por qué se cancela.' }
  try {
    const filas = await consultarConSesion<{ id: string }>(
      sesion,
      `update pedidos_recambio
          set estado = 'cancelado', motivo_cierre = $2
        where id = $1 and estado in ('pedido', 'avisado')
        returning id`,
      [id, limpio],
    )
    if (!filas.length) {
      return {
        ok: false,
        error: sesion.rol === 'admin'
          ? 'Ese pedido ya estaba cerrado.'
          : 'Ya no lo podés cancelar: pasaron más de 24 horas o la coordinación ya lo avisó.',
      }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: mensajeDeError(e) }
  }
}
