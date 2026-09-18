/** Tipos compartidos por todas las pantallas. Espejan el esquema de db/migrations. */

export type Flujo = 'planta' | 'punto_verde' | 'gran_generador'
export type TipoMovimiento = 'ingreso' | 'salida' | 'contenedor'
export type Clase = 'sitio' | 'entidad' | 'vecino' | 'texto'
export type EstadoMovimiento = 'vigente' | 'anulado'
export type Rol = 'admin' | 'vigilador'

/**
 * Para qué sale el material, según los formularios de entrega que la Secretaría
 * ya venía usando: R-05-06 (chips, compost y leña de la Planta) y R-05-08
 * (entrega para reutilizar en un Punto Verde).
 *
 * Son dos vocabularios distintos y no se mezclan: lo único que preguntan los
 * dos es «otro». Por eso el tipo está partido en tres, y cada pantalla ofrece
 * el subconjunto de su flujo con valorizacionesDeFlujo() de recursos.ts.
 *
 * Los cuatro valores anteriores —reutilizacion, venta, emprendimiento, otro—
 * eran un supuesto nuestro de la fase 1: nadie los usa. Sobreviven «venta» y
 * «otro», que sí están en los formularios; los otros dos no existen.
 */
export type ValorizacionPlanta =
  | 'uso_interno_huerta'
  | 'uso_interno_plazas'
  | 'uso_interno_transforma'
  /** El vecino que se lleva compost o leña. No confundir con la Clase 'vecino'. */
  | 'vecino'
  | 'ecocanje'
  | 'aserradero'
  | 'cic'

export type ValorizacionPuntoVerde =
  /** «Manualidades, artesanías y emprendimientos», tal cual lo dice el R-05-08. */
  | 'manualidades'
  | 'venta'
  /** Al proceso de asfalto de la Planta de Asfalto Municipal. */
  | 'asfalto'

export type TipoValorizacion = ValorizacionPlanta | ValorizacionPuntoVerde | 'otro'

export interface Sitio {
  id: string
  codigo: string
  nombre: string
  tipo: 'planta' | 'punto_verde'
  direccion: string | null
  orden: number
  activo: boolean
}

export interface Unidad {
  id: string
  codigo: string
  nombre: string
  nombre_plural: string
  decimales: number
  factor_m3: number | null
  orden: number
  activo: boolean
}

export interface Material {
  id: string
  nombre: string
  categoria: string
  flujos: Flujo[]
  tipos: Array<'ingreso' | 'salida'>
  unidad_default_id: string
  unidades_permitidas: string[]
  sugerencias: number[]
  color: string
  orden: number
  activo: boolean
  /** Resuelta por la consulta, para no pedir la unidad aparte. */
  unidad?: Unidad
  /**
   * Los recipientes con los que se puede estimar este material. No hay balanza:
   * el vigilador elige recipiente y cuántos, y la app guarda el equivalente en
   * m³ usando la capacidad de cada uno.
   */
  recipientes?: Unidad[]
}

/** Una fila de v_destinos_a_formalizar. */
export interface DestinoAFormalizar {
  destino: string
  veces: number
  primera_vez: string
  ultima_vez: string
  sitios: string[]
  flujos: Flujo[]
}

export interface Entidad {
  id: string
  nombre: string
  tipo: string
  habilitada_origen: boolean
  habilitada_destino: boolean
  flujos: Flujo[]
  activo: boolean
  /** La dio de alta un vigilador en la calle y falta que la coordinadora la confirme. */
  pendiente_revision?: boolean
}

/** Datos del vecino tal como los manda el celular. Nunca un id: no puede leerlos. */
export interface VecinoDelCelular {
  nombre?: string | null
  telefono?: string | null
  barrio?: string | null
  sin_datos: boolean
}

/** Una fila de v_vecinos_por_periodo. */
export interface FilaVecinos {
  sitio_id: string
  sitio_nombre: string
  sitio_codigo: string
  /** Falso donde no se puede usar el celular y solo se espera el conteo diario. */
  carga_detallada: boolean
  semana: string
  mes: string
  /** Cuánta gente vino, por cualquiera de las dos modalidades. */
  visitas: number
  sin_datos: number
  /** Personas distintas que dejaron teléfono. Solo del modo detallado. */
  identificados: number
  /** Parte de las visitas que viene de un conteo diario, sin detalle de quién. */
  contadas: number
}

export interface ConteoDiario {
  id: string
  sitio_id: string
  sitio_nombre?: string
  fecha: string
  vecinos: number
  observaciones: string | null
  cargado_por?: string | null
  creado_en: string
  actualizado_en: string
}

