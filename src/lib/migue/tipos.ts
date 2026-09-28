/**
 * El contrato de Migue: qué es una herramienta, qué devuelve, qué se le manda
 * al modelo y qué viaja al navegador.
 *
 * Todo lo demás del módulo se escribe contra esto. Está separado de la lógica
 * porque lo usan dos lados —el servidor que arma las respuestas y el
 * componente del chat que las dibuja— y el componente no puede importar nada
 * que arrastre la base de datos.
 */

// ── Lo que se le manda al modelo ────────────────────────────────────────
// Es el formato de chat de OpenAI, que es el que habla OpenRouter. Se escribe a
// mano en vez de traer un paquete: son cuatro formas de mensaje y una de
// herramienta, y el proyecto no suma dependencias por menos que eso.

export interface LlamadaDeHerramienta {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type MensajeDelModelo =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlamadaDeHerramienta[] }
  | { role: 'tool'; tool_call_id: string; content: string }

/**
 * Esquema estricto: todas las propiedades en `required` y
 * `additionalProperties: false`. Con `strict` el proveedor garantiza que los
 * argumentos cumplan el esquema; lo que el esquema no puede decir —que una
 * fecha exista, que un rango no esté al revés— lo valida `validar()`.
 *
 * Los opcionales no se escriben como null: se usa un valor centinela en cada
 * enum ('todos', 'cualquiera') y el texto vacío en los campos libres. Es una
 * sola forma de decir «sin filtro» en todas las herramientas, y el servidor la
 * traduce sin adivinar.
 */
export interface EsquemaDeParametros {
  type: 'object'
  properties: Record<string, unknown>
  required: string[]
  additionalProperties: false
}

export interface DefinicionDeHerramienta {
  type: 'function'
  function: {
    name: string
    description: string
    strict: true
    parameters: EsquemaDeParametros
  }
}

// ── Quién pregunta ──────────────────────────────────────────────────────

export type RolDeMigue = 'admin' | 'vigilador'
export type TipoDeSitio = 'planta' | 'punto_verde'

export interface PuntoDeLaSesion {
  id: string
  codigo: string
  nombre: string
  tipo: TipoDeSitio
  /** false en los puntos donde sólo se carga el conteo diario (hoy, PV-03). */
  cargaDetallada: boolean
}

/**
 * El catálogo vivo que se lee al abrir cada conversación y queda congelado con
 * ella: de acá salen los enums de las herramientas y la parte del sistema que
 * dice cómo se llaman las cosas. No lleva ids: el modelo nombra por código o
 * por nombre, y el servidor resuelve el id en el momento de consultar.
 */
export interface Catalogo {
  puntos: Array<{
    codigo: string
    nombre: string
    direccion: string
    tipo: TipoDeSitio
    cargaDetallada: boolean
  }>
  materiales: Array<{
    nombre: string
    categoria: string
    flujos: string[]
    tipos: string[]
    unidad: string
  }>
  recipientes: Array<{
    codigo: string
    nombre: string
    /** null = no se suma a los m³ (kg, bolsa). */
    factorM3: number | null
  }>
  /** Códigos de pila activas, para el enum de la ficha de pila. */
  pilas: string[]
  expresionesAprobadas: Array<{ expresion: string; significado: string; tipo: string; referencia: string }>
  recuerdos: Array<{ id: string; texto: string }>
}

// ── Lo que devuelve una herramienta ─────────────────────────────────────

/**
 * Un botón debajo de la respuesta.
 *
 * `respalda` dice qué muestra la pantalla de destino, porque no siempre es lo
 * mismo y la persona tiene que saber qué va a encontrar:
 *   'numero'  la pantalla dibuja exactamente ese número, calculado por la
 *             misma función;
 *   'filas'   la pantalla lista las filas que lo componen;
 *   'regla'   la pantalla es donde se hace lo que se explicó.
 */
export interface Enlace {
  rotulo: string
  href: string
  respalda: 'numero' | 'filas' | 'regla'
}

