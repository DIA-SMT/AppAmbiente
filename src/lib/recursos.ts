/**
 * Las seis listas maestras, descritas como datos.
 *
 * La pantalla de listas es una sola: el SELECT, las columnas de la tabla, los
 * campos del formulario y la validación salen de acá. Agregar una lista nueva
 * es agregar una entrada a RECURSOS, no escribir otra pantalla.
 *
 * Es además la frontera de seguridad del ABM: ningún nombre de tabla ni de
 * columna entra a una consulta si no está escrito en este archivo. Del
 * formulario llegan valores, y los valores viajan siempre como parámetros.
 */
import { ETIQUETA_ENTIDAD, ETIQUETA_FLUJO, ETIQUETA_TIPO } from './formato'

export type ClaveRecurso =
  | 'materiales' | 'unidades' | 'sitios' | 'entidades' | 'vehiculos' | 'personas'

/**
 * texto/numero/color escriben una columna simple; select escribe una opción
 * cerrada o una referencia a otra lista; multi escribe un text[]; numeros
 * escribe un numeric[] que se edita como "5, 10, 15"; booleano, un boolean.
 */
export type TipoCampo = 'texto' | 'numero' | 'select' | 'multi' | 'color' | 'booleano' | 'numeros'

export type ValorFormulario = string | string[] | boolean

export interface Opcion {
  valor: string
  etiqueta: string
}

export interface Campo {
  nombre: string
  etiqueta: string
  tipo: TipoCampo
  obligatorio?: boolean
  ayuda?: string
  /** Opciones fijas, tomadas del CHECK de la migración. */
  opciones?: Opcion[]
  /** Opciones cargadas de otra lista maestra (select por referencia). */
  origen?: ClaveRecurso
  /** Se usa como valor inicial y también cuando el campo llega vacío. */
  predeterminado?: ValorFormulario
  min?: number
  max?: number
  entero?: boolean
  maxLargo?: number
  /** Ocupa toda la fila de la grilla del formulario. */
  ancho?: 'entero'
}

export type TipoColumna =
  | 'texto' | 'mono' | 'numero' | 'opcion' | 'multi' | 'numeros'
  | 'booleano' | 'color' | 'referencia'

export interface Columna {
  nombre: string
  etiqueta: string
  tipo?: TipoColumna
  /** Qué mostrar cuando la celda viene vacía y el vacío significa algo. */
  vacio?: string
}

export interface Recurso {
  clave: ClaveRecurso
  tabla: string
  singular: string
  plural: string
  articulo: 'un' | 'una'
  /** Una línea, para la tarjeta del índice. */
  paraQue: string
  /** Columnas por las que ordena el listado, todas ascendentes. */
  orden: string[]
  /** Columna que nombra a la fila: la que se muestra cuando otra lista la referencia. */
  campoEtiqueta: string
  /** Columnas de texto donde busca el buscador. */
  camposBusqueda: string[]
  columnas: Columna[]
  campos: Campo[]
}

// ── Opciones que salen de los CHECK de db/migrations ─────────────────────

const FLUJOS = ['planta', 'punto_verde', 'gran_generador']

const ETIQUETA_CATEGORIA: Record<string, string> = {
  verdes: 'Verdes', reciclables: 'Reciclables', textil: 'Textil',
  madera: 'Madera', especiales: 'Especiales', otros: 'Otros',
}
const ETIQUETA_CODIGO_UNIDAD: Record<string, string> = {
  m3: 'm³', camion: 'Camión', batea: 'Batea', bolsa: 'Bolsa',
  kg: 'Kilogramo', tn: 'Tonelada', unidad: 'Unidad',
}
const ETIQUETA_TIPO_SITIO: Record<string, string> = {
  planta: 'Planta', punto_verde: 'Punto Verde',
}
const ETIQUETA_TIPO_VEHICULO: Record<string, string> = {
  camion: 'Camión', batea: 'Batea', camioneta: 'Camioneta',
  tractor: 'Tractor', otro: 'Otro',
}
const ETIQUETA_ROL_PERSONA: Record<string, string> = {
  chofer: 'Chofer', vigilador: 'Vigilador',
  autorizante: 'Autorizante', operario: 'Operario',
}

