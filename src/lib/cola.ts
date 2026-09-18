/**
 * Lo que vive en el celular: el borrador de lo último que se eligió en cada
 * sitio y los movimientos que todavía no llegaron al servidor.
 *
 * IndexedDB a mano, sin librerías. Es lo único que sobrevive a cerrar el
 * navegador y a quedarse sin memoria, y la app tiene que abrir rápido en una
 * antena de 3G en la calle.
 *
 * Módulo de cliente, pero sin 'use client': el esquema del movimiento lo usan
 * también la server action y la ruta que recibe la cola, así el formulario del
 * celular y el servidor no pueden discrepar sobre qué es un movimiento válido.
 */

// ── Qué manda el celular ────────────────────────────────────────────────

const FLUJOS = ['planta', 'punto_verde', 'gran_generador'] as const
const TIPOS = ['ingreso', 'salida'] as const
const CLASES = ['sitio', 'entidad', 'vecino', 'texto'] as const
const TIPOS_DE_ENTIDAD = ['carrero', 'emprendimiento', 'organizacion', 'otro'] as const
// Los once destinos de los formularios de entrega: R-05-06 en la Planta y
// R-05-08 en el punto verde. La cola valida contra la lista completa; cuál se
// ofrece en cada pantalla lo decide valorizacionesDeFlujo(), y la base rechaza
// las mezclas con la restricción valorizacion_segun_flujo.
const VALORIZACIONES = [
  'uso_interno_huerta', 'uso_interno_plazas', 'uso_interno_transforma',
  'vecino', 'ecocanje', 'aserradero', 'cic',
  'manualidades', 'venta', 'asfalto',
  'otro',
] as const

interface ItemDelCelular {
  material_id: string
  cantidad: number
  unidad_id: string
}

interface VecinoDelMovimiento {
  nombre?: string | null
  telefono?: string | null
  barrio?: string | null
  sin_datos: boolean
}

export interface MovimientoDelCelular {
  flujo: (typeof FLUJOS)[number]
  tipo: (typeof TIPOS)[number]
  ocurrido_en: string
  items: ItemDelCelular[]
  origen_clase: (typeof CLASES)[number]
  origen_sitio_id?: string | null
  origen_entidad_id?: string | null
  origen_detalle?: string | null
  destino_clase: (typeof CLASES)[number]
  destino_sitio_id?: string | null
  destino_entidad_id?: string | null
  destino_detalle?: string | null
  /**
   * El vecino se manda con sus datos, no con un id: el vigilador no puede leer
   * la lista de vecinos, así que no tiene forma de elegir uno existente. La
   * base resuelve si es alguien que ya vino (por teléfono) o uno nuevo.
   */
  vecino?: VecinoDelMovimiento | null
  /** Alta en la calle de un carrero o emprendedor que no está en la lista. */
  entidad_nueva?: { nombre: string; tipo: (typeof TIPOS_DE_ENTIDAD)[number] } | null
  tipo_valorizacion?: (typeof VALORIZACIONES)[number] | null
  /**
   * A qué pila entró la poda, o de cuál salió el compost. Es lo que cierra la
   * cadena que pidió la Secretaría: sin esto, un camión de compost no tiene de
   * dónde. Opcional a propósito: perder el movimiento sería peor que perder la
   * trazabilidad de ese movimiento.
   */
  pila_id?: string | null
  vehiculo_id?: string | null
  chofer_id?: string | null
  autorizado_por_id?: string | null
  vigilador_id?: string | null
  observaciones?: string | null
  client_uuid: string
}

// ── Leer un movimiento que llega de afuera ──────────────────────────────

/**
 * Esto lo ejecuta sólo el servidor, pero está escrito a mano y no con Zod
 * porque el archivo entero viaja al celular: lo importan el formulario y la
 * pantalla del turno para la cola y el borrador. Declarar acá un esquema de Zod
 * arrastraba la librería completa —unos 24 KB comprimidos— a la primera visita
 * de un vigilador con datos y mala señal, para no ejecutarse nunca ahí.
 *
 * Son las mismas comprobaciones que hacía el esquema y en el mismo orden:
 * recorta los textos antes de medirlos, completa `sin_datos` cuando no viene, y
 * arma la respuesta campo por campo, así lo que el celular mande de más no
 * llega a la base.
 */