/** Fila de v_puntos_sin_carga. */
export interface PuntoSinCarga {
  sitio_id: string
  codigo: string
  nombre: string
  carga_detallada: boolean
  ultima_carga: string
}

/** Una fila de v_valorizacion. */
export interface FilaValorizacion {
  sitio_id: string
  flujo: Flujo
  mes: string
  semana: string
  tipo_valorizacion: TipoValorizacion
  material_id: string
  material_nombre: string
  material_color: string
  unidad_codigo: string
  unidad_plural: string
  movimientos: number
  cantidad: number
  equivalente_m3: number
}

export interface Vehiculo {
  id: string
  patente: string
  tipo: string
  capacidad_m3: number | null
  activo: boolean
}

export interface Persona {
  id: string
  nombre: string
  rol: 'chofer' | 'vigilador' | 'autorizante' | 'operario'
  sitio_id: string | null
  activo: boolean
}

/** Todo lo que necesita el formulario del celular, en una sola consulta. */
export interface ListasDelFormulario {
  sitio: Sitio
  materiales: Material[]
  unidades: Unidad[]
  origenes: Entidad[]
  destinos: Entidad[]
  vehiculos: Vehiculo[]
  choferes: Persona[]
  autorizantes: Persona[]
  vigiladores: Persona[]
}

export interface ItemMovimiento {
  material_id: string
  cantidad: number
  unidad_id: string
  observacion?: string | null
}

/** Lo que manda el formulario al servidor. */
export interface MovimientoNuevo {
  flujo: Flujo
  tipo: TipoMovimiento
  ocurrido_en: string
  items: ItemMovimiento[]
  origen_clase: Clase
  origen_entidad_id?: string | null
  origen_sitio_id?: string | null
  origen_vecino_id?: string | null
  origen_detalle?: string | null
  destino_clase: Clase
  destino_entidad_id?: string | null
  destino_sitio_id?: string | null
  destino_vecino_id?: string | null
  destino_detalle?: string | null
  vehiculo_id?: string | null
  chofer_id?: string | null
  autorizado_por_id?: string | null
  vigilador_id?: string | null
  tipo_valorizacion?: TipoValorizacion | null
  vecino_sin_datos?: boolean
  /** A qué pila entró, o de cuál salió. Solo en el flujo de la Planta. */
  pila_id?: string | null
  /** Si viene, la base lo resuelve contra los vecinos ya registrados. */
  vecino?: VecinoDelCelular | null
  entidad_nueva?: { nombre: string; tipo: string } | null
  observaciones?: string | null
  /** Generado en el celular. Evita duplicar si el envío se reintenta. */
  client_uuid: string
}

/** Fila de v_movimientos. */
export interface MovimientoListado {
  id: string
  numero: number
  flujo: Flujo
  tipo: TipoMovimiento
  estado: EstadoMovimiento
  ocurrido_en: string
  carga_diferida: boolean
  creado_en: string
  observaciones: string | null
  tipo_valorizacion: TipoValorizacion | null
  vecino_sin_datos: boolean
  motivo_anulacion: string | null
  anulado_en: string | null
  sitio_id: string
  sitio_nombre: string
  sitio_codigo: string
  origen_clase: Clase
  origen_nombre: string | null
  destino_clase: Clase
  destino_nombre: string | null
  destino_entidad_tipo: string | null
  patente: string | null
  vehiculo_tipo: string | null
  chofer_nombre: string | null
  autorizante_nombre: string | null
  vigilador_nombre: string | null
  cargado_por_nombre: string | null
  cargado_por_id: string
  items: number
  materiales: string | null
  cantidad_total: number | null
  /** Null si el movimiento mezcla unidades: ahí el total no es sumable. */
  unidad_nombre: string | null
  unidad_plural: string | null
  unidad_decimales: number | null
}

/** Fila de v_movimiento_items. */
export interface ItemListado {
  item_id: string
  movimiento_id: string
  cantidad: number
  observacion: string | null
  material_id: string
  material_nombre: string
  material_categoria: string
  material_color: string
  unidad_id: string
  unidad_codigo: string
  unidad_nombre: string
  unidad_plural: string
  factor_m3: number | null
  equivalente_m3: number
  numero: number
  flujo: Flujo
  tipo: TipoMovimiento
  estado: EstadoMovimiento
  ocurrido_en: string
  sitio_id: string
  mes: string
  semana: string
}

export interface FiltrosMovimientos {
  flujo?: Flujo | ''
  tipo?: TipoMovimiento | ''
  sitioId?: string
  materialId?: string
  desde?: string
  hasta?: string
  patente?: string
  destinoId?: string
  estado?: EstadoMovimiento | 'todos'
  texto?: string
  pagina?: number
  porPagina?: number
}

