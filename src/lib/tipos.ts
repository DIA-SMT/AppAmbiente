/** Tipos compartidos por todas las pantallas. Espejan el esquema de db/migrations. */

export type Flujo = 'planta' | 'punto_verde' | 'gran_generador'
export type TipoMovimiento = 'ingreso' | 'salida' | 'contenedor'
export type Clase = 'sitio' | 'entidad' | 'vecino' | 'texto'
export type EstadoMovimiento = 'vigente' | 'anulado'
export type TipoValorizacion = 'reutilizacion' | 'venta' | 'emprendimiento' | 'otro'
export type Rol = 'admin' | 'vigilador'

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
  semana: string
  mes: string
  /** Cuánta gente vino. Si alguien vino cuatro veces, son cuatro visitas. */
  visitas: number
  sin_datos: number
  /** Personas distintas que dejaron teléfono. No se pueden sumar con visitas. */
  identificados: number
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
