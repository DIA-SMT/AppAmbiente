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
import { z } from 'zod'

// ── Qué manda el celular ────────────────────────────────────────────────

const uuid = z.uuid()

export const esquemaMovimiento = z.object({
  flujo: z.enum(['planta', 'punto_verde', 'gran_generador']),
  tipo: z.enum(['ingreso', 'salida']),
  ocurrido_en: z.string().min(1),
  items: z
    .array(
      z.object({
        material_id: uuid,
        cantidad: z.number().positive().max(999999),
        unidad_id: uuid,
      }),
    )
    .min(1)
    .max(20),
  origen_clase: z.enum(['sitio', 'entidad', 'vecino', 'texto']),
  origen_sitio_id: uuid.nullish(),
  origen_entidad_id: uuid.nullish(),
  origen_detalle: z.string().trim().max(200).nullish(),
  destino_clase: z.enum(['sitio', 'entidad', 'vecino', 'texto']),
  destino_sitio_id: uuid.nullish(),
  destino_entidad_id: uuid.nullish(),
  destino_detalle: z.string().trim().max(200).nullish(),
  /**
   * El vecino se manda con sus datos, no con un id: el vigilador no puede leer
   * la lista de vecinos, así que no tiene forma de elegir uno existente. La
   * base resuelve si es alguien que ya vino (por teléfono) o uno nuevo.
   */
  vecino: z
    .object({
      nombre: z.string().trim().max(120).nullish(),
      telefono: z.string().trim().max(40).nullish(),
      barrio: z.string().trim().max(120).nullish(),
      sin_datos: z.boolean().default(false),
    })
    .nullish(),
  /** Alta en la calle de un carrero o emprendedor que no está en la lista. */
  entidad_nueva: z
    .object({
      nombre: z.string().trim().min(2).max(120),
      tipo: z.enum(['carrero', 'emprendimiento', 'organizacion', 'otro']),
    })
    .nullish(),
  tipo_valorizacion: z
    .enum(['reutilizacion', 'venta', 'emprendimiento', 'otro'])
    .nullish(),
  vehiculo_id: uuid.nullish(),
  chofer_id: uuid.nullish(),
  autorizado_por_id: uuid.nullish(),
  vigilador_id: uuid.nullish(),
  observaciones: z.string().trim().max(500).nullish(),
  client_uuid: uuid,
})

export type MovimientoDelCelular = z.infer<typeof esquemaMovimiento>

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
