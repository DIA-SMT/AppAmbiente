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
import { valorizacionesDeFlujo } from '@/lib/recursos'
import type {
  FilaPila, Flujo, ListasDelFormulario, Material, TipoValorizacion, Unidad,
} from '@/lib/tipos'
import BloqueVecino, {
  VECINO_VACIO, recordarBarrio, vecinoSinDatos, type DatosVecino,
} from './BloqueVecino'
import { registrarMovimiento, type EstadoAlta } from './acciones'
import estilos from './FormularioMovimiento.module.css'

const OTRA = 'otra'
const OTRO_DESTINO = 'otro-destino'
const VECINO = 'vecino'
const NUEVA = 'nueva'


/** Lo único que un vigilador puede dar de alta desde la calle. */
const TIPOS_ENTIDAD = ['carrero', 'emprendimiento', 'organizacion', 'otro'] as const
type TipoEntidadNueva = (typeof TIPOS_ENTIDAD)[number]

/**
 * El nombre corto del recipiente, el que entra en un botón. El largo —"tambor
 * de 200 L", "batea alargada"— va en el title y en el aria-label.
 */
const ETIQUETA_RECIPIENTE: Record<string, string> = {
  m3: 'm³',
  tambor_200: 'tambor',
  carro_delfi: 'carro',
  camion: 'camión',
  contenedor: 'contenedor',
  batea: 'batea',
  batea_larga: 'batea larga',
  kg: 'kg',
}

/** A partir de este tamaño nadie descarga veinte de una: se cuentan de a uno. */
const RECIPIENTE_GRANDE_M3 = 4

// ── La pila ─────────────────────────────────────────────────────────────
// Alguien tiene que decir a qué pila entró la poda y de cuál salió el compost:
// sin eso la cadena «poda que entró → pila → compost que salió → destino» no
// existe. Es un campo más y tiene que costar un toque.

/**
 * Los tres materiales que salen de una pila. El chipeo no: se tritura y se va,
 * no pasa por ninguna. Se reconoce por el nombre porque el material no declara
 * si pasa por pila — es el mismo criterio con el que la siembra arma la cadena.
 */
const MATERIALES_DE_PILA = ['compost', 'triturado', 'leña']

function saleDeUnaPila(nombre: string | undefined): boolean {
  return MATERIALES_DE_PILA.includes((nombre ?? '').trim().toLowerCase())
}

/**
 * "madura en 14 días", "lista hace 2 meses". El signo de dias_para_madurez dice
 * de qué lado de la fecha está: negativo es que ya pasó.
 */
function rotuloMadurez(p: FilaPila): string {
  if (p.dias_para_madurez === null || p.dias_para_madurez === undefined) {
    return 'sin fecha de madurez'
  }
  const dias = Number(p.dias_para_madurez)
  if (!Number.isFinite(dias)) return 'sin fecha de madurez'

  if (dias > 0) {
    if (dias >= 60) return `madura en ${Math.round(dias / 30)} meses`
    return `madura en ${dias} ${dias === 1 ? 'día' : 'días'}`
  }

  const pasados = -dias
  if (pasados === 0) return 'lista hoy'
  if (pasados < 45) return `lista hace ${pasados} ${pasados === 1 ? 'día' : 'días'}`
  const meses = Math.round(pasados / 30)
  return `lista hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`
}

interface Fila {
  material: string
  /** Como lo escribió o lo tocó el vigilador: puede venir con coma. */
  cantidad: string
  otro: boolean
  /** Con qué se está estimando: el id del recipiente elegido. */
  unidad: string
}

const FILA_VACIA: Fila = { material: '', cantidad: '', otro: false, unidad: '' }