/** Marca interna: un control que no se cumple corta la lectura entera. */
const INVALIDO = Symbol('movimiento inválido')

function rechazar(): never {
  throw INVALIDO
}

function objeto(valor: unknown): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) rechazar()
  return valor as Record<string, unknown>
}

function unaDe<T extends string>(opciones: readonly T[], valor: unknown): T {
  if (typeof valor !== 'string' || !opciones.includes(valor as T)) rechazar()
  return valor as T
}

/** Las versiones 1 a 8 de la RFC 9562, más el uuid en cero y el de todo efes. */
const UUID =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/

function uuid(valor: unknown): string {
  if (typeof valor !== 'string' || !UUID.test(valor)) rechazar()
  return valor
}

/** Recorta y recién después mide, que es el orden en el que estaba escrito. */
function texto(valor: unknown, maximo: number, minimo = 0): string {
  if (typeof valor !== 'string') rechazar()
  const limpio = valor.trim()
  if (limpio.length < minimo || limpio.length > maximo) rechazar()
  return limpio
}

/** Campo que puede faltar, llegar en null, o llegar y tener que ser válido. */
function opcional<T>(valor: unknown, leer: (v: unknown) => T): T | null | undefined {
  return valor === null || valor === undefined ? (valor as null | undefined) : leer(valor)
}

function items(valor: unknown): ItemDelCelular[] {
  if (!Array.isArray(valor) || valor.length < 1 || valor.length > 20) rechazar()
  return valor.map((crudo) => {
    const item = objeto(crudo)
    const material_id = uuid(item.material_id)
    const cantidad = item.cantidad
    if (typeof cantidad !== 'number' || !Number.isFinite(cantidad)) rechazar()
    if (cantidad <= 0 || cantidad > 999999) rechazar()
    return { material_id, cantidad, unidad_id: uuid(item.unidad_id) }
  })
}

function vecino(valor: unknown): VecinoDelMovimiento {
  const datos = objeto(valor)
  const sinDatos = datos.sin_datos
  if (sinDatos !== undefined && typeof sinDatos !== 'boolean') rechazar()
  return {
    nombre: opcional(datos.nombre, (v) => texto(v, 120)),
    telefono: opcional(datos.telefono, (v) => texto(v, 40)),
    barrio: opcional(datos.barrio, (v) => texto(v, 120)),
    sin_datos: sinDatos ?? false,
  }
}

function entidadNueva(valor: unknown) {
  const datos = objeto(valor)
  return {
    nombre: texto(datos.nombre, 120, 2),
    tipo: unaDe(TIPOS_DE_ENTIDAD, datos.tipo),
  }
}

function leer(valor: unknown): MovimientoDelCelular {
  const m = objeto(valor)
  const ocurrido = m.ocurrido_en
  if (typeof ocurrido !== 'string' || ocurrido.length < 1) rechazar()

  return {
    flujo: unaDe(FLUJOS, m.flujo),
    tipo: unaDe(TIPOS, m.tipo),
    ocurrido_en: ocurrido,
    items: items(m.items),
    origen_clase: unaDe(CLASES, m.origen_clase),
    origen_sitio_id: opcional(m.origen_sitio_id, uuid),
    origen_entidad_id: opcional(m.origen_entidad_id, uuid),
    origen_detalle: opcional(m.origen_detalle, (v) => texto(v, 200)),
    destino_clase: unaDe(CLASES, m.destino_clase),
    destino_sitio_id: opcional(m.destino_sitio_id, uuid),
    destino_entidad_id: opcional(m.destino_entidad_id, uuid),
    destino_detalle: opcional(m.destino_detalle, (v) => texto(v, 200)),
    vecino: opcional(m.vecino, vecino),
    entidad_nueva: opcional(m.entidad_nueva, entidadNueva),
    tipo_valorizacion: opcional(m.tipo_valorizacion, (v) => unaDe(VALORIZACIONES, v)),
    pila_id: opcional(m.pila_id, uuid),
    vehiculo_id: opcional(m.vehiculo_id, uuid),
    chofer_id: opcional(m.chofer_id, uuid),
    autorizado_por_id: opcional(m.autorizado_por_id, uuid),
    vigilador_id: opcional(m.vigilador_id, uuid),
    observaciones: opcional(m.observaciones, (v) => texto(v, 500)),
    client_uuid: uuid(m.client_uuid),
  }
}

