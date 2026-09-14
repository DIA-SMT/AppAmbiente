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
  sugerencias: number[]
  color: string
  orden: number
  activo: boolean
  /** Resuelta por la consulta, para no pedir la unidad aparte. */
  unidad?: Unidad
}

export interface Entidad {
  id: string
  nombre: string
  tipo: string
  habilitada_origen: boolean
  habilitada_destino: boolean
  flujos: Flujo[]
  activo: boolean
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
