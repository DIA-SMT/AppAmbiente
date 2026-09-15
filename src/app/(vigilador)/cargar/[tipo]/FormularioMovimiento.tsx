'use client'

/**
 * El formulario que se carga en la calle, con una mano, en menos de medio
 * minuto. Todo lo que se puede saber sin preguntar viene puesto: la hora, el
 * sitio, y lo último que se eligió en este mismo celular.
 *
 * Es el mismo formulario para la Planta y para los puntos verdes: cambian tres
 * bloques, no la estructura. En un punto verde el ingreso lo trae un vecino
 * (sin patente ni chofer) y la salida pide para qué se lleva el material.
 *
 * El envío nunca bloquea al vigilador: si la red no responde, el movimiento se
 * guarda en el celular y la pantalla sigue igual de rápido.
 */

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { guardar, recordado, recordar, type MovimientoDelCelular } from '@/lib/cola'
import {
  ETIQUETA_ENTIDAD, ETIQUETA_TIPO, ETIQUETA_VALORIZACION,
  cantidad, desdeInputFechaHora, fechaHora, numero, paraInputFechaHora,
} from '@/lib/formato'
import type { Flujo, ListasDelFormulario, Material, TipoValorizacion } from '@/lib/tipos'
import BloqueVecino, {
  VECINO_VACIO, recordarBarrio, vecinoSinDatos, type DatosVecino,
} from './BloqueVecino'
import { registrarMovimiento, type EstadoAlta } from './acciones'
import estilos from './FormularioMovimiento.module.css'

const OTRA = 'otra'
const VECINO = 'vecino'
const NUEVA = 'nueva'

const VALORIZACIONES: TipoValorizacion[] = ['reutilizacion', 'venta', 'emprendimiento', 'otro']

/** Lo único que un vigilador puede dar de alta desde la calle. */
const TIPOS_ENTIDAD = ['carrero', 'emprendimiento', 'organizacion', 'otro'] as const
type TipoEntidadNueva = (typeof TIPOS_ENTIDAD)[number]

interface Fila {
  material: string
  /** Como lo escribió o lo tocó el vigilador: puede venir con coma. */
  cantidad: string
  otro: boolean
}

/** Acepta coma decimal, que es lo que muestra el teclado del celular. */
function aNumero(texto: string): number | null {
  const n = Number(texto.replace(',', '.').trim())
  return Number.isFinite(n) && n > 0 ? n : null
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

/** Un redirect de la server action no es un error de red: hay que dejarlo pasar. */
function esRedireccion(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}

function BotonRegistrar({ tipo }: { tipo: 'ingreso' | 'salida' }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="boton exito grande ancho-total" disabled={pending}>
      {pending ? 'Guardando…' : `Registrar ${tipo}`}
    </button>
  )
}

