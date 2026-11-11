'use client'

/**
 * Anotar el contenedor que se va. Lo mismo que anota el nodo cuando el camión
 * llega —hora, patente o interno, chofer, qué trae y de dónde— para que las dos
 * puntas se puedan cruzar entre sí y con el Excel de la 9 de Julio.
 *
 * La patente y el chofer se escriben: son de la empresa y no hay una lista que
 * los tenga a todos. El celular recuerda lo que ya se escribió y lo sugiere,
 * que es lo que hace que el mismo camión se anote siempre igual.
 */

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ETIQUETA_DESTINO_CONTENEDOR, desdeInputFechaHora, fechaHora, normalizarPatente, numero,
  paraInputFechaHora,
} from '@/lib/formato'
import type { DestinoSalidaContenedor, Material, Unidad } from '@/lib/tipos'
import { anotarSalida, type EstadoSalida } from './acciones'

const DESTINOS: DestinoSalidaContenedor[] = ['nodo', 'san_felipe', 'huerta', 'otro']
const MAX_MATERIALES = 6

const CLAVE_PATENTES = 'ambiente:salida:patentes'
const CLAVE_CHOFERES = 'ambiente:salida:choferes'
const TOPE_RECORDADOS = 30

function recordados(clave: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(clave) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function recordarEn(clave: string, valor: string) {
  const limpio = valor.trim()
  if (limpio.length < 2) return
  try {
    const previos = recordados(clave).filter((x) => x.toLowerCase() !== limpio.toLowerCase())
    localStorage.setItem(clave, JSON.stringify([limpio, ...previos].slice(0, TOPE_RECORDADOS)))
  } catch {
    /* modo privado: se pierde la sugerencia, no la salida */
  }
}

function nuevoUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Sin https no existe randomUUID, pero sí getRandomValues.
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Acepta coma decimal, que es lo que muestra el teclado del celular. */
function aNumero(texto: string): number | null {
  const n = Number(texto.replace(',', '.').trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

function esRedireccion(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}

/** «¿Cuántos kg?», «¿Cuántos m³?». */
function rotuloCuantos(unidad: Unidad | undefined): string {
  if (!unidad) return 'Cantidad'
  const plural = unidad.nombre_plural || unidad.nombre
  const femenino = /as$/i.test(plural.split(' ')[0] ?? '')
  return `¿${femenino ? 'Cuántas' : 'Cuántos'} ${plural}?`
}

/**
 * La unidad con la que se carga el material. Cada material del punto se estima
 * de una sola forma —la poda en m³, lo seco en kilos—, y si alguno tuviera más
 * de una se ofrece como botones.
 */
function unidadPorDefecto(m: Material | undefined): string {
  if (!m) return ''
  const r = m.recipientes ?? []
  if (r.some((u) => u.id === m.unidad_default_id)) return m.unidad_default_id
  return r[0]?.id ?? m.unidad_default_id
}

interface Fila {
  material: string
  cantidad: string
  unidad: string
}

const FILA_VACIA: Fila = { material: '', cantidad: '', unidad: '' }

export default function FormularioSalida({
  sitioId,
  materiales,
  patentes,
}: {
  sitioId: string
  materiales: Material[]
  /** Las patentes que ya conoce el sistema, para sugerir mientras se escribe. */
  patentes: string[]
}) {
  const router = useRouter()
  const [enviando, iniciar] = useTransition()

  const [cuando, setCuando] = useState(() => paraInputFechaHora())
  const [fechaAbierta, setFechaAbierta] = useState(false)
  const [tocoFecha, setTocoFecha] = useState(false)
  const [patente, setPatente] = useState('')
  const [chofer, setChofer] = useState('')
  const [destino, setDestino] = useState<DestinoSalidaContenedor | ''>('')
  const [destinoDetalle, setDestinoDetalle] = useState('')
  const [filas, setFilas] = useState<Fila[]>([FILA_VACIA])
  const [observaciones, setObservaciones] = useState('')
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [estado, setEstado] = useState<EstadoSalida>({})
  // Uno por intento de carga: si la red reintenta o se toca dos veces, la base
  // ve el mismo y no anota dos salidas. Se renueva recién cuando salió bien.
  const [clientUuid, setClientUuid] = useState('')
  const [sugPatentes, setSugPatentes] = useState<string[]>([])
  const [sugChoferes, setSugChoferes] = useState<string[]>([])

  useEffect(() => {
    setClientUuid(nuevoUuid())
    setSugChoferes(recordados(CLAVE_CHOFERES))
    const propias = recordados(CLAVE_PATENTES)
    const vistas = new Set(propias.map((p) => p.toUpperCase()))
    setSugPatentes([...propias, ...patentes.filter((p) => !vistas.has(p.toUpperCase()))])
  }, [patentes])

  const porId = useMemo(() => new Map(materiales.map((m) => [m.id, m])), [materiales])
  const elegidos = new Set(filas.map((f) => f.material).filter(Boolean))

  // Mientras la hora no se tocó, sigue al reloj: el formulario puede quedar
  // abierto un rato hasta que llega el camión.
  useEffect(() => {
    if (tocoFecha) return
    const t = setInterval(() => setCuando(paraInputFechaHora()), 30_000)
    return () => clearInterval(t)
  }, [tocoFecha])

  function cambiarFila(i: number, cambio: Partial<Fila>) {
    setFilas((p) => p.map((f, j) => (j === i ? { ...f, ...cambio } : f)))
  }

  function validar(): Record<string, string> {
    const c: Record<string, string> = {}
    if (tocoFecha && !desdeInputFechaHora(cuando)) c.cuando = 'Revisá la fecha y la hora.'
    if (patente.trim().length < 2) c.patente = 'Anotá la patente o el número de interno del camión.'
    if (!destino) c.destino = 'Elegí a dónde lo llevan.'
    else if (destino === 'otro' && destinoDetalle.trim().length < 2) c.destinoDetalle = 'Escribí a dónde lo llevan.'
    filas.forEach((f, i) => {
      if (!f.material && !f.cantidad.trim()) return // fila de más: se ignora
      if (!f.material) c[`material-${i}`] = 'Elegí qué material es.'
      else if (!aNumero(f.cantidad)) c[`cantidad-${i}`] = 'Falta la cantidad.'
    })
    if (!filas.some((f) => f.material && aNumero(f.cantidad))) {
      c['material-0'] ??= 'Elegí qué llevaba el contenedor y cuánto.'
    }
    return c
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    setEstado({})
    const c = validar()
    setCampos(c)
    if (Object.keys(c).length) return

    const cargadas = filas.filter((f) => f.material && aNumero(f.cantidad))
    const instante = desdeInputFechaHora(cuando) ?? new Date()

    iniciar(async () => {
      try {
        const r = await anotarSalida({
          salio_en: instante.toISOString(),
          patente,
          chofer: chofer.trim() || null,
          destino: destino as DestinoSalidaContenedor,
          destino_detalle: destino === 'otro' ? destinoDetalle : null,
          observaciones: observaciones.trim() || null,
          items: cargadas.map((f) => ({
            material_id: f.material,
            cantidad: aNumero(f.cantidad) ?? 0,
            unidad_id: f.unidad || unidadPorDefecto(porId.get(f.material)),
          })),
          client_uuid: clientUuid,
        })
        if (!r.ok) {
          setEstado(r)
          // Los errores del servidor usan las mismas claves que los de acá.
          setCampos(r.campos ?? {})
          return
        }
        recordarEn(CLAVE_PATENTES, normalizarPatente(patente))
        if (chofer.trim()) recordarEn(CLAVE_CHOFERES, chofer)
        setEstado(r)
        // Lo que sigue suele ser otro contenedor del mismo camión: patente,
        // chofer y destino quedan; el contenido y la hora, no.
        setFilas([FILA_VACIA])
        setObservaciones('')
        setTocoFecha(false)
        setFechaAbierta(false)
        setCuando(paraInputFechaHora())
        setClientUuid(nuevoUuid())
        router.refresh()
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch (err) {
        if (esRedireccion(err)) throw err
        setEstado({ error: 'No hay conexión. Lo que cargaste sigue acá: probá de nuevo en un rato.' })
      }
    })
  }

  return (
    <form className="pila" onSubmit={enviar} noValidate>
      {estado.ok && (
        <div className="aviso exito" role="status">
          {estado.yaEstaba
            ? 'Esa salida ya estaba anotada. No se cargó dos veces.'
            : 'Salida anotada. Si se lleva otro contenedor, cargalo abajo: patente, chofer y destino quedan puestos.'}
        </div>
      )}
      {estado.error && <div className="aviso error" role="alert">{estado.error}</div>}

      {/* ── Cuándo ─────────────────────────────────────────────────────── */}
      <div className="campo automatico">
        <label htmlFor="cuando">Fecha y hora en que se lo llevan</label>
        {fechaAbierta ? (
          <input
            id="cuando"
            type="datetime-local"
            className="control"
            value={cuando}
            aria-invalid={campos.cuando ? true : undefined}
            onChange={(e) => { setCuando(e.target.value); setTocoFecha(true) }}
          />
        ) : (
          <div className="fila-entre">
            <span className="fuerte cifras">{fechaHora(desdeInputFechaHora(cuando))}</span>
            <button type="button" className="boton fantasma chico" onClick={() => setFechaAbierta(true)}>
              Cambiar
            </button>
          </div>
        )}
        {campos.cuando && <span className="error">{campos.cuando}</span>}
      </div>

      {/* ── El camión ──────────────────────────────────────────────────── */}
      <div className="campo">
        <label htmlFor="patente">Patente o interno</label>
        <input
          id="patente"
          className="control"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={20}
          list="patentes-sugeridas"
          placeholder="Ej.: AC124AZ o interno 12"
          value={patente}
          aria-invalid={campos.patente ? true : undefined}
          onChange={(e) => setPatente(e.target.value)}
        />
        <datalist id="patentes-sugeridas">
          {sugPatentes.map((p) => <option key={p} value={p} />)}
        </datalist>
        {campos.patente && <span className="error">{campos.patente}</span>}
      </div>

      <div className="campo">
        <label htmlFor="chofer">Chofer</label>
        <input
          id="chofer"
          className="control"
          type="text"
          autoComplete="off"
          autoCapitalize="words"
          maxLength={80}
          list="choferes-sugeridos"
          placeholder="Nombre del chofer (si lo sabés)"
          value={chofer}
          aria-invalid={campos.chofer ? true : undefined}
          onChange={(e) => setChofer(e.target.value)}
        />
        <datalist id="choferes-sugeridos">
          {sugChoferes.map((c) => <option key={c} value={c} />)}
        </datalist>
        {campos.chofer && <span className="error">{campos.chofer}</span>}
      </div>

      {/* ── Qué llevaba ────────────────────────────────────────────────── */}
      <p className="menor gris" style={{ margin: 0 }}>
        Lo que tiene adentro de verdad, no lo que dice el rótulo del contenedor.
      </p>

      {filas.map((fila, i) => {
        const material = porId.get(fila.material)
        const recipientes = material?.recipientes ?? []
        const unidad = recipientes.find((u) => u.id === fila.unidad) ?? material?.unidad
        return (
          <div
            key={i}
            className="tarjeta-plana pila"
            style={{ padding: 14 }}
            data-recorrido={i === 0 ? 'contenido' : undefined}
          >
            <div className="campo">
              <div className="fila-entre">
                <label className="etiqueta" htmlFor={`material-${i}`}>
                  {i === 0 ? 'Material' : `Material ${i + 1}`}
                </label>
                {i > 0 && (
                  <button
                    type="button"
                    className="boton fantasma chico"
                    onClick={() => setFilas((p) => p.filter((_, j) => j !== i))}
                  >
                    Quitar
                  </button>
                )}
              </div>
              <select
                id={`material-${i}`}
                className="control"
                value={fila.material}
                aria-invalid={campos[`material-${i}`] ? true : undefined}
                onChange={(e) =>
                  cambiarFila(i, {
                    material: e.target.value,
                    cantidad: '',
                    unidad: unidadPorDefecto(porId.get(e.target.value)),
                  })
                }
              >
                <option value="">Elegí el material…</option>
                {materiales
                  .filter((m) => m.id === fila.material || !elegidos.has(m.id))
                  .map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
              {campos[`material-${i}`] && <span className="error">{campos[`material-${i}`]}</span>}
            </div>

            {material && (
              <div className="campo">
                <label htmlFor={`cantidad-${i}`}>{rotuloCuantos(unidad)}</label>
                {recipientes.length > 1 && (
                  <div className="sugerencias" role="group" aria-label="Con qué se estima">
                    {recipientes.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={fila.unidad === r.id}
                        onClick={() => cambiarFila(i, { unidad: r.id })}
                      >
                        {r.nombre}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  id={`cantidad-${i}`}
                  className="control"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={
                    material.sugerencias?.length
                      ? `Ej.: ${numero(material.sugerencias[material.sugerencias.length - 1], 0)}`
                      : rotuloCuantos(unidad)
                  }
                  value={fila.cantidad}
                  aria-invalid={campos[`cantidad-${i}`] ? true : undefined}
                  onChange={(e) => cambiarFila(i, { cantidad: e.target.value })}
                />
                <span className="ayuda">Estimado. {unidad?.codigo === 'kg' ? 'En kilos.' : unidad?.codigo === 'm3' ? 'En metros cúbicos.' : ''}</span>
                {campos[`cantidad-${i}`] && <span className="error">{campos[`cantidad-${i}`]}</span>}
              </div>
            )}
          </div>
        )
      })}

      {filas.length < MAX_MATERIALES && elegidos.size < materiales.length && (
        <button
          type="button"
          className="boton secundario ancho-total"
          onClick={() => setFilas((p) => [...p, FILA_VACIA])}
        >
          + Agregar otro material
        </button>
      )}

      {/* ── A dónde va ─────────────────────────────────────────────────── */}
      <div className="campo">
        <label htmlFor="destino">Destino final</label>
        <select
          id="destino"
          className="control"
          value={destino}
          aria-invalid={campos.destino ? true : undefined}
          onChange={(e) => setDestino(e.target.value as DestinoSalidaContenedor | '')}
        >
          <option value="">¿A dónde lo llevan?</option>
          {DESTINOS.map((d) => (
            <option key={d} value={d}>{ETIQUETA_DESTINO_CONTENEDOR[d]}</option>
          ))}
        </select>
        {campos.destino && <span className="error">{campos.destino}</span>}
      </div>

      {destino === 'otro' && (
        <div className="campo">
          <label htmlFor="destino-detalle">¿Cuál?</label>
          <input
            id="destino-detalle"
            className="control"
            type="text"
            autoComplete="off"
            maxLength={120}
            value={destinoDetalle}
            aria-invalid={campos.destinoDetalle ? true : undefined}
            onChange={(e) => setDestinoDetalle(e.target.value)}
          />
          {campos.destinoDetalle && <span className="error">{campos.destinoDetalle}</span>}
        </div>
      )}

      <div className="campo">
        <label htmlFor="observaciones">Observaciones</label>
        <textarea
          id="observaciones"
          className="control"
          maxLength={300}
          placeholder="Solo si hace falta aclarar algo"
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
        />
      </div>

      {campos.general && <span className="error">{campos.general}</span>}

      <button type="submit" className="boton exito grande ancho-total" disabled={enviando || !clientUuid}>
        {enviando ? 'Guardando…' : 'Anotar la salida'}
      </button>
    </form>
  )
}