export interface FilaResumen {
  sitio_id: string
  flujo: Flujo
  tipo: TipoMovimiento
  mes: string
  material_id: string
  material_nombre: string
  material_color: string
  unidad_codigo: string
  unidad_plural: string
  movimientos: number
  cantidad: number
  equivalente_m3: number
}

// ── Pilas de compost ────────────────────────────────────────────────────

export type EstadoPila = 'en_formacion' | 'madurando' | 'lista' | 'despachada'
export type TipoControl = 'volteo' | 'riego' | 'temperatura' | 'humedad' | 'observacion'

/** Fila de v_pilas. */
export interface FilaPila {
  id: string
  codigo: string
  sitio_id: string
  sitio_nombre: string
  estado: EstadoPila
  fecha_armado: string | null
  fecha_cierre: string | null
  madurez: string | null
  largo_m: number | null
  ancho_m: number | null
  alto_m: number | null
  volumen_nominal_m3: number | null
  composicion: string | null
  notas: string | null
  activo: boolean
  responsable: string | null
  dias_desde_armado: number | null
  /** Negativo si ya pasó la fecha de madurez. */
  dias_para_madurez: number | null
  volteos: number
  riegos: number
  ultimo_volteo: string | null
  ultima_temperatura: number | null
  /** Cerrada y sin voltear hace más de tres semanas. */
  volteo_atrasado: boolean
  m3_ingresados: number
  m3_despachados: number
  ingresos: number
  salidas: number
}

/** Fila de v_pila_composicion: de qué está hecha, calculado desde los ingresos. */
export interface FilaComposicion {
  pila_id: string
  material_id: string
  material: string
  material_color: string
  origen: string
  movimientos: number
  primer_ingreso: string
  ultimo_ingreso: string
  m3: number
}

export interface ControlDePila {
  id: string
  pila_id: string
  tipo: TipoControl
  ocurrido_en: string
  valor: number | null
  observacion: string | null
  registrado_por: string | null
}

/** Fila de v_trazabilidad_salidas: de dónde salió este camión. */
export interface TrazaDeSalida {
  movimiento_id: string
  numero: number
  ocurrido_en: string
  tipo_valorizacion: TipoValorizacion | null
  destino: string
  patente: string | null
  chofer: string | null
  autoriza: string | null
  pila_id: string
  pila: string
  fecha_armado: string | null
  fecha_cierre: string | null
  madurez: string | null
  volteos: number
  m3_que_la_formaron: number | null
  procedencias: string | null
}

// ── Recambio de contenedores ────────────────────────────────────────────

export type EstadoPedido = 'pedido' | 'avisado' | 'retirado' | 'cancelado'

export interface Contenedor {
  id: string
  codigo: string
  tipo: string | null
  capacidad_m3: number | null
  sitio_actual_id: string | null
  sitio_nombre?: string
  material_id: string | null
  material?: string
  material_color?: string
  estado: string
  ultima_retirada: string | null
  activo: boolean
  /** Si ya hay un pedido abierto, la pantalla no ofrece pedir dos veces. */
  pedido_abierto_id?: string | null
}

/** Fila de v_pedidos_recambio. */
export interface PedidoRecambio {
  id: string
  sitio_id: string
  sitio_codigo: string
  sitio_nombre: string
  contenedor_id: string | null
  material_id: string | null
  material: string | null
  material_color: string | null
  estado: EstadoPedido
  urgente: boolean
  observaciones: string | null
  pedido_en: string
  /** Para saber si este vigilador es quien lo pidió y puede cancelarlo. */
  pedido_por_id: string
  pedido_por: string | null
  avisado_en: string | null
  avisado_por: string | null
  retirado_en: string | null
  remito: string | null
  peso_kg: number | null
  motivo_cierre: string | null
  /** Del pedido al aviso a la empresa: lo que tarda el municipio. */
  horas_hasta_aviso: number
  /** Del aviso al retiro: lo que tarda la empresa. */
  horas_hasta_retiro: number | null
  horas_totales: number
  /** Abierto hace más de tres días. */
  demorado: boolean
}

/** Fila de v_respuesta_recambio. */
export interface RespuestaRecambio {
  sitio_id: string
  sitio_codigo: string
  sitio_nombre: string
  retirados: number
  abiertos: number
  demorados: number
  promedio_hasta_aviso: number | null
  promedio_hasta_retiro: number | null
  promedio_total: number | null
  pedido_mas_viejo: string | null
}