/**
 * Se sigue llamando `esquemaMovimiento` y respondiendo `safeParse` porque es
 * como lo llaman la server action del formulario y la ruta que recibe la cola.
 */
export const esquemaMovimiento = {
  safeParse(
    valor: unknown,
  ): { success: true; data: MovimientoDelCelular } | { success: false } {
    try {
      return { success: true, data: leer(valor) }
    } catch (error) {
      if (error === INVALIDO) return { success: false }
      throw error // una falla de verdad no es "el movimiento vino mal"
    }
  },
}

export interface EnvioPendiente {
  client_uuid: string
  movimiento: MovimientoDelCelular
  /** Dos líneas para mostrarlo en /hoy sin tener que rearmarlo. */
  resumen: string
  guardado_en: number
  intentos: number
  error?: string
}

// ── Borrador: lo último que se eligió en este sitio ──────────────────────

export type ClaveRecordada =
  | 'vigilador'
  | 'procedencia'
  | 'destino'
  | 'autoriza'
  | 'vehiculo'
  | 'chofer'

function clave(sitioId: string, que: ClaveRecordada) {
  return `ambiente.${que}.${sitioId}`
}

export function recordado(sitioId: string, que: ClaveRecordada): string {
  try {
    return localStorage.getItem(clave(sitioId, que)) ?? ''
  } catch {
    return '' // modo privado
  }
}

export function recordar(sitioId: string, que: ClaveRecordada, valor: string) {
  try {
    if (valor) localStorage.setItem(clave(sitioId, que), valor)
    else localStorage.removeItem(clave(sitioId, que))
  } catch {
    /* modo privado: se pierde el borrador, no el movimiento */
  }
}

// ── Base local ──────────────────────────────────────────────────────────

const BASE = 'ambiente'
const ALMACEN = 'envios'

let conexion: Promise<IDBDatabase> | null = null

function abrir(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Este navegador no puede guardar sin señal.'))
  }
  if (!conexion) {
    conexion = new Promise((resolver, rechazar) => {
      const pedido = indexedDB.open(BASE, 1)
      pedido.onupgradeneeded = () => {
        if (!pedido.result.objectStoreNames.contains(ALMACEN)) {
          pedido.result.createObjectStore(ALMACEN, { keyPath: 'client_uuid' })
        }
      }
      pedido.onsuccess = () => resolver(pedido.result)
      pedido.onerror = () => rechazar(pedido.error ?? new Error('No se pudo abrir la base local.'))
    })
  }
  return conexion
}

function esperar<T>(pedido: IDBRequest<T>): Promise<T> {
  return new Promise((resolver, rechazar) => {
    pedido.onsuccess = () => resolver(pedido.result)
    pedido.onerror = () => rechazar(pedido.error ?? new Error('Falló la base local.'))
  })
}