/** Acepta coma decimal, que es lo que muestra el teclado del celular. */
function aNumero(texto: string): number | null {
  const n = Number(texto.replace(',', '.').trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * El recipiente que viene puesto al elegir el material. Si el por defecto no
 * está entre los que se pueden usar, vale el primero: nunca queda un recipiente
 * elegido que no se ve en la fila de botones.
 */
function recipientePorDefecto(material: Material | undefined): string {
  if (!material) return ''
  const recipientes = material.recipientes ?? []
  if (recipientes.some((u) => u.id === material.unidad_default_id)) return material.unidad_default_id
  return recipientes[0]?.id ?? material.unidad_default_id
}

/**
 * "¿Cuántos camiones?", "¿Cuántas bateas?". El género no está en la base: en
 * castellano el plural femenino termina en -as y con eso alcanza para los
 * recipientes que existen.
 */
function rotuloCuantos(unidad: Unidad | undefined): string {
  if (!unidad) return 'Cantidad'
  const plural = unidad.nombre_plural || unidad.nombre
  const femenino = /as$/i.test(plural.split(' ')[0] ?? '')
  return `¿${femenino ? 'Cuántas' : 'Cuántos'} ${plural}?`
}

/**
 * "2 camiones = 12 m³". Es la cuenta que hoy se hace de cabeza en la portería
 * y es donde se equivocan. Sin factor —el kg— no hay nada que mostrar, y con
 * factor 1 —el m³— la cuenta diría dos veces lo mismo.
 */
function equivalenteEnM3(
  cuantos: number | null,
  unidad: Unidad | undefined,
  unidadM3: Unidad | undefined,
): string | null {
  const factor = unidad?.factor_m3
  if (!unidad || cuantos === null || factor === null || factor === undefined || factor === 1) {
    return null
  }
  const m3 = unidadM3 ?? { nombre: 'm³', nombre_plural: 'm³', decimales: 1 }
  return `${cantidad(cuantos, unidad)} = ${cantidad(cuantos * factor, m3)}`
}

// ── Destinos escritos a mano en este celular ────────────────────────────
// No hay lista formal de destinos: el mismo lugar termina escrito de cinco
// formas distintas y después no se puede agrupar por nada. Lo último tipeado
// acá vuelve como sugerencia del propio celular.

const CLAVE_DESTINOS = 'ambiente.destinos'
const TOPE_DESTINOS = 20

function destinosDelCelular(): string[] {
  try {
    const crudo: unknown = JSON.parse(localStorage.getItem(CLAVE_DESTINOS) ?? '[]')
    return Array.isArray(crudo) ? crudo.filter((d): d is string => typeof d === 'string') : []
  } catch {
    return [] // modo privado o basura guardada: se sigue sin sugerencias
  }
}

function recordarDestino(destino: string) {
  const limpio = destino.trim()
  if (limpio.length < 2) return
  try {
    const previos = destinosDelCelular().filter((d) => d.toLowerCase() !== limpio.toLowerCase())
    localStorage.setItem(CLAVE_DESTINOS, JSON.stringify([limpio, ...previos].slice(0, TOPE_DESTINOS)))
  } catch {
    /* modo privado: se pierde la lista de destinos, no el movimiento */
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

/** Un redirect de la server action no es un error de red: hay que dejarlo pasar. */
function esRedireccion(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}

/**
 * El destino escrito a mano, en los dos flujos. No hay lista formal de destinos
 * habilitados: el chofer le dice al portero adónde lleva el material. Lo que se
 * escribe acá es la materia prima para formalizar la lista de a poco.
 */
function DestinoLibre({
  valor,
  sugerencias,
  error,
  alCambiar,
}: {
  valor: string
  sugerencias: string[]
  error?: string
  alCambiar: (valor: string) => void
}) {
  return (
    <div className="campo">
      <label htmlFor="destino-texto">¿A dónde va?</label>
      <input
        id="destino-texto"
        className="control"
        type="text"
        list="destinos-del-celular"
        maxLength={200}
        autoComplete="off"
        placeholder="Escribilo como lo dirías"
        value={valor}
        aria-invalid={error ? true : undefined}
        onChange={(e) => alCambiar(e.target.value)}
      />
      <datalist id="destinos-del-celular">
        {sugerencias.map((d) => <option key={d} value={d} />)}
      </datalist>
      <span className="ayuda">
        Lo que escribas acá la coordinadora lo puede convertir después en una opción fija de la lista.
      </span>
      {error && <span className="error">{error}</span>}
    </div>
  )
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
  pilas,
  ahora,
}: {
  tipo: 'ingreso' | 'salida'
  flujo: Flujo
  listas: ListasDelFormulario
  /** En un ingreso, las que están en formación; en una salida, las que se pueden despachar. */
  pilas: FilaPila[]
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
  const [filas, setFilas] = useState<Fila[]>([FILA_VACIA])
  const [origen, setOrigen] = useState('')
  const [origenTexto, setOrigenTexto] = useState('')
  const [destino, setDestino] = useState('')
  const [destinoTexto, setDestinoTexto] = useState('')
  const [destinosEscritos, setDestinosEscritos] = useState<string[]>([])
  const [autoriza, setAutoriza] = useState('')
  const [vehiculo, setVehiculo] = useState('')
  const [chofer, setChofer] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [vecino, setVecino] = useState<DatosVecino>(VECINO_VACIO)
  const [entidadNombre, setEntidadNombre] = useState('')
  const [entidadTipo, setEntidadTipo] = useState<TipoEntidadNueva | ''>('')
  const [valorizacion, setValorizacion] = useState<TipoValorizacion | ''>('')

  // Se arma de a una pila por vez: si hay una sola en formación, el ingreso va
  // ahí y no hay nada que elegir. Un select de un solo elemento es un toque
  // regalado, así que se muestra el código y un botón para cambiarlo.
  const [pila, setPila] = useState(() =>
    tipo === 'ingreso' && pilas.length === 1 ? pilas[0].id : '',
  )
  const [cambiandoPila, setCambiandoPila] = useState(false)

  // Se genera una sola vez por formulario: si el primer envío falla y se
  // reintenta, el servidor reconoce que es el mismo movimiento y no lo duplica.
  const uuidRef = useRef('')
  const avisoRef = useRef<HTMLDivElement>(null)

  const porId = useMemo(
    () => new Map(listas.materiales.map((m) => [m.id, m])),
    [listas.materiales],
  )

  const unidadPorId = useMemo(
    () => new Map(listas.unidades.map((u) => [u.id, u])),
    [listas.unidades],
  )

  // El m³ es la unidad en la que se informa todo: se usa para mostrar el
  // equivalente de lo que se está cargando.
  const unidadM3 = useMemo(
    () => listas.unidades.find((u) => u.codigo === 'm3'),
    [listas.unidades],
  )

  const capacidad = useMemo(() => {
    const v = listas.vehiculos.find((x) => x.id === vehiculo)
    const n = Number(v?.capacidad_m3)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [listas.vehiculos, vehiculo])

  const patente = listas.vehiculos.find((x) => x.id === vehiculo)?.patente

  const destinoElegido = listas.destinos.find((d) => d.id === destino)

  // El campo de la pila aparece y desaparece solo, según lo que se esté
  // cargando: una salida de chipeo no tiene pila de la cual salir.
  const salePorPila = useMemo(
    () => filas.some((f) => f.material && saleDeUnaPila(porId.get(f.material)?.nombre)),
    [filas, porId],
  )

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
    if (tipo === 'salida') setDestinosEscritos(destinosDelCelular())
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

  /**
   * Las sugerencias son "cuántos recipientes", no "cuántos m³": con el camión
   * elegido, ofrecer 20 no significa nada. Por eso los recipientes grandes
   * tienen las suyas y las del material valen solo para m³ y kg.
   */
  function sugerenciasDe(material: Material | undefined, unidad: Unidad | undefined) {
    if (!material) return []

    const factor = unidad?.factor_m3
    if (factor !== null && factor !== undefined && factor >= RECIPIENTE_GRANDE_M3) {
      return [1, 2, 3].map((valor) => ({ valor, esCapacidad: false }))
    }

    const base = (material.sugerencias ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
    // La capacidad del vehículo solo sirve si se está estimando en volumen.
    const cap = unidad?.codigo === 'm3' ? capacidad : null
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
      if (destino === OTRO_DESTINO && !destinoTexto.trim()) {
        campos.destinoTexto = 'Escribí a dónde va.'
      }
      if (!valorizacion) campos.valorizacion = 'Elegí para qué se lo lleva.'
    } else {
      if (!destino) campos.destino = 'Falta a dónde va.'
      if (destino === OTRO_DESTINO && !destinoTexto.trim()) {
        campos.destinoTexto = 'Escribí a dónde va.'
      }
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

  /**
   * La pila que se declara. Fuera de la Planta no hay ninguna, y en una salida
   * que no pasa por pila —el chipeo— lo que se haya elegido antes no se manda:
   * el campo ya no está en pantalla y mandarlo sería declarar algo que nadie vio.
   */
  function pilaDeclarada(): string | null {
    if (flujo !== 'planta') return null
    if (tipo === 'salida' && !salePorPila) return null
    return pila || null
  }

  function armar(): MovimientoDelCelular {
    // Si no tocó la fecha, vale el momento del envío y no el que se pintó al
    // abrir la pantalla.
    const instante = (tocoFecha ? desdeInputFechaHora(cuando) : new Date()) ?? new Date()

    const comun = {
      flujo,
      tipo,
      ocurrido_en: instante.toISOString(),
      // El recipiente elegido es la unidad del ítem. El equivalente en m³ lo
      // calcula la base con la capacidad de cada uno: acá no se manda.
      items: cargadas().map((f) => ({
        material_id: f.material,
        cantidad: aNumero(f.cantidad) ?? 0,
        unidad_id: f.unidad || porId.get(f.material)?.unidad_default_id || '',
      })),
      vehiculo_id: llevaTransporte ? vehiculo || null : null,
      chofer_id: llevaTransporte ? chofer || null : null,
      pila_id: pilaDeclarada(),
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
        destino_clase: destino === VECINO ? 'vecino' : destino === OTRO_DESTINO ? 'texto' : 'entidad',
        destino_entidad_id:
          destino === VECINO || destino === NUEVA || destino === OTRO_DESTINO ? null : destino,
        destino_detalle: destino === OTRO_DESTINO ? destinoTexto.trim() : null,
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
      // texto y la coordinadora la ve igual en su listado. Lo mismo vale para
      // el destino escrito a mano, que es de donde sale la lista a formalizar.
      destino_clase: destino === VECINO || destino === OTRO_DESTINO ? 'texto' : 'entidad',
      destino_entidad_id: destino === VECINO || destino === OTRO_DESTINO ? null : destino,
      destino_detalle:
        destino === VECINO ? 'Vecino' : destino === OTRO_DESTINO ? destinoTexto.trim() : null,
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
    if (destino === OTRO_DESTINO) return destinoTexto.trim()
    return destinoElegido?.nombre
  }

  function resumir(): string {
    const partes = cargadas().map((f) => {
      const m = porId.get(f.material)
      const u = unidadPorId.get(f.unidad) ?? m?.unidad ?? null
      return `${m?.nombre ?? 'Material'} ${cantidad(aNumero(f.cantidad), u)}`
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
      if (destino !== VECINO && destino !== NUEVA && destino !== OTRO_DESTINO) {
        recordar(sitioId, 'destino', destino)
      }
      if (destino === VECINO) recordarBarrio(vecino.barrio)
      if (destino === OTRO_DESTINO) recordarDestino(destinoTexto)
    } else {
      if (destino && destino !== VECINO && destino !== OTRO_DESTINO) {
        recordar(sitioId, 'destino', destino)
      }
      if (destino === OTRO_DESTINO) recordarDestino(destinoTexto)
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
        const unidad = unidadPorId.get(fila.unidad) ?? material?.unidad
        const recipientes = material?.recipientes ?? []
        const sugerencias = sugerenciasDe(material, unidad)
        const elegida = aNumero(fila.cantidad)
        // Al cambiar de recipiente lo escrito se conserva, y puede no coincidir
        // con ninguna sugerencia. Ahí el campo tiene que verse: si no, se manda
        // un número que el vigilador no ve.
        const aMano =
          fila.otro ||
          sugerencias.length === 0 ||
          (fila.cantidad.trim() !== '' && !sugerencias.some((s) => s.valor === elegida))
        const equivalente = equivalenteEnM3(elegida, unidad, unidadM3)

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
                onChange={(e) =>
                  cambiarFila(i, {
                    material: e.target.value,
                    cantidad: '',
                    otro: false,
                    unidad: recipientePorDefecto(porId.get(e.target.value)),
                  })
                }
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
                {rotuloCuantos(unidad)}
              </label>

              {/* No hay balanza: el recipiente es la forma de estimar, y el
                  mismo material entra en tambor y sale en batea. */}
              {recipientes.length > 1 && (
                <div
                  className={`sugerencias ${estilos.recipientes}`}
                  role="group"
                  aria-label="Con qué se estima"
                >
                  {recipientes.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      title={r.nombre}
                      aria-label={r.nombre}
                      aria-pressed={fila.unidad === r.id}
                      onClick={() => cambiarFila(i, { unidad: r.id })}
                    >
                      {ETIQUETA_RECIPIENTE[r.codigo] ?? r.nombre}
                    </button>
                  ))}
                </div>
              )}

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

              {aMano && (
                <input
                  id={`cantidad-${i}`}
                  className="control"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={rotuloCuantos(unidad)}
                  value={fila.cantidad}
                  aria-invalid={campos[`cantidad-${i}`] ? true : undefined}
                  onChange={(e) => cambiarFila(i, { cantidad: e.target.value })}
                />
              )}

              {/* La cuenta que hoy se hace de cabeza en la portería. */}
              {equivalente && <span className="ayuda">{equivalente}</span>}

              {campos[`cantidad-${i}`] && <span className="error">{campos[`cantidad-${i}`]}</span>}
            </div>
          </div>
        )
      })}

      {puedeAgregar && (
        <button
          type="button"
          className="boton secundario ancho-total"
          onClick={() => setFilas((p) => [...p, FILA_VACIA])}
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
              <option value={OTRO_DESTINO}>Otro destino…</option>
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

          {destino === OTRO_DESTINO && (
            <DestinoLibre
              valor={destinoTexto}
              sugerencias={destinosEscritos}
              error={campos.destinoTexto}
              alCambiar={setDestinoTexto}
            />
          )}

          <div className="campo">
            <span className="etiqueta" id="rotulo-valorizacion">Para qué se lo lleva</span>
            <div className="sugerencias" role="group" aria-labelledby="rotulo-valorizacion">
              {valorizacionesDeFlujo(flujo).map((v) => (
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
              <option value={OTRO_DESTINO}>Otro destino…</option>
            </select>
            {campos.destino && <span className="error">{campos.destino}</span>}
          </div>

          {destino === OTRO_DESTINO && (
            <DestinoLibre
              valor={destinoTexto}
              sugerencias={destinosEscritos}
              error={campos.destinoTexto}
              alCambiar={setDestinoTexto}
            />
          )}

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

      {/* ── La pila ────────────────────────────────────────────────────── */}
      {/* Solo en la Planta: el punto verde no tiene pilas. */}
      {flujo === 'planta' && tipo === 'ingreso' && (
        pilas.length === 0 ? (
          <div className="aviso atencion">
            No hay ninguna pila en formación. Pedile a la coordinadora que abra una desde el
            panel. El ingreso se registra igual, pero después no se va a poder decir a qué pila
            entró esta poda.
          </div>
        ) : pilas.length === 1 && !cambiandoPila ? (
          <div className="campo automatico">
            <span className="etiqueta">¿A qué pila va?</span>
            <div className="fila-entre">
              <span className="fuerte">{pilas[0].codigo}</span>
              <button
                type="button"
                className="boton fantasma chico"
                onClick={() => setCambiandoPila(true)}
              >
                Cambiar
              </button>
            </div>
          </div>
        ) : (
          <div className="campo">
            <label htmlFor="pila">¿A qué pila va?</label>
            <select
              id="pila"
              className="control"
              value={pila}
              onChange={(e) => setPila(e.target.value)}
            >
              <option value="">Sin pila</option>
              {pilas.map((p) => (
                <option key={p.id} value={p.id}>{p.codigo}</option>
              ))}
            </select>
            <span className="ayuda">
              Es lo que después dice de qué está hecho el compost que salga de ahí.
            </span>
          </div>
        )
      )}

      {flujo === 'planta' && tipo === 'salida' && salePorPila && pilas.length > 0 && (
        <div className="campo">
          <label htmlFor="pila">¿De qué pila sale?</label>
          <select
            id="pila"
            className="control"
            value={pila}
            onChange={(e) => setPila(e.target.value)}
          >
            <option value="">Sin indicar</option>
            {pilas.map((p) => (
              <option key={p.id} value={p.id}>{p.codigo} · {rotuloMadurez(p)}</option>
            ))}
          </select>
          <span className="ayuda">
            Es lo que permite decir de dónde salió este camión. Si no la sabés, dejalo sin indicar.
          </span>
        </div>
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
