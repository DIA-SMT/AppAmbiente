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
import { ETIQUETA_ENTIDAD, ETIQUETA_FLUJO, ETIQUETA_TIPO, ETIQUETA_VALORIZACION } from './formato'
import type { Flujo, TipoValorizacion } from './tipos'

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
  /**
   * Rótulo del bloque que este campo comparte con los que vienen pegados y
   * declaran el mismo texto.
   *
   * Es para las casillas, que no dibujan rótulo propio —el rótulo es el texto
   * que va al lado del tilde—. Sueltas quedaban una en cada celda de la grilla,
   * arrancando más arriba que el select de al lado, y la explicación que valía
   * para las dos colgaba de la última y le estiraba el alto a toda la fila.
   * Juntas son un bloque con un rótulo, una explicación y nada al costado.
   */
  grupo?: string
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
  /**
   * Lo que hay que saber antes de llenar el formulario, dicho una sola vez y
   * arriba de todo. Lo que explica varios campos a la vez no puede colgar de la
   * ayuda de uno: ahí estira el alto de su fila de la grilla y deja al lado dos
   * huecos en blanco del tamaño de la explicación.
   */
  nota?: string
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
/**
 * Los códigos de unidad que acepta la base, en el orden en que se muestran.
 *
 * La lista sale del CHECK de la migración 0015, no de la 0003: ahí se cambiaron
 * las unidades inventadas por los recipientes reales con los que se estima en
 * portería (no hay balanza). Esta lista había quedado con la vieja, y por eso
 * cuatro de los ocho recipientes —tambor, carro de Delfi, contenedor y batea
 * alargada— no se podían editar desde el panel: su código no figuraba en el
 * select y el formulario lo dejaba vacío.
 *
 * «bolsa» vuelve porque el formulario de entrega de chips, compost y leña
 * (R-05-06) pregunta «Cantidad en bolsas o m3». La 0015 la había desactivado
 * junto con las inventadas.
 *
 * «tn» y «unidad» siguen acá aunque estén desactivadas: hay movimientos viejos
 * que las usan y, sin su código en el select, esas filas tampoco se podrían
 * editar. Que estén en la lista no las vuelve a ofrecer en el celular: eso lo
 * decide la columna `activo`.
 */
const ETIQUETA_CODIGO_UNIDAD: Record<string, string> = {
  m3: 'm³', bolsa: 'Bolsa', tambor_200: 'Tambor de 200 L',
  carro_delfi: 'Carro de Delfi', camion: 'Camión', contenedor: 'Contenedor',
  batea: 'Batea', batea_larga: 'Batea alargada',
  kg: 'Kilogramo', tn: 'Tonelada', unidad: 'Unidad',
}
const CODIGOS_UNIDAD = Object.keys(ETIQUETA_CODIGO_UNIDAD)

const ETIQUETA_TIPO_SITIO: Record<string, string> = {
  planta: 'Planta', punto_verde: 'Punto Verde',
}
const ETIQUETA_TIPO_VEHICULO: Record<string, string> = {
  camion: 'Camión', batea: 'Batea', camioneta: 'Camioneta',
  tractor: 'Tractor', otro: 'Otro',
}
/**
 * Los cuatro roles alcanzan para lo que piden los formularios: chofer y
 * autorizante aparecen en las salidas (R-05-06, R-05-08) y el personal de la
 * Planta que firma el control de pilas (R-05-02) es «operario». No falta
 * ninguno.
 *
 * Ojo con «vigilador»: en los cinco formularios operativos el nombre de quien
 * registra va escrito a mano y es obligatorio, no elegido de una lista —son 67
 * vigiladores con rotación permanente y una lista nunca está al día—. El rol
 * sigue existiendo para quien tiene usuario del sistema, pero no es de donde
 * sale el nombre que se anota en cada planilla.
 */
const ETIQUETA_ROL_PERSONA: Record<string, string> = {
  chofer: 'Chofer', vigilador: 'Vigilador',
  autorizante: 'Autorizante', operario: 'Operario',
}

/**
 * Los siete tipos de entidad cubren todos los orígenes y destinos que nombran
 * los formularios: las empresas de transporte y poda (Transporte 9 de Julio,
 * Ecopoda/City Tec, TucuPoda, Edet), los carreros (Molina, Delfi), las
 * dependencias (Secretaría de Servicios Públicos, Mercado Dorrego, CIC) y los
 * destinos externos (aserradero, Planta de Asfalto Municipal). No falta ninguno.
 *
 * Dos opciones que ofrece el formulario de ingreso NO son entidades y no van a
 * esta lista: «Contenedor de poda y orgánico del Punto Verde» es un sitio, y
 * «Vecino que acerca el material» es la clase 'vecino' que el modelo ya tiene.
 */
const TIPOS_DE_ENTIDAD = [
  'empresa', 'emprendimiento', 'organizacion', 'carrero',
  'dependencia_municipal', 'planta_externa', 'otro',
]

// ── Para qué sale el material ───────────────────────────────────────────