export interface Resultado {
  /**
   * Una frase lista para decir: «Planta, del 1 al 31 de agosto, sólo
   * vigentes». Va siempre, y la pantalla la dibuja debajo del enlace además de
   * que el modelo la diga: un número sin su alcance es la mentira más fácil de
   * este sistema.
   */
  alcance: string
  /** Lo que ve el modelo. Ya formateado como se dice: coma decimal, fechas de Tucumán. */
  datos: unknown
  enlaces: Enlace[]
  /**
   * Los números que la respuesta puede citar. Los arma cada herramienta desde
   * sus columnas numéricas y de fecha —nunca desde texto libre— y el
   * verificador no deja pasar ningún otro.
   */
  numeros: number[]
  /** Algo que el modelo tiene que decir sí o sí: «los volteos anotados desde el celular todavía no se ven acá». */
  nota?: string
  /**
   * false cuando lo consultado todavía no se empezó a cargar en todo el
   * sistema. Distingue «no hubo» de «nadie cargó nunca».
   */
  hayDatosEnElSistema?: boolean
  /**
   * Sólo la meta-herramienta de corte: la base ya cerró y vació la
   * conversación, y el orquestador tiene que terminar acá sin guardar el turno.
   */
  cortar?: true
}

// ── El contexto con que corre una herramienta ───────────────────────────

export interface ContextoDeHerramienta {
  rol: RolDeMigue
  /** Siempre de la sesión. Nunca del modelo, nunca del navegador. */
  punto: PuntoDeLaSesion | null
  ahora: Date
  catalogo: Catalogo
  /** Movimientos guardados en el celular que todavía no subieron. */
  pendientesEnElCelular: number
  conversacionId: string
  /** La pregunta tal como la escribió la persona, para las guardas de recordar y anotar_expresion. */
  pregunta: string
}

/**
 * `numeros` en un rechazo: las cifras que el propio mensaje dice («el tablero
 * llega hasta 24 meses»). Las arma el servidor, no son texto libre, y sin esto
 * una respuesta que las repite para explicar el rechazo caía en el control.
 */
export type Validacion<E> = { ok: true; valor: E } | { ok: false; error: string; numeros?: number[] }

/**
 * Una consulta que Migue puede hacer.
 *
 * Las de lectura corren todas en UNA transacción de sólo lectura con la sesión
 * de quien pregunta: la base rechaza cualquier escritura aunque el SQL la
 * tuviera, y RLS filtra igual que en las pantallas. Las `meta` (recordar,
 * anotar una expresión, avisar o cortar un maltrato) corren aparte, en una
 * transacción normal, y sólo llaman a las funciones app.migue_* de la 0025.
 */
export interface Herramienta<E = unknown> {
  nombre: string
  clase: 'lectura' | 'meta'
  roles: RolDeMigue[]
  /** Sólo para el vigilador: en qué clase de sitio existe. Sin esto, en los dos. */
  tiposDeSitio?: TipoDeSitio[]
  /** Descripción para el modelo: cuándo usarla, qué devuelve y qué NO contesta. */
  descripcion: (catalogo: Catalogo) => string
  parametros: (catalogo: Catalogo) => EsquemaDeParametros
  validar: (entrada: unknown, contexto: ContextoDeHerramienta) => Validacion<E>
  /** La frase que ve la persona mientras corre: «Buscando en los movimientos de la Planta…». */
  estado: (entrada: E) => string
  ejecutar: (tx: import('@db/client').Conexion, entrada: E, contexto: ContextoDeHerramienta) => Promise<Resultado>
}

// ── Lo que viaja al navegador ───────────────────────────────────────────

/** Lo que manda el chat. */
export interface PedidoAMigue {
  /** null para empezar una conversación nueva. */
  conversacionId: string | null
  /** Generado en el navegador. Reintentar con el mismo no cobra dos veces. */
  preguntaId: string
  pregunta: string
  /** Sólo el celular: el id de este teléfono, de localStorage. */
  dispositivoId: string | null
  pendientesEnElCelular: number
}

/** Lo que vuelve, como eventos del servidor (text/event-stream). */
export type EventoDeMigue =
  | { tipo: 'conversacion'; conversacionId: string }
  | { tipo: 'estado'; texto: string }
  | { tipo: 'respuesta'; preguntaId: string; texto: string; enlaces: EnlaceConAlcance[] }
  | { tipo: 'cerrada'; motivo: 'maltrato' | 'larga' | 'olvido' | 'error'; texto: string }
  | { tipo: 'error'; texto: string; reintentar: boolean }

/** El enlace tal como se dibuja: con el alcance del resultado que lo trajo. */
export interface EnlaceConAlcance extends Enlace {
  alcance: string
}

/** Un mensaje de una conversación, tal como lo dibuja la pantalla. */
export interface MensajeVisible {
  preguntaId: string
  quien: 'persona' | 'migue'
  texto: string
  enlaces: EnlaceConAlcance[]
  creadoEn: string
}