function opciones(valores: string[], etiquetas: Record<string, string>): Opcion[] {
  return valores.map((valor) => ({ valor, etiqueta: etiquetas[valor] ?? valor }))
}

// ── Las seis listas ─────────────────────────────────────────────────────

export const RECURSOS: Recurso[] = [
  {
    clave: 'materiales',
    tabla: 'materiales',
    singular: 'Material',
    plural: 'Materiales',
    articulo: 'un',
    paraQue: 'Qué se puede cargar, en qué unidad y con qué botones de cantidad.',
    orden: ['orden', 'nombre'],
    campoEtiqueta: 'nombre',
    camposBusqueda: ['nombre'],
    columnas: [
      { nombre: 'nombre', etiqueta: 'Nombre' },
      { nombre: 'color', etiqueta: 'Color', tipo: 'color' },
      { nombre: 'categoria', etiqueta: 'Categoría', tipo: 'opcion' },
      { nombre: 'tipos', etiqueta: 'Entra / sale', tipo: 'multi' },
      { nombre: 'flujos', etiqueta: 'Flujos', tipo: 'multi', vacio: 'Todos' },
      { nombre: 'unidad_default_id', etiqueta: 'Unidad', tipo: 'referencia' },
      { nombre: 'sugerencias', etiqueta: 'Sugerencias', tipo: 'numeros' },
      { nombre: 'orden', etiqueta: 'Orden', tipo: 'numero' },
    ],
    campos: [
      { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, maxLargo: 80 },
      {
        nombre: 'categoria', etiqueta: 'Categoría', tipo: 'select', obligatorio: true,
        opciones: opciones(['verdes', 'reciclables', 'textil', 'madera', 'especiales', 'otros'], ETIQUETA_CATEGORIA),
      },
      {
        nombre: 'tipos', etiqueta: '¿Entra, sale o las dos cosas?', tipo: 'multi',
        obligatorio: true, ancho: 'entero',
        opciones: opciones(['ingreso', 'salida'], ETIQUETA_TIPO),
        predeterminado: ['ingreso', 'salida'],
        ayuda: 'Es lo que impide que aparezca compost en un ingreso: si acá solo está marcado "Salida", el material ni figura en la lista cuando el vigilador registra una entrada.',
      },
      {
        nombre: 'flujos', etiqueta: '¿En qué flujos se ofrece?', tipo: 'multi', ancho: 'entero',
        opciones: opciones(FLUJOS, ETIQUETA_FLUJO),
        ayuda: 'Sin marcar nada, se ofrece en los tres.',
      },
      {
        nombre: 'unidad_default_id', etiqueta: 'Unidad', tipo: 'select',
        obligatorio: true, origen: 'unidades',
        ayuda: 'En qué se anota la cantidad. Cambiarla no toca los movimientos ya cargados.',
      },
      {
        nombre: 'sugerencias', etiqueta: 'Cantidades sugeridas', tipo: 'numeros', ancho: 'entero',
        ayuda: 'Los botones que toca el vigilador para no escribir. Separados por coma: 5, 10, 15, 20. Si hacen falta decimales, con punto: 0.5, 1, 2.',
      },
      {
        nombre: 'color', etiqueta: 'Color', tipo: 'color', predeterminado: '#126ff5',
        ayuda: 'Con el que sale en el tablero.',
      },
      {
        nombre: 'orden', etiqueta: 'Orden', tipo: 'numero', entero: true, min: 0, max: 999,
        predeterminado: '0', ayuda: 'Más chico, más arriba en la lista del celular.',
      },
    ],
  },

  {
    clave: 'unidades',
    tabla: 'unidades',
    singular: 'Unidad',
    plural: 'Unidades',
    articulo: 'una',
    paraQue: 'Cómo se mide cada material y cuánto equivale en m³ para poder compararlos.',
    orden: ['orden', 'nombre'],
    campoEtiqueta: 'nombre',
    camposBusqueda: ['nombre', 'codigo'],
    columnas: [
      { nombre: 'codigo', etiqueta: 'Código', tipo: 'opcion' },
      { nombre: 'nombre', etiqueta: 'Nombre' },
      { nombre: 'nombre_plural', etiqueta: 'Plural' },
      { nombre: 'decimales', etiqueta: 'Decimales', tipo: 'numero' },
      { nombre: 'factor_m3', etiqueta: 'Equivale en m³', tipo: 'numero', vacio: 'No se compara' },
      { nombre: 'orden', etiqueta: 'Orden', tipo: 'numero' },
    ],
    campos: [
      {
        nombre: 'codigo', etiqueta: 'Código', tipo: 'select', obligatorio: true,
        opciones: opciones(['m3', 'camion', 'batea', 'bolsa', 'kg', 'tn', 'unidad'], ETIQUETA_CODIGO_UNIDAD),
        ayuda: 'La lista es cerrada: la base solo acepta estos siete códigos.',
      },
      { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, maxLargo: 40 },
      {
        nombre: 'nombre_plural', etiqueta: 'Nombre en plural', tipo: 'texto',
        obligatorio: true, maxLargo: 40, ayuda: 'Se usa para escribir "3 camiones" y no "3 camión".',
      },
      {
        nombre: 'decimales', etiqueta: 'Decimales', tipo: 'numero', entero: true,
        min: 0, max: 3, predeterminado: '0',
        ayuda: 'Cuántos decimales se piden al cargar. Cero para camión: no existe medio camión.',
      },
      {
        nombre: 'factor_m3', etiqueta: 'Equivalencia en m³', tipo: 'numero', min: 0, ancho: 'entero',
        ayuda: 'Cuántos m³ representa una unidad. Es un supuesto, y sirve para una sola cosa: que el tablero pueda comparar materiales que se miden distinto (camiones contra kilos). Vacío significa que esta unidad no se compara con las otras.',
      },
      {
        nombre: 'orden', etiqueta: 'Orden', tipo: 'numero', entero: true, min: 0, max: 999,
        predeterminado: '0', ayuda: 'Más chico, más arriba en la lista.',
      },
    ],
  },

  {
    clave: 'sitios',
    tabla: 'sitios',
    singular: 'Punto',
    plural: 'Puntos y Planta',
    articulo: 'un',
    paraQue: 'La Planta y los puntos verdes. Cada vigilador carga en el suyo.',
    orden: ['orden', 'nombre'],
    campoEtiqueta: 'nombre',
    camposBusqueda: ['nombre', 'codigo', 'direccion'],
    columnas: [
      { nombre: 'codigo', etiqueta: 'Código', tipo: 'mono' },
      { nombre: 'nombre', etiqueta: 'Nombre' },
      { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'opcion' },
      { nombre: 'direccion', etiqueta: 'Dirección' },
      { nombre: 'orden', etiqueta: 'Orden', tipo: 'numero' },
    ],
    campos: [
      {
        nombre: 'codigo', etiqueta: 'Código', tipo: 'texto', obligatorio: true, maxLargo: 16,
        ayuda: 'Corto y sin espacios: PLANTA, PV-01. Identifica al punto en todo el sistema.',
      },
      { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, maxLargo: 80 },
      {
        nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', obligatorio: true,
        opciones: opciones(['planta', 'punto_verde'], ETIQUETA_TIPO_SITIO),
      },
      { nombre: 'direccion', etiqueta: 'Dirección', tipo: 'texto', maxLargo: 120, ancho: 'entero' },
      {
        nombre: 'orden', etiqueta: 'Orden', tipo: 'numero', entero: true, min: 0, max: 999,
        predeterminado: '0', ayuda: 'Más chico, más arriba en la lista de puntos.',
      },
    ],
  },

  {
    clave: 'entidades',
    tabla: 'entidades',
    singular: 'Entidad',
    plural: 'Entidades',
    articulo: 'una',
    paraQue: 'Cuadrillas, empresas y organizaciones: de dónde viene y a dónde va el material.',
    orden: ['nombre'],
    campoEtiqueta: 'nombre',
    camposBusqueda: ['nombre', 'barrio', 'contacto'],
    columnas: [
      { nombre: 'nombre', etiqueta: 'Nombre' },
      { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'opcion' },
      { nombre: 'habilitada_origen', etiqueta: 'Origen', tipo: 'booleano' },
      { nombre: 'habilitada_destino', etiqueta: 'Destino', tipo: 'booleano' },
      { nombre: 'flujos', etiqueta: 'Flujos', tipo: 'multi', vacio: 'Todos' },
      { nombre: 'barrio', etiqueta: 'Barrio' },
    ],
    campos: [
      { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, maxLargo: 120, ancho: 'entero' },
      {
        nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', obligatorio: true,
        opciones: opciones(
          ['empresa', 'emprendimiento', 'organizacion', 'carrero', 'dependencia_municipal', 'planta_externa', 'otro'],
          ETIQUETA_ENTIDAD,
        ),
      },
      {
        nombre: 'habilitada_origen', etiqueta: 'Se puede elegir como origen', tipo: 'booleano',
        ayuda: 'De acá viene el material que ingresa.',
      },
      {
        nombre: 'habilitada_destino', etiqueta: 'Se puede elegir como destino', tipo: 'booleano',
        ayuda: 'Es lo que arma la lista de destinos habilitados que ve el vigilador en una salida. Marcá al menos una de las dos casillas: una entidad que no es ni origen ni destino no se puede elegir en ningún lado, y la base la rechaza.',
      },
      {
        nombre: 'flujos', etiqueta: '¿En qué flujos se ofrece?', tipo: 'multi', ancho: 'entero',
        opciones: opciones(FLUJOS, ETIQUETA_FLUJO),
        ayuda: 'Sin marcar nada, se ofrece en los tres.',
      },
      { nombre: 'cuit', etiqueta: 'CUIT', tipo: 'texto', maxLargo: 20, ayuda: 'No se muestra en el celular.' },
      { nombre: 'contacto', etiqueta: 'Contacto', tipo: 'texto', maxLargo: 80 },
      { nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'texto', maxLargo: 40 },
      { nombre: 'barrio', etiqueta: 'Barrio', tipo: 'texto', maxLargo: 80 },
      { nombre: 'notas', etiqueta: 'Notas', tipo: 'texto', maxLargo: 300, ancho: 'entero' },
    ],
  },

  {
    clave: 'vehiculos',
    tabla: 'vehiculos',
    singular: 'Vehículo',
    plural: 'Vehículos',
    articulo: 'un',
    paraQue: 'Las patentes que se eligen al registrar un ingreso o una salida.',
    orden: ['patente'],
    campoEtiqueta: 'patente',
    camposBusqueda: ['patente'],
    columnas: [
      { nombre: 'patente', etiqueta: 'Patente', tipo: 'mono' },
      { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'opcion' },
      { nombre: 'capacidad_m3', etiqueta: 'Capacidad (m³)', tipo: 'numero', vacio: 'Sin dato' },
      { nombre: 'entidad_id', etiqueta: 'De quién es', tipo: 'referencia', vacio: 'Municipio' },
    ],
    campos: [
      {
        nombre: 'patente', etiqueta: 'Patente', tipo: 'texto', obligatorio: true, maxLargo: 16,
        ayuda: 'Como está en la chapa. "AB 123 CD" y "ab123cd" son la misma patente para el sistema.',
      },
      {
        nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', obligatorio: true,
        opciones: opciones(['camion', 'batea', 'camioneta', 'tractor', 'otro'], ETIQUETA_TIPO_VEHICULO),
      },
      {
        nombre: 'capacidad_m3', etiqueta: 'Capacidad en m³', tipo: 'numero', min: 0, ancho: 'entero',
        ayuda: 'Si la cargás, la app propone ese volumen cuando se elige el vehículo y el vigilador no tiene que estimar a ojo. Vacío = se carga a mano.',
      },
      {
        nombre: 'entidad_id', etiqueta: 'Pertenece a', tipo: 'select', origen: 'entidades',
        ayuda: 'Si el vehículo es de una empresa, una cooperativa o un carrero. Vacío = es del municipio.',
      },
    ],
  },

  {
    clave: 'personas',
    tabla: 'personas',
    singular: 'Persona',
    plural: 'Personas',
    articulo: 'una',
    paraQue: 'Choferes, vigiladores y quienes autorizan una salida.',
    orden: ['nombre'],
    campoEtiqueta: 'nombre',
    camposBusqueda: ['nombre'],
    columnas: [
      { nombre: 'nombre', etiqueta: 'Nombre' },
      { nombre: 'rol', etiqueta: 'Rol', tipo: 'opcion' },
      { nombre: 'sitio_id', etiqueta: 'Punto', tipo: 'referencia', vacio: 'Todos' },
      { nombre: 'entidad_id', etiqueta: 'Pertenece a', tipo: 'referencia', vacio: 'Municipio' },
    ],
    campos: [
      { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, maxLargo: 80 },
      {
        nombre: 'rol', etiqueta: 'Rol', tipo: 'select', obligatorio: true,
        opciones: opciones(['chofer', 'vigilador', 'autorizante', 'operario'], ETIQUETA_ROL_PERSONA),
        ayuda: 'El chofer maneja; el vigilador es quien está a cargo del turno; el autorizante firma la salida; el operario trabaja en la Planta.',
      },
      {
        nombre: 'documento', etiqueta: 'Documento', tipo: 'texto', maxLargo: 20,
        ayuda: 'Nunca se muestra en el celular ni en el listado.',
      },
      {
        nombre: 'sitio_id', etiqueta: 'Punto donde trabaja', tipo: 'select', origen: 'sitios',
        ayuda: 'Si está siempre en el mismo punto, se ofrece solo ahí. Vacío = aparece en todos.',
      },
      {
        nombre: 'entidad_id', etiqueta: 'Pertenece a', tipo: 'select', origen: 'entidades',
        ayuda: 'Si viene de una empresa o cooperativa y no del municipio.',
      },
    ],
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────

export function recursoPorClave(clave: string): Recurso | undefined {
  return RECURSOS.find((r) => r.clave === clave)
}

export function campoPorNombre(recurso: Recurso, nombre: string): Campo | undefined {
  return recurso.campos.find((c) => c.nombre === nombre)
}

const IDENTIFICADOR = /^[a-z][a-z0-9_]*$/

/**
 * Único lugar por donde un nombre de tabla o de columna entra a una consulta.
 * Si algún día alguien agrega una definición con un nombre raro, revienta acá
 * y no en la base.
 */
export function identificador(nombre: string): string {
  if (!IDENTIFICADOR.test(nombre)) {
    throw new Error(`Identificador no permitido en la definición de listas: ${nombre}`)
  }
  return nombre
}

/** Columnas que pide el listado: id, activo y todo lo que se muestra o se edita. */
export function columnasDeLectura(recurso: Recurso): string {
  const nombres = new Set<string>(['id', 'activo'])
  for (const c of recurso.columnas) nombres.add(c.nombre)
  for (const c of recurso.campos) nombres.add(c.nombre)
  return [...nombres].map(identificador).join(', ')
}

export function ordenSql(recurso: Recurso): string {
  return recurso.orden.map(identificador).join(', ')
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Números de la base a texto de input: "12.000" se edita como "12". */
export function textoNumero(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return ''
  const n = Number(valor)
  return Number.isFinite(n) ? String(n) : ''
}

/** Lo que va en el formulario: la fila si se está editando, o el valor inicial. */
export function valorDeFila(campo: Campo, fila: Record<string, unknown> | null): ValorFormulario {
  const valor = fila ? fila[campo.nombre] : undefined

  if (valor === null || valor === undefined || valor === '') {
    if (campo.predeterminado !== undefined) return campo.predeterminado
    if (campo.tipo === 'multi') return []
    if (campo.tipo === 'booleano') return false
    return ''
  }

  switch (campo.tipo) {
    case 'multi':
      return Array.isArray(valor) ? valor.map(String) : []
    case 'numeros':
      return Array.isArray(valor) ? valor.map(textoNumero).join(', ') : ''
    case 'booleano':
      return Boolean(valor)
    case 'numero':
      return textoNumero(valor)
    default:
      return String(valor)
  }
}