/**
 * Las etiquetas viven en formato.ts, que es de donde las toman las pantallas.
 * Acá sólo se decide CUÁLES se ofrecen en cada flujo.
 */
export { ETIQUETA_VALORIZACION }

export const VALORIZACIONES_PLANTA: TipoValorizacion[] = [
  'uso_interno_huerta', 'uso_interno_plazas', 'uso_interno_transforma',
  'vecino', 'ecocanje', 'aserradero', 'cic', 'otro',
]

export const VALORIZACIONES_PUNTO_VERDE: TipoValorizacion[] = [
  'manualidades', 'venta', 'asfalto', 'otro',
]

/**
 * Qué opciones ofrecer al registrar una salida. Los dos vocabularios no se
 * mezclan: en la Planta nadie entrega para «proceso de asfalto» y en un Punto
 * Verde no existe el «uso interno TRANSFORMA».
 *
 * El gran generador no tiene formulario propio todavía, así que se le ofrece el
 * vocabulario del Punto Verde, que es el que más se le parece.
 */
export function valorizacionesDeFlujo(flujo: Flujo): TipoValorizacion[] {
  return flujo === 'planta' ? VALORIZACIONES_PLANTA : VALORIZACIONES_PUNTO_VERDE
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
    /*
     * Los campos de ancho entero van todos juntos al final, y no intercalados.
     * Cada uno corta la fila de la grilla: con 'tipos' en tercer lugar, la fila
     * de arriba quedaba con una celda usada y dos vacías, y así toda la pantalla
     * —«Unidad» sola con dos tercios de fila en blanco al lado—. Agrupados, los
     * campos cortos se completan de a tres y sobra una sola celda.
     */
    campos: [
      { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, maxLargo: 80 },
      {
        nombre: 'categoria', etiqueta: 'Categoría', tipo: 'select', obligatorio: true,
        opciones: opciones(['verdes', 'reciclables', 'textil', 'madera', 'especiales', 'otros'], ETIQUETA_CATEGORIA),
      },
      {
        nombre: 'unidad_default_id', etiqueta: 'Unidad', tipo: 'select',
        obligatorio: true, origen: 'unidades',
        ayuda: 'En qué se anota la cantidad. No toca lo ya cargado.',
      },
      {
        nombre: 'color', etiqueta: 'Color', tipo: 'color', predeterminado: '#126ff5',
        ayuda: 'Con el que sale en el tablero.',
      },
      {
        nombre: 'orden', etiqueta: 'Orden', tipo: 'numero', entero: true, min: 0, max: 999,
        predeterminado: '0', ayuda: 'Más chico, más arriba en la lista del celular.',
      },
      {
        nombre: 'tipos', etiqueta: '¿Entra, sale o las dos cosas?', tipo: 'multi',
        obligatorio: true, ancho: 'entero',
        opciones: opciones(['ingreso', 'salida'], ETIQUETA_TIPO),
        predeterminado: ['ingreso', 'salida'],
        ayuda: 'Con «Salida» sola, el material no aparece cuando se registra una entrada.',
      },
      {
        nombre: 'flujos', etiqueta: '¿En qué flujos se ofrece?', tipo: 'multi', ancho: 'entero',
        opciones: opciones(FLUJOS, ETIQUETA_FLUJO),
        ayuda: 'Sin marcar nada, se ofrece en los tres.',
      },
      {
        nombre: 'sugerencias', etiqueta: 'Cantidades sugeridas', tipo: 'numeros', ancho: 'entero',
        ayuda: 'Los botones que toca el vigilador para no escribir: 4.5, 6, 10, 20. Con punto y separados por coma.',
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
        opciones: opciones(CODIGOS_UNIDAD, ETIQUETA_CODIGO_UNIDAD),
        ayuda: 'La lista es cerrada. Son los recipientes reales con los que se estima en portería, más la bolsa que usa el formulario de entrega de compost y leña.',
      },
      { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, maxLargo: 40 },
      {
        nombre: 'nombre_plural', etiqueta: 'Nombre en plural', tipo: 'texto',
        obligatorio: true, maxLargo: 40, ayuda: 'Se usa para escribir "3 camiones" y no "3 camión".',
      },
      {
        nombre: 'decimales', etiqueta: 'Decimales', tipo: 'numero', entero: true,
        min: 0, max: 3, predeterminado: '0',
        ayuda: 'Cero para camión: no existe medio camión.',
      },
      {
        nombre: 'orden', etiqueta: 'Orden', tipo: 'numero', entero: true, min: 0, max: 999,
        predeterminado: '0', ayuda: 'Más chico, más arriba en la lista.',
      },
      {
        nombre: 'factor_m3', etiqueta: 'Equivalencia en m³', tipo: 'numero', min: 0, ancho: 'entero',
        ayuda: 'Cuántos m³ representa una unidad. Es un supuesto, y sirve para una sola cosa: que el tablero pueda comparar materiales que se miden distinto (camiones contra kilos). Vacío significa que esta unidad no se compara con las otras.',
      },
    ],
  },

  {
    clave: 'sitios',
    tabla: 'sitios',
    singular: 'Punto',
    plural: 'Puntos y Planta',
    articulo: 'un',
    paraQue: 'Los dos predios de la Planta y los ocho puntos verdes. Cada vigilador carga en el suyo.',
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
        ayuda: 'Corto y sin espacios: PVRV-VIV, PV-01. Identifica al punto en todo el sistema.',
      },
      {
        nombre: 'nombre', etiqueta: 'Nombre', tipo: 'texto', obligatorio: true, maxLargo: 80,
        ayuda: 'Ojo con «Huerta»: el predio de la Planta y el Punto Verde que está en el mismo lugar son dos sitios distintos. Los nombres tienen que dejarlo claro.',
      },
      {
        nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', obligatorio: true,
        opciones: opciones(['planta', 'punto_verde'], ETIQUETA_TIPO_SITIO),
        ayuda: 'La Planta de Valorización son dos predios —Vivero y Huerta, que es lo primero que pregunta el formulario de ingreso— y los dos van como Planta.',
      },
      // Sin ancho entero: una dirección entra en la columna igual que el nombre,
      // y a cambio «Orden» deja de quedar solo en una fila para él.
      { nombre: 'direccion', etiqueta: 'Dirección', tipo: 'texto', maxLargo: 120 },
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
        opciones: opciones(TIPOS_DE_ENTIDAD, ETIQUETA_ENTIDAD),
      },
      { nombre: 'contacto', etiqueta: 'Contacto', tipo: 'texto', maxLargo: 80 },
      { nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'texto', maxLargo: 40 },
      { nombre: 'cuit', etiqueta: 'CUIT', tipo: 'texto', maxLargo: 20, ayuda: 'No se muestra en el celular.' },
      { nombre: 'barrio', etiqueta: 'Barrio', tipo: 'texto', maxLargo: 80 },
      // Las dos casillas van en un bloque solo: dicen lo mismo desde los dos
      // lados y se marcan de a una mirada. La explicación es una sola y va acá,
      // en la primera; la de la segunda la repetía entera y era la que estiraba
      // la fila. El bloque ocupa una fila entera, así que va con los otros dos
      // de ancho entero —flujos y notas— y no en el medio de los campos cortos,
      // que si no cada uno corta la fila y deja media grilla vacía.
      {
        nombre: 'habilitada_origen', etiqueta: 'Como origen', tipo: 'booleano',
        grupo: '¿Dónde se la puede elegir?',
        ayuda: 'Origen es de dónde viene lo que entra; destino, a dónde va lo que sale. Marcá al menos una: sin ninguna no se la puede elegir en ningún lado.',
      },
      {
        nombre: 'habilitada_destino', etiqueta: 'Como destino', tipo: 'booleano',
        grupo: '¿Dónde se la puede elegir?',
      },
      {
        nombre: 'flujos', etiqueta: '¿En qué flujos se ofrece?', tipo: 'multi', ancho: 'entero',
        opciones: opciones(FLUJOS, ETIQUETA_FLUJO),
        ayuda: 'Sin marcar nada, se ofrece en los tres.',
      },
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
        nombre: 'entidad_id', etiqueta: 'Pertenece a', tipo: 'select', origen: 'entidades',
        ayuda: 'De qué empresa, carrero u organización es. Vacío = del municipio.',
      },
      {
        nombre: 'capacidad_m3', etiqueta: 'Capacidad en m³', tipo: 'numero', min: 0, ancho: 'entero',
        ayuda: 'Si la cargás, la app propone ese volumen cuando se elige el vehículo y el vigilador no tiene que estimar a ojo. Vacío = se carga a mano.',
      },
    ],
  },

  {
    clave: 'personas',
    tabla: 'personas',
    singular: 'Persona',
    plural: 'Personas',
    articulo: 'una',
    paraQue: 'Choferes, quienes autorizan una salida y el personal de la Planta.',
    nota: 'Los cuatro roles: el chofer maneja, el vigilador está a cargo del turno, '
      + 'el autorizante firma la salida y el operario registra los controles de las pilas. '
      + 'El nombre de quien completa cada planilla va escrito a mano y no sale de esta lista.',
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
        opciones: opciones(Object.keys(ETIQUETA_ROL_PERSONA), ETIQUETA_ROL_PERSONA),
        // Qué hace cada rol se explica arriba, en la nota de la lista: los
        // cuatro juntos son seis renglones, y colgados de este campo le fijaban
        // el alto a «Nombre» y a «Documento», que quedaban con 200 px de blanco
        // abajo.
        ayuda: 'Define en qué listas del celular aparece.',
      },
      {
        nombre: 'documento', etiqueta: 'Documento', tipo: 'texto', maxLargo: 20,
        ayuda: 'No se muestra en el celular ni en el listado.',
      },
      {
        nombre: 'sitio_id', etiqueta: 'Punto donde trabaja', tipo: 'select', origen: 'sitios',
        ayuda: 'Vacío = se ofrece en todos los puntos.',
      },
      {
        nombre: 'entidad_id', etiqueta: 'Pertenece a', tipo: 'select', origen: 'entidades',
        ayuda: 'Vacío = es del municipio.',
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