async function enAlmacen<T>(
  modo: IDBTransactionMode,
  fn: (almacen: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const base = await abrir()
  const tx = base.transaction(ALMACEN, modo)
  return esperar(fn(tx.objectStore(ALMACEN)))
}

// ── Avisos a la pantalla ────────────────────────────────────────────────

const oyentes = new Set<() => void>()

/** Se suscribe a los cambios de la cola. Devuelve cómo darse de baja. */
export function alCambiar(fn: () => void): () => void {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}

function avisar() {
  for (const fn of oyentes) fn()
}

// ── Cola ────────────────────────────────────────────────────────────────

/**
 * Guarda un movimiento que no se pudo enviar. Si falla, falla fuerte: el
 * formulario tiene que poder decirle al vigilador que lo anote en papel en
 * lugar de darle por bueno algo que se perdió.
 */
export async function guardar(movimiento: MovimientoDelCelular, resumen: string): Promise<void> {
  const envio: EnvioPendiente = {
    client_uuid: movimiento.client_uuid,
    movimiento,
    resumen,
    guardado_en: Date.now(),
    intentos: 0,
  }
  await enAlmacen('readwrite', (a) => a.put(envio))
  avisar()
}

export async function listar(): Promise<EnvioPendiente[]> {
  try {
    const filas = await enAlmacen<EnvioPendiente[]>('readonly', (a) => a.getAll() as IDBRequest<EnvioPendiente[]>)
    return filas.sort((a, b) => a.guardado_en - b.guardado_en)
  } catch {
    return []
  }
}

export async function pendientes(): Promise<number> {
  return (await listar()).length
}

async function quitar(client_uuid: string) {
  await enAlmacen('readwrite', (a) => a.delete(client_uuid))
}

async function anotarIntento(envio: EnvioPendiente, error: string) {
  const actualizado: EnvioPendiente = { ...envio, intentos: envio.intentos + 1, error }
  await enAlmacen('readwrite', (a) => a.put(actualizado))
}

function conCorte(milisegundos: number): AbortSignal | undefined {
  // AbortSignal.timeout no está en navegadores viejos; sin él simplemente se
  // espera lo que tarde el navegador en cortar solo.
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(milisegundos)
    : undefined
}

let sincronizando = false

/**
 * Sube los pendientes de a uno. Como crearMovimiento es idempotente por
 * client_uuid, reintentar uno que ya había entrado no lo duplica: devuelve el
 * mismo número y se borra de la cola.
 */
export async function sincronizar(): Promise<{ subidos: number; quedan: number }> {
  if (sincronizando) return { subidos: 0, quedan: await pendientes() }
  sincronizando = true
  let subidos = 0

  try {
    for (const envio of await listar()) {
      let respuesta: Response
      try {
        respuesta = await fetch('/api/sincronizar', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(envio.movimiento),
          signal: conCorte(20000),
        })
      } catch {
        break // sigue sin señal: se reintenta cuando vuelva
      }

      if (respuesta.ok) {
        await quitar(envio.client_uuid)
        subidos++
        continue
      }

      if (respuesta.status === 401) {
        await anotarIntento(envio, 'Se cerró la sesión. Volvé a entrar a la app.')
        break
      }
      if (respuesta.status >= 500) {
        await anotarIntento(envio, 'El servidor no está respondiendo. Se reintenta solo.')
        break
      }

      const cuerpo = (await respuesta.json().catch(() => null)) as { error?: string } | null
      await anotarIntento(envio, cuerpo?.error ?? 'El servidor no aceptó este movimiento.')
    }
  } finally {
    sincronizando = false
    avisar()
  }

  return { subidos, quedan: await pendientes() }
}

/**
 * Intenta subir al abrir la app y cada vez que vuelve la señal. Devuelve la
 * función para desengancharse.
 */
export function activarSincronizacion(): () => void {
  if (typeof window === 'undefined') return () => {}

  const intentar = () => { void sincronizar() }
  window.addEventListener('online', intentar)
  // Volver a la pestaña después de caminar media cuadra también es "volvió la señal".
  const alVolver = () => { if (document.visibilityState === 'visible') intentar() }
  document.addEventListener('visibilitychange', alVolver)

  if (navigator.onLine) intentar()

  return () => {
    window.removeEventListener('online', intentar)
    document.removeEventListener('visibilitychange', alVolver)
  }
}