export default function FormularioMovimiento({
  tipo,
  flujo,
  listas,
  ahora,
}: {
  tipo: 'ingreso' | 'salida'
  flujo: Flujo
  listas: ListasDelFormulario
  ahora: string
}) {
  const router = useRouter()
  const sitioId = listas.sitio?.id ?? ''
  const esPuntoVerde = flujo === 'punto_verde'

  // En un punto verde el vecino llega caminando o en su auto: preguntarle la
  // patente y el chofer es tiempo perdido.
  const llevaTransporte = !(esPuntoVerde && tipo === 'ingreso')

  const [cuando, setCuando] = useState(ahora)
  const [fechaAbierta, setFechaAbierta] = useState(false)
  const [tocoFecha, setTocoFecha] = useState(false)
  const [filas, setFilas] = useState<Fila[]>([{ material: '', cantidad: '', otro: false }])
  const [origen, setOrigen] = useState('')
  const [origenTexto, setOrigenTexto] = useState('')
  const [destino, setDestino] = useState('')
  const [autoriza, setAutoriza] = useState('')
  const [vehiculo, setVehiculo] = useState('')
  const [chofer, setChofer] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [vecino, setVecino] = useState<DatosVecino>(VECINO_VACIO)
  const [entidadNombre, setEntidadNombre] = useState('')
  const [entidadTipo, setEntidadTipo] = useState<TipoEntidadNueva | ''>('')
  const [valorizacion, setValorizacion] = useState<TipoValorizacion | ''>('')

  // Se genera una sola vez por formulario: si el primer envío falla y se
  // reintenta, el servidor reconoce que es el mismo movimiento y no lo duplica.
  const uuidRef = useRef('')
  const avisoRef = useRef<HTMLDivElement>(null)

  const porId = useMemo(
    () => new Map(listas.materiales.map((m) => [m.id, m])),
    [listas.materiales],
  )

  const capacidad = useMemo(() => {
    const v = listas.vehiculos.find((x) => x.id === vehiculo)
    const n = Number(v?.capacidad_m3)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [listas.vehiculos, vehiculo])

  const patente = listas.vehiculos.find((x) => x.id === vehiculo)?.patente

  const destinoElegido = listas.destinos.find((d) => d.id === destino)

  // Quién está de turno lo eligió la pantalla anterior y vive en este celular.
  // Si el que quedó guardado ya no está en la lista del punto, se manda vacío
  // antes que romper el alta.
  function vigiladorDelTurno(): string | null {
    const guardado = recordado(sitioId, 'vigilador')
    return listas.vigiladores.some((v) => v.id === guardado) ? guardado : null
  }

  // Lo último que se usó en este punto. Se lee después de montar porque el
  // servidor no tiene localStorage.
  useEffect(() => {
    setCuando(paraInputFechaHora())
    if (!sitioId) return

    if (tipo === 'ingreso') {
      // En un punto verde el origen es el vecino: no hay procedencia que repetir.
      if (!esPuntoVerde) {
        const p = recordado(sitioId, 'procedencia')
        if (listas.origenes.some((o) => o.id === p)) setOrigen(p)
      }
    } else {
      const d = recordado(sitioId, 'destino')
      if (listas.destinos.some((o) => o.id === d)) setDestino(d)
      if (!esPuntoVerde) {
        const a = recordado(sitioId, 'autoriza')
        if (listas.autorizantes.some((x) => x.id === a)) setAutoriza(a)
      }
    }
    const v = recordado(sitioId, 'vehiculo')
    if (listas.vehiculos.some((x) => x.id === v)) setVehiculo(v)
    const c = recordado(sitioId, 'chofer')
    if (listas.choferes.some((x) => x.id === c)) setChofer(c)
  }, [sitioId, tipo, esPuntoVerde, listas])

  function cambiarFila(indice: number, cambios: Partial<Fila>) {
    setFilas((previas) => previas.map((f, i) => (i === indice ? { ...f, ...cambios } : f)))
  }

  function cargadas() {
    return filas.filter((f) => f.material && aNumero(f.cantidad))
  }

  function sugerenciasDe(material: Material | undefined) {
    if (!material) return []
    const base = (material.sugerencias ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
    // La capacidad del vehículo solo sirve si el material se mide en volumen.
    const cap = material.unidad?.codigo === 'm3' ? capacidad : null
    const valores = cap && !base.includes(cap) ? [cap, ...base] : base
    return valores.map((valor) => ({ valor, esCapacidad: valor === cap }))
  }

  function validar(): Record<string, string> {
    const campos: Record<string, string> = {}

    if (tocoFecha && !desdeInputFechaHora(cuando)) campos.cuando = 'Revisá la fecha y la hora.'

    filas.forEach((f, i) => {
      if (!f.material && !f.cantidad.trim()) return // fila de más: se ignora
      if (!f.material) campos[`material-${i}`] = 'Elegí qué material es.'
      else if (!aNumero(f.cantidad)) campos[`cantidad-${i}`] = 'Falta la cantidad.'
    })
    if (cargadas().length === 0) campos['material-0'] ??= 'Elegí qué material es y cuánto.'

    if (tipo === 'ingreso') {
      // Los datos del vecino son todos opcionales: nunca frenan un registro.
      if (!esPuntoVerde) {
        if (!origen) campos.origen = 'Falta de dónde viene.'
        if (origen === OTRA && !origenTexto.trim()) campos.origenTexto = 'Escribí de dónde viene.'
      }
    } else if (esPuntoVerde) {
      if (!destino) campos.destino = 'Falta quién se lo lleva.'
      if (destino === NUEVA) {
        if (entidadNombre.trim().length < 2) campos.entidadNombre = 'Escribí el nombre.'
        if (!entidadTipo) campos.entidadTipo = 'Elegí qué es.'
      }
      if (!valorizacion) campos.valorizacion = 'Elegí para qué se lo lleva.'
    } else {
      if (!destino) campos.destino = 'Falta a dónde va.'
      if (!autoriza) campos.autoriza = 'Falta quién autoriza la salida.'
    }

    return campos
  }

  /** Lo que se manda del vecino. Vacío y "no quiso dar datos" son lo mismo. */
  function datosDelVecino() {
    const sin = vecinoSinDatos(vecino)
    return {
      nombre: sin ? null : vecino.nombre.trim() || null,
      telefono: sin ? null : vecino.telefono.trim() || null,
      barrio: sin ? null : vecino.barrio.trim() || null,
      sin_datos: sin,
    }
  }

  function armar(): MovimientoDelCelular {
    // Si no tocó la fecha, vale el momento del envío y no el que se pintó al
    // abrir la pantalla.
    const instante = (tocoFecha ? desdeInputFechaHora(cuando) : new Date()) ?? new Date()

    const comun = {
      flujo,
      tipo,
      ocurrido_en: instante.toISOString(),
      items: cargadas().map((f) => ({
        material_id: f.material,
        cantidad: aNumero(f.cantidad) ?? 0,
        unidad_id: porId.get(f.material)?.unidad_default_id ?? '',
      })),
      vehiculo_id: llevaTransporte ? vehiculo || null : null,
      chofer_id: llevaTransporte ? chofer || null : null,
      vigilador_id: vigiladorDelTurno(),
      observaciones: observaciones.trim() || null,
      client_uuid: uuidRef.current,
    }

    if (tipo === 'ingreso') {
      // El vecino trae el material: el origen lo arma la base con lo que se
      // manda en `vecino`, y el destino es el propio punto.
      if (esPuntoVerde) {
        return {
          ...comun,
          origen_clase: 'vecino',
          destino_clase: 'sitio',
          destino_sitio_id: sitioId,
          vecino: datosDelVecino(),
        }
      }

      return {
        ...comun,
        origen_clase: origen === OTRA ? 'texto' : 'entidad',
        origen_entidad_id: origen === OTRA ? null : origen,
        origen_detalle: origen === OTRA ? origenTexto.trim() : null,
        destino_clase: 'sitio',
        destino_sitio_id: sitioId,
      }
    }

    if (esPuntoVerde) {
      return {
        ...comun,
        origen_clase: 'sitio',
        origen_sitio_id: sitioId,
        destino_clase: destino === VECINO ? 'vecino' : 'entidad',
        destino_entidad_id: destino === VECINO || destino === NUEVA ? null : destino,
        vecino: destino === VECINO ? datosDelVecino() : null,
        entidad_nueva: destino === NUEVA && entidadTipo
          ? { nombre: entidadNombre.trim(), tipo: entidadTipo }
          : null,
        tipo_valorizacion: valorizacion || null,
      }
    }

    return {
      ...comun,
      origen_clase: 'sitio',
      origen_sitio_id: sitioId,
      // En la Planta al vecino no se le piden datos: la salida se guarda como
      // texto y la coordinadora la ve igual en su listado.
      destino_clase: destino === VECINO ? 'texto' : 'entidad',
      destino_entidad_id: destino === VECINO ? null : destino,
      destino_detalle: destino === VECINO ? 'Vecino' : null,
      autorizado_por_id: autoriza || null,
    }
  }

  function quienEs(): string | undefined {
    if (tipo === 'ingreso') {
      if (esPuntoVerde) return vecino.nombre.trim() || 'Vecino'
      return origen === OTRA ? origenTexto.trim() : listas.origenes.find((o) => o.id === origen)?.nombre
    }
    if (destino === VECINO) return (esPuntoVerde && vecino.nombre.trim()) || 'Vecino'
    if (destino === NUEVA) return entidadNombre.trim()
    return destinoElegido?.nombre
  }

  function resumir(): string {
    const partes = cargadas().map((f) => {
      const m = porId.get(f.material)
      return `${m?.nombre ?? 'Material'} ${cantidad(aNumero(f.cantidad), m?.unidad ?? null)}`
    })
    return [ETIQUETA_TIPO[tipo], partes.join(' + '), quienEs()].filter(Boolean).join(' · ')
  }

  function guardarBorrador() {
    if (!sitioId) return
    if (tipo === 'ingreso') {
      if (esPuntoVerde) recordarBarrio(vecino.barrio)
      else if (origen && origen !== OTRA) recordar(sitioId, 'procedencia', origen)
    } else if (esPuntoVerde) {
      // "Un vecino" y "agregar a la lista" no son destinos que convenga repetir.
      if (destino !== VECINO && destino !== NUEVA) recordar(sitioId, 'destino', destino)
      if (destino === VECINO) recordarBarrio(vecino.barrio)
    } else {
      if (destino) recordar(sitioId, 'destino', destino)
      if (autoriza) recordar(sitioId, 'autoriza', autoriza)
    }
    if (llevaTransporte) {
      recordar(sitioId, 'vehiculo', vehiculo)
      recordar(sitioId, 'chofer', chofer)
    }
  }

  async function enviar(previo: EstadoAlta, datos: FormData): Promise<EstadoAlta> {
    const campos = validar()
    if (Object.keys(campos).length > 0) {
      return { error: 'Faltan datos. Mirá lo marcado en rojo.', campos }
    }

    if (!uuidRef.current) uuidRef.current = nuevoUuid()
    const movimiento = armar()
    const resumen = resumir()
    guardarBorrador()
    datos.set('movimiento', JSON.stringify(movimiento))

    try {
      return (await registrarMovimiento(previo, datos)) ?? {}
    } catch (e) {
      if (esRedireccion(e)) throw e

      // Se cortó la red. Se guarda acá y se sube solo: el vigilador no espera.
      // Si en realidad el servidor llegó a guardarlo, el reintento trae el
      // mismo client_uuid y no se duplica.
      try {
        await guardar(movimiento, resumen)
      } catch {
        return {
          error: 'No hay señal y este celular no puede guardar el movimiento. Anotalo en papel y cargalo cuando vuelva la señal.',
        }
      }
      router.replace('/listo/pendiente')
      return {}
    }
  }

  const [estado, accion] = useActionState<EstadoAlta, FormData>(enviar, {})
  const campos = estado.campos ?? {}

  useEffect(() => {
    if (estado.error) avisoRef.current?.scrollIntoView({ block: 'center' })
  }, [estado])

  const elegidos = new Set(filas.map((f) => f.material).filter(Boolean))
  const puedeAgregar = filas.length < listas.materiales.length

  return (
    <form action={accion} className="pila" noValidate>
      {estado.error && (
        <div className="aviso error" role="alert" ref={avisoRef}>{estado.error}</div>
      )}

      {/* ── Cuándo ─────────────────────────────────────────────────────── */}
      <div className="campo automatico">
        <label htmlFor="cuando">Fecha y hora</label>
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

      {/* ── Qué y cuánto ───────────────────────────────────────────────── */}
      {filas.map((fila, i) => {
        const material = porId.get(fila.material)
        const unidad = material?.unidad
        const sugerencias = sugerenciasDe(material)
        const elegida = aNumero(fila.cantidad)

        return (
          <div key={i} className="tarjeta-plana pila" style={{ padding: 14 }}>
            <div className="campo">
              <div className="fila-entre">
                <label htmlFor={`material-${i}`}>{i === 0 ? 'Material' : `Material ${i + 1}`}</label>
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
                onChange={(e) => cambiarFila(i, { material: e.target.value, cantidad: '', otro: false })}
              >
                <option value="">Elegí el material…</option>
                {listas.materiales
                  .filter((m) => m.id === fila.material || !elegidos.has(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>{m.nombre}</option>
                  ))}
              </select>
              {campos[`material-${i}`] && <span className="error">{campos[`material-${i}`]}</span>}
            </div>

            <div className="campo">
              <label id={`rotulo-cantidad-${i}`} htmlFor={`cantidad-${i}`}>
                Cantidad{unidad ? ` en ${unidad.nombre_plural}` : ''}
              </label>

              {sugerencias.length > 0 && (
                <div className="sugerencias" role="group" aria-labelledby={`rotulo-cantidad-${i}`}>
                  {sugerencias.map((s) => (
                    <button
                      key={s.valor}
                      type="button"
                      className={s.esCapacidad ? estilos.capacidad : undefined}
                      aria-pressed={!fila.otro && elegida === s.valor}
                      onClick={() => cambiarFila(i, { cantidad: String(s.valor), otro: false })}
                    >
                      {numero(s.valor, unidad?.decimales ?? 0)}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={fila.otro}
                    onClick={() => cambiarFila(i, { otro: true })}
                  >
                    Otro
                  </button>
                </div>
              )}

              {sugerencias.some((s) => s.esCapacidad) && patente && (
                <span className="ayuda">
                  Capacidad de {patente}: {cantidad(capacidad, unidad ?? null)}.
                </span>
              )}

              {(fila.otro || sugerencias.length === 0) && (
                <input
                  id={`cantidad-${i}`}
                  className="control"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={unidad ? `¿Cuántos ${unidad.nombre_plural}?` : 'Cantidad'}
                  value={fila.cantidad}
                  aria-invalid={campos[`cantidad-${i}`] ? true : undefined}
                  onChange={(e) => cambiarFila(i, { cantidad: e.target.value })}
                />
              )}
              {campos[`cantidad-${i}`] && <span className="error">{campos[`cantidad-${i}`]}</span>}
            </div>
          </div>
        )
      })}

      {puedeAgregar && (
        <button
          type="button"
          className="boton secundario ancho-total"
          onClick={() => setFilas((p) => [...p, { material: '', cantidad: '', otro: false }])}
        >
          + Agregar otro material
        </button>
      )}

      {/* ── Quién lo trae / quién se lo lleva ──────────────────────────── */}
      {tipo === 'ingreso' && esPuntoVerde && (
        <div className="campo">
          <span className="etiqueta">Quién lo trae</span>
          <BloqueVecino valor={vecino} alCambiar={setVecino} />
        </div>
      )}

      {tipo === 'ingreso' && !esPuntoVerde && (
        <>
          <div className="campo">
            <label htmlFor="origen">Procedencia</label>
            <select
              id="origen"
              className="control"
              value={origen}
              aria-invalid={campos.origen ? true : undefined}
              onChange={(e) => setOrigen(e.target.value)}
            >
              <option value="">¿De dónde viene?</option>
              {listas.origenes.map((o) => (
                <option key={o.id} value={o.id}>{o.nombre}</option>
              ))}
              <option value={OTRA}>Otra procedencia…</option>
            </select>
            {campos.origen && <span className="error">{campos.origen}</span>}
          </div>

          {origen === OTRA && (
            <div className="campo">
              <label htmlFor="origen-texto">¿De dónde viene?</label>
              <input
                id="origen-texto"
                className="control"
                type="text"
                maxLength={200}
                autoComplete="off"
                placeholder="Escribilo como lo dirías"
                value={origenTexto}
                aria-invalid={campos.origenTexto ? true : undefined}
                onChange={(e) => setOrigenTexto(e.target.value)}
              />
              {campos.origenTexto && <span className="error">{campos.origenTexto}</span>}
            </div>
          )}
        </>
      )}

      {tipo === 'salida' && esPuntoVerde && (
        <>
          <div className="campo">
            <label htmlFor="destino">Quién se lo lleva</label>
            <select
              id="destino"
              className="control"
              value={destino}
              aria-invalid={campos.destino ? true : undefined}
              onChange={(e) => setDestino(e.target.value)}
            >
              <option value="">¿Quién se lo lleva?</option>
              {listas.destinos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.pendiente_revision ? `${d.nombre} · a confirmar` : d.nombre}
                </option>
              ))}
              <option value={VECINO}>Un vecino</option>
              <option value={NUEVA}>Agregar a la lista…</option>
            </select>
            {destinoElegido?.pendiente_revision && (
              <span className="fila">
                <span className="chip pendiente">A confirmar</span>
                <span className="menor gris crecer">Lo cargó un vigilador y la coordinadora todavía no lo revisó.</span>
              </span>
            )}
            {campos.destino && <span className="error">{campos.destino}</span>}
          </div>

          {destino === VECINO && <BloqueVecino valor={vecino} alCambiar={setVecino} />}

          {destino === NUEVA && (
            <div className="tarjeta-plana pila" style={{ padding: 14 }}>
              <div className="campo">
                <label htmlFor="entidad-nombre">Nombre</label>
                <input
                  id="entidad-nombre"
                  className="control"
                  type="text"
                  maxLength={120}
                  autoComplete="off"
                  placeholder="Cómo lo anotamos en la lista"
                  value={entidadNombre}
                  aria-invalid={campos.entidadNombre ? true : undefined}
                  onChange={(e) => setEntidadNombre(e.target.value)}
                />
                {campos.entidadNombre && <span className="error">{campos.entidadNombre}</span>}
              </div>

              <div className="campo">
                <label htmlFor="entidad-tipo">Qué es</label>
                <select
                  id="entidad-tipo"
                  className="control"
                  value={entidadTipo}
                  aria-invalid={campos.entidadTipo ? true : undefined}
                  onChange={(e) => setEntidadTipo(e.target.value as TipoEntidadNueva | '')}
                >
                  <option value="">Elegí qué es…</option>
                  {TIPOS_ENTIDAD.map((t) => (
                    <option key={t} value={t}>{ETIQUETA_ENTIDAD[t]}</option>
                  ))}
                </select>
                {campos.entidadTipo && <span className="error">{campos.entidadTipo}</span>}
              </div>

              <span className="menor gris">
                Queda en la lista para que la coordinadora lo confirme.
              </span>
            </div>
          )}

          <div className="campo">
            <span className="etiqueta" id="rotulo-valorizacion">Para qué se lo lleva</span>
            <div className="sugerencias" role="group" aria-labelledby="rotulo-valorizacion">
              {VALORIZACIONES.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={valorizacion === v}
                  onClick={() => setValorizacion(v)}
                >
                  {ETIQUETA_VALORIZACION[v]}
                </button>
              ))}
            </div>
            {campos.valorizacion && <span className="error">{campos.valorizacion}</span>}
          </div>
        </>
      )}

      {tipo === 'salida' && !esPuntoVerde && (
        <>
          <div className="campo">
            <label htmlFor="destino">Destino</label>
            <select
              id="destino"
              className="control"
              value={destino}
              aria-invalid={campos.destino ? true : undefined}
              onChange={(e) => setDestino(e.target.value)}
            >
              <option value="">¿A dónde va?</option>
              {listas.destinos.map((d) => (
                <option key={d.id} value={d.id}>{d.nombre}</option>
              ))}
              <option value={VECINO}>Vecino</option>
            </select>
            {campos.destino && <span className="error">{campos.destino}</span>}
          </div>

          <div className="campo">
            <label htmlFor="autoriza">Quién autoriza</label>
            <select
              id="autoriza"
              className="control"
              value={autoriza}
              aria-invalid={campos.autoriza ? true : undefined}
              onChange={(e) => setAutoriza(e.target.value)}
            >
              <option value="">Elegí quién autorizó…</option>
              {listas.autorizantes.map((a) => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>
            {campos.autoriza && <span className="error">{campos.autoriza}</span>}
          </div>
        </>
      )}

      {/* ── Transporte ─────────────────────────────────────────────────── */}
      {llevaTransporte && (
        <>
          <div className="campo">
            <label htmlFor="vehiculo">Patente</label>
            <select id="vehiculo" className="control" value={vehiculo} onChange={(e) => setVehiculo(e.target.value)}>
              <option value="">Sin vehículo</option>
              {listas.vehiculos.map((v) => (
                <option key={v.id} value={v.id}>{v.patente}</option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="chofer">Chofer</label>
            <select id="chofer" className="control" value={chofer} onChange={(e) => setChofer(e.target.value)}>
              <option value="">Sin chofer</option>
              {listas.choferes.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="campo">
        <label htmlFor="observaciones">Observaciones</label>
        <textarea
          id="observaciones"
          className="control"
          maxLength={500}
          placeholder="Solo si hace falta aclarar algo"
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
        />
      </div>

      <BotonRegistrar tipo={tipo} />
    </form>
  )
}
