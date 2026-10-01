'use client'

/**
 * El chat con Migue. Lo usan las dos pantallas —la del panel y la del
 * celular— y cambia sólo lo que tiene que cambiar entre una computadora con
 * buena conexión y un teléfono en la calle.
 *
 * Tres cosas que no se ven y que son la mitad del archivo:
 *
 *  · CADA PREGUNTA TIENE SU ID DESDE QUE SE ESCRIBE. Se genera acá, antes de
 *    mandarla, y si la conexión se corta a mitad de la respuesta se vuelve a
 *    pedir con el mismo: el servidor reconoce la pregunta y devuelve lo que ya
 *    contestó, sin volver a llamar al modelo ni a cobrar. Reintentar con un id
 *    nuevo sería pagar dos veces la misma respuesta, y con un 3G que se corta
 *    cada dos cuadras eso no sería la excepción.
 *  · LO ESCRITO NO SE PIERDE. La pregunta queda en el localStorage hasta que
 *    el servidor confirma que la contestó. Sin señal se dice así, y la pregunta
 *    queda esperando: no hay una ruedita girando para siempre.
 *  · LA RESPUESTA LLEGA POR EVENTOS (text/event-stream): primero lo que Migue
 *    está haciendo —«Buscando en los movimientos de la Planta…»—, al final la
 *    respuesta ya verificada. Se lee con fetch y no con EventSource porque
 *    EventSource sólo sabe hacer GET, y la pregunta viaja en el cuerpo.
 *
 * Nada de lo que se importa acá arrastra la base ni zod: este archivo viaja al
 * celular (ver en src/lib/cola.ts la cuenta de los 24 KB).
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { alCambiar, listar } from '@/lib/cola'
import { fechaHora, hora } from '@/lib/formato'
import type { CierreQueSeExplica, ConversacionAnterior, EstadoDeLaConversacion } from '@/lib/migue/historial'
import { LARGO_MAXIMO_PREGUNTA } from '@/lib/migue/limites'
import type { EnlaceConAlcance, EventoDeMigue, MensajeVisible, PedidoAMigue, RolDeMigue } from '@/lib/migue/tipos'
import { HORAS_VISIBLES_EN_EL_CELULAR } from '@/lib/reglas'
import estilos from './conversacion.module.css'
import { TECLADO_EN_PANTALLA } from './pantallaEntera'
import { Retrato } from './Retrato'

// ── Lo que se guarda en este navegador ──────────────────────────────────

/** Una pregunta desde que se toca «Preguntar» hasta que el servidor confirma que la contestó. */
interface PreguntaPendiente {
  preguntaId: string
  texto: string
  escritaEn: string
  /** Ya salió al menos una vez: puede estar contestada del otro lado aunque acá no haya llegado nada. */
  mandada: boolean
  /**
   * La conversación a la que salió. Null antes de salir, o si salió a abrir
   * una nueva y el corte llegó antes de que el servidor dijera cuál.
   */
  conversacionId: string | null
}

const claveDe = (que: 'pendiente' | 'borrador', dueno: string) => `ambiente.migue.${que}.${dueno}`

function leerDelNavegador(clave: string): string | null {
  try {
    return localStorage.getItem(clave)
  } catch {
    return null // modo privado
  }
}

function guardarEnElNavegador(clave: string, valor: string | null) {
  try {
    if (valor) localStorage.setItem(clave, valor)
    else localStorage.removeItem(clave)
  } catch {
    /* modo privado: se pierde si se recarga la pantalla, no al mandarla */
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function leerPendiente(dueno: string): PreguntaPendiente | null {
  const crudo = leerDelNavegador(claveDe('pendiente', dueno))
  if (!crudo) return null
  try {
    const p = JSON.parse(crudo) as Partial<PreguntaPendiente>
    if (!UUID.test(p.preguntaId ?? '') || typeof p.texto !== 'string' || !p.texto) return null
    return {
      preguntaId: p.preguntaId!,
      texto: p.texto.slice(0, LARGO_MAXIMO_PREGUNTA),
      escritaEn: typeof p.escritaEn === 'string' ? p.escritaEn : new Date().toISOString(),
      mandada: p.mandada === true,
      conversacionId: UUID.test(p.conversacionId ?? '') ? p.conversacionId! : null,
    }
  } catch {
    return null
  }
}

/**
 * crypto.randomUUID pide https y un navegador de 2021 en adelante, y los
 * celulares de los puntos no siempre lo son. getRandomValues está desde mucho
 * antes: se arma el mismo uuid versión 4 a mano.
 */
function nuevoId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Si no se pudo guardar (modo privado), por lo menos dura lo que dure la pestaña. */
let dispositivoSinGuardar: string | null = null

/**
 * El uuid de este teléfono para este punto.
 *
 * La conversación del punto es del punto y del teléfono: dos celulares del
 * mismo punto escribiendo en el mismo hilo intercalarían mensajes (0025,
 * encabezado, punto 3). La cuenta es compartida y no sirve para distinguirlos;
 * esto sí. Va por punto porque el mismo teléfono puede terminar en otro punto
 * la semana que viene, con otra cuenta.
 */
function dispositivoDeEsteCelular(sitioId: string): string {
  const clave = `ambiente.dispositivo.${sitioId}`
  const guardado = leerDelNavegador(clave)
  if (guardado && UUID.test(guardado)) return guardado
  const nuevo = dispositivoSinGuardar ?? nuevoId()
  dispositivoSinGuardar = nuevo
  guardarEnElNavegador(clave, nuevo)
  return nuevo
}

// ── Leer la respuesta ───────────────────────────────────────────────────

const TIPOS_DE_EVENTO = new Set(['conversacion', 'estado', 'respuesta', 'cerrada', 'error'])

function esEvento(valor: unknown): valor is EventoDeMigue {
  return typeof valor === 'object' && valor !== null && TIPOS_DE_EVENTO.has((valor as { tipo?: unknown }).tipo as string)
}

/**
 * Los eventos de la respuesta, de a uno, a medida que llegan.
 *
 * Cada evento es un renglón «data: {…}» y una línea en blanco. Los pedazos que
 * entrega la red no respetan ese corte —un evento puede llegar partido en dos,
 * o dos en el mismo pedazo—, así que se junta todo en `resto` y se corta
 * recién en la línea en blanco. Un renglón que no empieza con «data:» es un
 * comentario para mantener viva la conexión, y se saltea.
 */
async function* leerEventos(
  cuerpo: ReadableStream<Uint8Array>,
  alRecibir: () => void,
): AsyncGenerator<EventoDeMigue> {
  const lector = cuerpo.getReader()
  const decodificador = new TextDecoder()
  let resto = ''
  try {
    while (true) {
      const { value, done } = await lector.read()
      if (done) return
      alRecibir()
      resto += decodificador.decode(value, { stream: true })

      let corte = resto.indexOf('\n\n')
      while (corte >= 0) {
        const bloque = resto.slice(0, corte)
        resto = resto.slice(corte + 2)
        corte = resto.indexOf('\n\n')

        const datos = bloque
          .split('\n')
          .map((renglon) => renglon.replace(/\r$/, ''))
          .filter((renglon) => renglon.startsWith('data:'))
          .map((renglon) => renglon.slice(5).replace(/^ /, ''))
          .join('\n')
        if (!datos) continue

        let evento: unknown
        try {
          evento = JSON.parse(datos)
        } catch {
          continue // un evento roto no tira abajo la respuesta entera
        }
        if (esEvento(evento)) yield evento
      }
    }
  } finally {
    // Si se sale antes de tiempo (la pantalla se cerró), se corta la conexión
    // en vez de dejarla abierta bajando algo que ya nadie va a leer.
    lector.cancel().catch(() => {})
  }
}

// ── Las esperas ─────────────────────────────────────────────────────────

/**
 * Sin ningún evento durante este rato, la respuesta se da por cortada. La
 * función que contesta no vive más de 60 segundos (`maxDuration` de
 * /api/migue), así que pasado eso del otro lado ya no hay nadie escribiendo:
 * esperar más es la ruedita eterna. Cortar no pierde nada, porque lo primero
 * que se hace después es preguntar si llegó a guardarse.
 */
const SILENCIO_MAXIMO_MS = 65_000

/** Sin eventos durante este rato, se avisa que está tardando más que de costumbre. */
const SILENCIO_LENTO_MS = 25_000

/** Entre un intento y el siguiente cuando se corta. Después del último, se avisa. */
const ESPERAS_ENTRE_INTENTOS_MS = [1_500, 4_000, 8_000]

/**
 * Cuánto se sigue preguntando por una respuesta que el servidor dice que está
 * en curso. La base da por muerto un reclamo a los cuatro minutos
 * (app.migue_reclamar): pasado eso, el servidor ya contesta que no está.
 */
const ESPERA_EN_CURSO_MS = 5 * 60_000

const esperar = (ms: number) => new Promise<void>((listo) => setTimeout(listo, ms))

/** navigator.onLine sólo es confiable cuando dice que no: con señal mala dice que sí igual. */
const hayRed = () => typeof navigator === 'undefined' || navigator.onLine !== false

// ── Textos ──────────────────────────────────────────────────────────────

const SIN_SESION = 'Se cerró la sesión. Volvé a entrar a la app.'
const SIN_SENAL = 'Sin señal: tu pregunta queda escrita y la mandás cuando vuelva.'
/**
 * Cuando el servidor sí contestó, pero con un error. Decirle «Sin señal» a un
 * vigilador con cuatro rayitas lo deja esperando una señal que ya tiene.
 */
const SERVIDOR_CAIDO = 'Migue no está pudiendo contestar ahora. Tu pregunta queda escrita: probá en un rato.'

/**
 * Lo que se dice al volver a abrir una conversación que se cerró. Cuando el
 * cierre pasa mientras se está preguntando, el texto lo manda el servidor en
 * el evento; éstos son para cuando sólo se sabe el motivo.
 *
 * El de maltrato no explica nada a propósito: no sermonea, no dice quién, y
 * no le cuenta al del turno siguiente lo que hizo el anterior.
 */
const CIERRES: Record<CierreQueSeExplica, string> = {
  larga: 'Esta conversación se hizo demasiado larga para seguirla bien. Empezá otra: lo que Migue recuerda sigue estando.',
  maltrato: 'Esta conversación se cortó. Podés empezar otra cuando quieras.',
  error: 'Esta conversación tuvo un error y no se puede seguir. Empezá otra.',
}

/**
 * Qué va a encontrar la persona del otro lado del botón. No siempre es lo
 * mismo, y un número que la pantalla no dibuja igual es el que más confunde.
 */
const QUE_MUESTRA: Record<EnlaceConAlcance['respalda'], string> = {
  numero: 'ahí está este mismo número',
  filas: 'ahí están las filas, una por una',
  regla: 'ahí es donde se hace',
}

/** Una dirección de adentro de la app. `//otro.sitio` y `/\otro.sitio` los navegadores los leen como de afuera. */
const DE_ADENTRO = /^\/(?![/\\])/

/** /listo/1420: la confirmación de un movimiento, que el celular deja de ver a las 48 horas. */
const CONFIRMACION_DE_MOVIMIENTO = /^\/listo\/\d+(?:[/?#]|$)/

/**
 * El modelo a veces escribe en Markdown aunque se le pida que no. Los
 * asteriscos sueltos en la pantalla del celular se leen como basura, así que
 * se sacan las marcas de negrita y de título y queda el texto.
 */
function sinMarcas(texto: string): string {
  return texto
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
}

// ── Las piezas ──────────────────────────────────────────────────────────

function Enlaces({ enlaces, creadoEn }: { enlaces: EnlaceConAlcance[]; creadoEn: string }) {
  const de = Date.parse(creadoEn)
  const vencio = Number.isFinite(de) && Date.now() - de > HORAS_VISIBLES_EN_EL_CELULAR * 3_600_000
  const deAdentro = enlaces.filter((e) => DE_ADENTRO.test(e.href))
  if (deAdentro.length === 0) return null

  return (
    <ul className={estilos.enlaces}>
      {deAdentro.map((enlace, i) => {
        const queMuestra = QUE_MUESTRA[enlace.respalda]
        const pie = queMuestra ? `${enlace.alcance} · ${queMuestra}` : enlace.alcance

        // Pasadas las 48 horas el celular ya no ve ese movimiento: el botón
        // llevaría a una pantalla que dice que no existe. Queda el rótulo,
        // para que se sepa de qué movimiento se hablaba. La cuenta sale de la
        // hora de la respuesta, que es posterior a la carga: puede haber un
        // rato en que el botón todavía se dibuja y el movimiento ya no se ve,
        // pero nunca al revés.
        if (vencio && CONFIRMACION_DE_MOVIMIENTO.test(enlace.href)) {
          return (
            <li key={`${i}-${enlace.href}`} className="pila-chica">
              <span className="fuerte">{enlace.rotulo}</span>
              <span className="menor gris">
                Pasaron más de {HORAS_VISIBLES_EN_EL_CELULAR} horas: desde el celular ya no se ve.
              </span>
            </li>
          )
        }

        return (
          <li key={`${i}-${enlace.href}`} className="pila-chica">
            {/* Una exportación es una descarga, no una pantalla: con Link, Next
                intentaría traerla como si fuera una página. */}
            {enlace.href.startsWith('/api/') ? (
              <a href={enlace.href} className="boton secundario chico">{enlace.rotulo}</a>
            ) : (
              <Link href={enlace.href} prefetch={false} className="boton secundario chico">{enlace.rotulo}</Link>
            )}
            <span className="menor gris">{pie}</span>
          </li>
        )
      })}
    </ul>
  )
}

function Burbuja({ mensaje }: { mensaje: MensajeVisible }) {
  if (mensaje.quien === 'persona') {
    return (
      <li className={`${estilos.burbuja} ${estilos.persona}`}>
        <p className={estilos.texto}>{mensaje.texto}</p>
      </li>
    )
  }
  return (
    <li className={estilos.filaMigue}>
      <Retrato tamano="burbuja" />
      <div className={`${estilos.burbuja} ${estilos.migue}`}>
        <span className={estilos.quien}>Migue</span>
        <p className={estilos.texto}>{sinMarcas(mensaje.texto)}</p>
        <Enlaces enlaces={mensaje.enlaces} creadoEn={mensaje.creadoEn} />
      </div>
    </li>
  )
}

/**
 * El botón de olvidar, con la confirmación en el lugar: un toque de más con guantes no puede borrar nada.
 *
 * `bloqueado` mientras hay una pregunta andando: la base vaciaría la
 * conversación con el modelo ya pagado, y la respuesta llegaría después como
 * «Algo falló de mi lado», pegada al «Listo: se olvidó». Sin esto el botón
 * quedaba habilitado y «Sí, olvidala» no hacía nada, sin decir por qué.
 */
function Olvidar({
  confirmando,
  trabajando,
  bloqueado,
  alPedir,
  alConfirmar,
  alDesistir,
  refNo,
  refPedir,
}: {
  confirmando: boolean
  trabajando: boolean
  bloqueado: boolean
  alPedir: () => void
  alConfirmar: () => void
  alDesistir: () => void
  /** «No, dejala»: en la burbuja, adonde va el foco cuando aparece la confirmación. */
  refNo?: Ref<HTMLButtonElement>
  /** «Olvidar esta conversación»: en la burbuja, adonde vuelve el foco si se desiste. */
  refPedir?: Ref<HTMLButtonElement>
}) {
  if (!confirmando) {
    return (
      <button ref={refPedir} type="button" className="boton fantasma chico" disabled={bloqueado} onClick={alPedir}>
        Olvidar esta conversación
      </button>
    )
  }
  return (
    <div className="aviso atencion pila-chica">
      <p style={{ margin: 0 }}>
        {bloqueado
          ? 'Esperá a que Migue termine de contestar para olvidar esta conversación.'
          : '¿Olvidar esta conversación? Se borran las preguntas y las respuestas, y no se puede deshacer.'}
      </p>
      <div className="fila">
        <button type="button" className="boton peligro chico" disabled={trabajando || bloqueado} onClick={alConfirmar}>
          {trabajando ? 'Olvidando…' : 'Sí, olvidala'}
        </button>
        <button ref={refNo} type="button" className="boton fantasma chico" disabled={trabajando} onClick={alDesistir}>
          No, dejala
        </button>
      </div>
    </div>
  )
}

/**
 * Adentro de la burbuja, lo único que se desplaza: el saludo y los ejemplos,
 * o la conversación con sus avisos y, al final, empezar de nuevo y olvidar.
 * En las pantallas enteras no hay envoltorio —un fragmento no deja nada en el
 * DOM— y /migue y /preguntar quedan exactamente como estaban.
 */
function Hilo({ enBurbuja, caja, children }: { enBurbuja: boolean; caja: Ref<HTMLDivElement>; children: ReactNode }) {
  if (!enBurbuja) return <>{children}</>
  return (
    <div ref={caja} className={estilos.hilo} tabIndex={0} role="region" aria-label="Lo hablado con Migue">
      {children}
    </div>
  )
}

// ── El chat ─────────────────────────────────────────────────────────────

type Envio =
  | { fase: 'quieto' }
  | { fase: 'mandando'; estado: string; lento: boolean }
  | { fase: 'recuperando'; estado: string }
  | { fase: 'sin_senal' }
  /** Quedó escrita de antes —se recargó la pantalla— y nunca salió: espera un toque. */
  | { fase: 'sin_mandar' }
  | { fase: 'error'; texto: string; reintentar: boolean }

const TARDANDO = ' Está tardando más que de costumbre.'

/** Lo que se le dice al lector de pantalla en cada fase. Vacío donde no hay nada nuevo que decir. */
function textoParaAnunciar(e: Envio): string {
  if (e.fase === 'mandando') return e.lento ? `${e.estado}${TARDANDO}` : e.estado
  if (e.fase === 'recuperando') return e.estado
  if (e.fase === 'sin_senal') return SIN_SENAL
  return ''
}

/**
 * Cómo terminó un intento: contestada (o rechazada), cortada a mitad, hay que
 * mandarla de nuevo, o el servidor contestó con un error.
 *
 * 'cortada' es que no llegó nada: el fetch se cayó o el reloj lo cortó por
 * silencio. 'servidor' es que llegó un 5xx: hay señal, y lo que está caído es
 * la base o la función. No es lo mismo para quien lee la pantalla, y tampoco
 * para los reintentos: insistir contra un servidor caído cada vez que se vuelve
 * a la pestaña no lo levanta.
 */
type Intento = 'terminada' | 'cortada' | 'mandar' | 'servidor'

/** Lo que devuelve GET /api/migue?pregunta=<id>: dónde terminó la pregunta, aunque no sea donde salió. */
type Rastro =
  | { estado: 'hecha'; conversacionId?: unknown; texto: string; enlaces: EnlaceConAlcance[] }
  | { estado: 'en_curso'; conversacionId?: unknown }
  | { estado: 'no_esta' }

export interface PropsDeConversacion {
  rol: RolDeMigue
  /**
   * De quién es lo que se guarda en este navegador: el id del punto en el
   * celular, el de la persona en el panel. Así dos cuentas que usan la misma
   * computadora no se encuentran la pregunta a medio mandar de la otra.
   */
  dueno: string
  /** Lo que ya trajo el servidor (el panel). En el celular va null: se pide al montar, con el uuid del teléfono. */
  inicial: EstadoDeLaConversacion | null
  /** Qué se guarda y por cuánto. Va arriba del cuadro, antes de que se escriba nada. */
  privacidad: string
  /**
   * Por qué Migue no contesta ahora. Con algo acá no hay cuadro, pero la
   * historia se sigue viendo: lo que Migue guardó tiene que poder leerse y
   * olvidarse también el día que no contesta.
   */
  apagado: { titulo: string; detalle: string[] } | null
  ejemplos: string[]
  /** Una conversación vieja, para leerla: sin cuadro y sin empezar de nuevo. */
  soloLectura?: boolean
  /**
   * Adentro de la burbuja que flota sobre las otras pantallas. Ahí no van las
   * anteriores, que quedan para la pantalla entera, y entonces tampoco hay
   * nada que refrescar.
   */
  enBurbuja?: boolean
  /** Si se está viendo. La burbuja cerrada lo esconde, y al abrirla la lista tiene que bajar hasta lo último. */
  aLaVista?: boolean
  /** Llegó una respuesta de Migue. La burbuja cerrada lo avisa con un punto. */
  alContestar?: () => void
}

export default function Conversacion({
  rol,
  dueno,
  inicial,
  privacidad,
  apagado,
  ejemplos,
  soloLectura = false,
  enBurbuja = false,
  aLaVista = true,
  alContestar,
}: PropsDeConversacion) {
  const router = useRouter()
  const esCelular = rol === 'vigilador'
  // Lo llaman funciones async que arrancaron varios renders atrás.
  const alContestarRef = useRef(alContestar)
  alContestarRef.current = alContestar

  const [mensajes, setMensajes] = useState<MensajeVisible[]>(inicial?.mensajes ?? [])
  const [conversacionId, setConversacionId] = useState<string | null>(inicial?.conversacionId ?? null)
  const [cerrada, setCerrada] = useState<string | null>(inicial?.cerrada ? CIERRES[inicial.cerrada.motivo] : null)
  const [anteriores, setAnteriores] = useState<ConversacionAnterior[]>(inicial?.anteriores ?? [])
  const [cargada, setCargada] = useState(inicial !== null)
  /** Por qué no se pudo traer: sin red, o el servidor contestó con un error. */
  const [sinCargar, setSinCargar] = useState<'sin_red' | 'servidor' | null>(null)
  const [pendiente, setPendiente] = useState<PreguntaPendiente | null>(null)
  const [envio, setEnvio] = useState<Envio>({ fase: 'quieto' })
  const [borrador, setBorrador] = useState('')
  const [olvido, setOlvido] = useState<{ id: string; trabajando: boolean } | null>(null)
  const [aviso, setAviso] = useState<{ clase: 'exito' | 'error'; texto: string } | null>(null)
  const [enCola, setEnCola] = useState(0)
  /** Lo mismo que `ocupado`, para dibujar: entre dos intentos no hay fase «mandando» y el olvido igual tiene que esperar. */
  const [atendiendo, setAtendiendo] = useState(false)
  /**
   * Lo que se le dice al lector de pantalla. `vez` alterna para que la misma
   * frase dos veces seguidas —«Leyendo tu pregunta…» en la pregunta
   * siguiente— cambie el texto de la región y se vuelva a leer.
   */
  const [anuncio, setAnuncio] = useState<{ texto: string; vez: number }>({ texto: '', vez: 0 })

  // Las respuestas llegan en funciones async que arrancaron varios renders
  // atrás: leen de acá, no del estado que tenían cuando empezaron.
  const conversacionRef = useRef(conversacionId)
  const cerradaRef = useRef(cerrada)
  const pendienteRef = useRef<PreguntaPendiente | null>(null)
  const envioRef = useRef<Envio>(envio)
  const cargadaRef = useRef(cargada)
  const enColaRef = useRef(0)
  const dispositivo = useRef<string | null>(null)
  const ocupado = useRef(false)
  /**
   * Mientras la base vacía una conversación no sale ninguna pregunta: si
   * reclamara la conversación antes que el olvido, el modelo contestaría, la
   * base ya no la dejaría guardar y llegaría «Algo falló de mi lado» con la
   * respuesta pagada.
   */
  const olvidandoRef = useRef(false)
  /** Se tocó un ejemplo: el botón se desmonta, y el foco no puede caer en la nada. */
  const enfocarLista = useRef(false)
  const montado = useRef(false)
  const lista = useRef<HTMLOListElement>(null)
  const final = useRef<HTMLLIElement>(null)
  /** En la burbuja, lo único que se desplaza. En las pantallas enteras no existe. */
  const hilo = useRef<HTMLDivElement>(null)
  /** El cuadro de la burbuja, para hacerlo crecer donde field-sizing no existe. */
  const cuadro = useRef<HTMLTextAreaElement>(null)
  /**
   * Si el hilo quedó abajo del todo. Lo marca el efecto que lo baja —aunque
   * bajar no haya movido nada, que es cuando todo entra y no hay evento de
   * scroll— y lo desmarca quien sube a releer.
   */
  const hiloAlFondo = useRef(false)
  /** La respuesta que ya se llevó a su primer renglón: la misma no se vuelve a llevar. */
  const respuestaUbicada = useRef<string | null>(null)
  const seccion = useRef<HTMLElement>(null)
  /** En la burbuja: si el foco andaba por el chat, para devolvérselo si se cae. */
  const focoAdentro = useRef(false)
  const confirmacionNo = useRef<HTMLButtonElement>(null)
  const empezarOtra = useRef<HTMLButtonElement>(null)
  /** «Olvidar esta conversación», adonde vuelve el foco después de «No, dejala». */
  const pedirOlvido = useRef<HTMLButtonElement>(null)
  const volverAOlvidar = useRef(false)

  function ponerConversacion(id: string | null) {
    conversacionRef.current = id
    setConversacionId(id)
  }
  function ponerCerrada(texto: string | null) {
    cerradaRef.current = texto
    setCerrada(texto)
  }
  // En sólo lectura no se escribe en el navegador: la pregunta pendiente y el
  // borrador guardados son los de la conversación de ahora, que comparte el
  // dueño con ésta. Olvidar una vieja desde la columna del panel los borraba.
  function ponerPendiente(p: PreguntaPendiente | null) {
    pendienteRef.current = p
    setPendiente(p)
    if (!soloLectura) guardarEnElNavegador(claveDe('pendiente', dueno), p ? JSON.stringify(p) : null)
  }
  function anunciar(texto: string) {
    setAnuncio((antes) => ({ texto, vez: antes.vez + 1 }))
  }
  function ponerEnvio(e: Envio) {
    // Sólo cuando cambia lo que se dice: «Migue sigue buscando la respuesta…»
    // se vuelve a poner en cada vuelta de la espera, y leerlo cada diez
    // segundos tapa todo lo demás. El error no pasa por acá: su caja es
    // role=alert, que sí se lee al aparecer.
    const texto = textoParaAnunciar(e)
    if (texto && texto !== textoParaAnunciar(envioRef.current)) anunciar(texto)
    envioRef.current = e
    setEnvio(e)
  }
  function ponerBorrador(texto: string) {
    setBorrador(texto)
    if (!soloLectura) guardarEnElNavegador(claveDe('borrador', dueno), texto || null)
  }
  function ponerOcupado(valor: boolean) {
    ocupado.current = valor
    setAtendiendo(valor)
  }

  // ── Leer la conversación ──────────────────────────────────────────────

  function aplicar(estado: EstadoDeLaConversacion) {
    setMensajes(estado.mensajes)
    ponerConversacion(estado.conversacionId)
    ponerCerrada(estado.cerrada ? CIERRES[estado.cerrada.motivo] : null)
    setAnteriores(estado.anteriores)
    cargadaRef.current = true
    setCargada(true)
    setSinCargar(null)

    // La pregunta que quedó pendiente ya se contestó: está en la historia.
    const p = pendienteRef.current
    if (p && estado.mensajes.some((m) => m.preguntaId === p.preguntaId && m.quien === 'migue')) {
      ponerPendiente(null)
      if (envioRef.current.fase !== 'quieto') ponerEnvio({ fase: 'quieto' })
    }
  }

  async function leerConversacion(): Promise<EstadoDeLaConversacion | 'sin_sesion' | 'servidor' | null> {
    const parametros = esCelular && dispositivo.current ? `?dispositivo=${dispositivo.current}` : ''
    try {
      const respuesta = await fetch(`/api/migue/conversacion${parametros}`, { cache: 'no-store' })
      if (respuesta.status === 401) return 'sin_sesion'
      if (!respuesta.ok) return 'servidor'
      return (await respuesta.json()) as EstadoDeLaConversacion
    } catch {
      return null
    }
  }

  async function cargar(): Promise<'leida' | 'sin_sesion' | 'sin_red' | 'servidor'> {
    const estado = await leerConversacion()
    if (!montado.current) return 'sin_red'
    if (estado === 'sin_sesion') {
      setAviso({ clase: 'error', texto: SIN_SESION })
      return 'sin_sesion'
    }
    if (estado === 'servidor' || !estado) {
      const motivo = estado === 'servidor' ? 'servidor' : 'sin_red'
      setSinCargar(motivo)
      return motivo
    }
    aplicar(estado)
    return 'leida'
  }

  /**
   * Lo que se refresca son las anteriores: el panel las dibuja del lado del
   * servidor y el celular las trae con la conversación. La burbuja no las
   * muestra, y refrescar el panel desde ahí volvería a armar la pantalla de
   * abajo —el tablero entero— para nada.
   */
  function refrescar() {
    if (enBurbuja) return
    if (esCelular) void cargar()
    else router.refresh()
  }

  // ── Mandar una pregunta ───────────────────────────────────────────────

  function sumarRespuesta(p: PreguntaPendiente, preguntaId: string, texto: string, enlaces: EnlaceConAlcance[]) {
    setMensajes((antes) => {
      if (antes.some((m) => m.preguntaId === preguntaId && m.quien === 'migue')) return antes
      return [
        ...antes.filter((m) => m.preguntaId !== preguntaId),
        { preguntaId, quien: 'persona', texto: p.texto, enlaces: [], creadoEn: p.escritaEn },
        { preguntaId, quien: 'migue', texto, enlaces, creadoEn: new Date().toISOString() },
      ]
    })
    // La burbuja entra en una lista que no es región viva: sin esto, con
    // TalkBack la respuesta llega y nadie la dice.
    anunciar(`Migue respondió: ${sinMarcas(texto)}`)
    alContestarRef.current?.()
  }

  /**
   * La pregunta está en otra conversación que la de la pantalla: el servidor
   * encontró cerrada la de acá (quieta hasta el turno siguiente, cerrada desde
   * otra pestaña, vaciada por un olvido) y abrió otra. Lo de antes pasa a las
   * anteriores, y ésta arranca sola.
   */
  function pasarA(id: string) {
    if (conversacionRef.current !== null && conversacionRef.current !== id) setMensajes([])
    ponerConversacion(id)
    ponerCerrada(null)
  }

  /** El servidor no la tomó y no la va a tomar: vuelve al cuadro, para corregirla o mandarla después. */
  function devolverAlCuadro(p: PreguntaPendiente, texto: string) {
    ponerPendiente(null)
    ponerBorrador(p.texto)
    ponerEnvio({ fase: 'error', texto, reintentar: false })
  }

  async function mandar(p: PreguntaPendiente): Promise<Intento> {
    // La primera vez sale a la conversación que está en pantalla, o a una nueva
    // si ésa se cerró. Las siguientes, a la misma que la primera: es la misma
    // pregunta, y el servidor la reconoce por el id.
    let actual: PreguntaPendiente = p.mandada
      ? p
      : { ...p, mandada: true, conversacionId: cerradaRef.current ? null : conversacionRef.current }
    ponerPendiente(actual)
    ponerEnvio({ fase: 'mandando', estado: 'Leyendo tu pregunta…', lento: false })

    const pedido: PedidoAMigue = {
      conversacionId: actual.conversacionId,
      preguntaId: actual.preguntaId,
      pregunta: actual.texto,
      dispositivoId: esCelular ? dispositivo.current : null,
      pendientesEnElCelular: esCelular ? enColaRef.current : 0,
    }

    const control = new AbortController()
    let corte: ReturnType<typeof setTimeout> | undefined
    let demora: ReturnType<typeof setTimeout> | undefined
    const latido = () => {
      clearTimeout(corte)
      clearTimeout(demora)
      corte = setTimeout(() => control.abort(), SILENCIO_MAXIMO_MS)
      demora = setTimeout(() => {
        const e = envioRef.current
        if (e.fase === 'mandando') ponerEnvio({ ...e, lento: true })
      }, SILENCIO_LENTO_MS)
    }
    latido()

    let contestada = false
    let terminada = false
    let abrioOtra = false
    try {
      const respuesta = await fetch('/api/migue', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(pedido),
        cache: 'no-store',
        signal: control.signal,
      })

      if (respuesta.status === 401) {
        // La pregunta queda guardada: después de volver a entrar se manda igual.
        ponerEnvio({ fase: 'error', texto: SIN_SESION, reintentar: true })
        return 'terminada'
      }
      if (!respuesta.ok || !respuesta.body) {
        // Un 5xx del POST sale antes de abrir el flujo (la base caída al leer
        // la sesión): esta salida no llegó al modelo, y tampoco es falta de
        // señal. Si una salida anterior sí llegó, el mismo id la encuentra.
        if (respuesta.status >= 500) return 'servidor'
        if (!respuesta.body) return 'cortada'
        const cuerpo = (await respuesta.json().catch(() => null)) as { error?: unknown; texto?: unknown } | null
        const texto = typeof cuerpo?.error === 'string'
          ? cuerpo.error
          : typeof cuerpo?.texto === 'string' ? cuerpo.texto : 'Migue no pudo tomar la pregunta. Probá de nuevo.'
        devolverAlCuadro(actual, texto)
        return 'terminada'
      }

      for await (const evento of leerEventos(respuesta.body, latido)) {
        if (!montado.current) break
        switch (evento.tipo) {
          case 'conversacion':
            // El servidor abrió otra, o encontró esta misma pregunta ya
            // tomada en otra (un reintento después de un corte).
            if (conversacionRef.current !== evento.conversacionId) abrioOtra = true
            pasarA(evento.conversacionId)
            actual = { ...actual, conversacionId: evento.conversacionId }
            ponerPendiente(actual)
            break

          case 'estado':
            ponerEnvio({ fase: 'mandando', estado: evento.texto, lento: false })
            break

          case 'respuesta':
            sumarRespuesta(actual, evento.preguntaId, evento.texto, evento.enlaces)
            ponerPendiente(null)
            ponerEnvio({ fase: 'quieto' })
            contestada = terminada = true
            break

          case 'cerrada':
            ponerCerrada(evento.texto)
            anunciar(evento.texto)
            // Vaciada del lado de la base: lo que queda en pantalla ya no existe.
            if (evento.motivo === 'maltrato' || evento.motivo === 'olvido') setMensajes([])
            // Si se cerró antes de contestarla, la pregunta vuelve al cuadro
            // para la conversación siguiente. La que provocó un corte, no.
            if (!contestada && evento.motivo !== 'maltrato') ponerBorrador(actual.texto)
            ponerPendiente(null)
            ponerEnvio({ fase: 'quieto' })
            terminada = true
            break

          case 'error':
            if (evento.reintentar) ponerEnvio({ fase: 'error', texto: evento.texto, reintentar: true })
            else devolverAlCuadro(actual, evento.texto)
            terminada = true
            break
        }
      }
    } catch {
      // Se cortó la conexión, o el reloj la cortó por silencio. Lo decide quien llamó.
    } finally {
      clearTimeout(corte)
      clearTimeout(demora)
    }
    // Con una conversación nueva, la anterior recién ahora pasa a la lista de
    // las anteriores: la del panel la dibuja el servidor y hay que pedírsela.
    if (abrioOtra && contestada && montado.current) refrescar()
    return terminada ? 'terminada' : 'cortada'
  }

  /**
   * Después de un corte: ¿la contestó? Se pregunta antes de volver a mandar,
   * así lo que ya se pagó se muestra en vez de pagarse otra vez.
   *
   * Se busca la pregunta por su id, no adentro de una conversación. La de la
   * pantalla puede haberse cerrado del lado del servidor sin que acá se sepa
   * —el celular dos horas en el bolsillo con /preguntar abierto—: la pregunta
   * sale a X, el servidor encuentra X cerrada por quieta y la toma en una Y
   * nueva. Si la señal se corta antes del evento que avisa de Y, preguntar
   * sólo en X daba «no está», se volvía a mandar y el modelo corría dos veces:
   * dos cobros, y la respuesta de Y huérfana en las anteriores. El servidor la
   * busca en todas las de este dueño y dice en cuál está; la que se cree tener
   * va igual, de pista.
   */
  async function recuperar(p: PreguntaPendiente): Promise<Intento> {
    ponerEnvio({ fase: 'recuperando', estado: 'Se cortó la conexión. Fijándome si Migue llegó a contestar…' })

    // La pantalla se puede pasar a la conversación donde está la pregunta si
    // lo que muestra es la vieja: la misma a la que salió, una cerrada o
    // ninguna. Si muestra otra abierta, es que se empezó otra mientras tanto,
    // y la respuesta no se mezcla ahí.
    const salioA = p.conversacionId
    const puedePasarse = () =>
      conversacionRef.current === null || cerradaRef.current !== null || conversacionRef.current === salioA

    let actual = p
    let sePaso = false
    const desde = Date.now()
    let espera = 2_000
    while (montado.current) {
      const pista = actual.conversacionId ? `&conversacion=${encodeURIComponent(actual.conversacionId)}` : ''
      let respuesta: Response
      try {
        respuesta = await fetch(`/api/migue?pregunta=${encodeURIComponent(actual.preguntaId)}${pista}`, { cache: 'no-store' })
      } catch {
        return 'cortada'
      }
      if (respuesta.status === 401) {
        ponerEnvio({ fase: 'error', texto: SIN_SESION, reintentar: true })
        return 'terminada'
      }
      if (!respuesta.ok) return 'servidor'

      const cuerpo = (await respuesta.json().catch(() => null)) as Rastro | null
      if (!montado.current) return 'terminada'
      // Un 200 que no es JSON de Migue es el portal de un wifi que pide
      // aceptar condiciones antes de dejar salir: eso es falta de señal.
      if (cuerpo?.estado !== 'hecha' && cuerpo?.estado !== 'en_curso' && cuerpo?.estado !== 'no_esta') return 'cortada'
      if (cuerpo.estado === 'no_esta') return 'mandar'

      // Dónde está. Si el servidor no lo dice, es donde se preguntó.
      const donde = typeof cuerpo.conversacionId === 'string' && UUID.test(cuerpo.conversacionId)
        ? cuerpo.conversacionId
        : actual.conversacionId
      if (donde && donde !== actual.conversacionId) {
        // El próximo intento, si hace falta, sale a ésa: el mismo id en la
        // misma conversación, que el servidor reconoce sin volver a cobrar.
        actual = { ...actual, conversacionId: donde }
        ponerPendiente(actual)
      }
      if (donde && donde !== conversacionRef.current && puedePasarse()) {
        pasarA(donde)
        sePaso = true
      }

      if (cuerpo.estado === 'hecha') {
        if (donde && donde !== conversacionRef.current) {
          // No se pudo pasar: se relee la de ahora, y ésa queda en las anteriores.
          ponerPendiente(null)
          ponerEnvio({ fase: 'quieto' })
          void cargar()
          return 'terminada'
        }
        sumarRespuesta(actual, actual.preguntaId, cuerpo.texto, Array.isArray(cuerpo.enlaces) ? cuerpo.enlaces : [])
        ponerPendiente(null)
        ponerEnvio({ fase: 'quieto' })
        // La de antes recién ahora pasa a las anteriores, igual que cuando el
        // servidor avisa de una nueva en el medio de la respuesta.
        if (sePaso) refrescar()
        return 'terminada'
      }

      // La primera salida sigue andando del otro lado. Mandarla otra vez no
      // la apura: se espera a que termine.
      if (Date.now() - desde > ESPERA_EN_CURSO_MS) return 'mandar'
      ponerEnvio({ fase: 'recuperando', estado: 'Migue sigue buscando la respuesta…' })
      await esperar(espera)
      espera = Math.min(espera * 1.5, 10_000)
    }
    return 'terminada'
  }

  /** Lleva una pregunta hasta el final: la manda, y si se corta averigua y reintenta con el mismo id. */
  async function atender(p: PreguntaPendiente, primero: 'mandar' | 'recuperar') {
    if (ocupado.current || olvidandoRef.current) return
    ponerOcupado(true)
    setAviso(null)
    try {
      // Sin la conversación leída no se sabe a cuál mandarla: iría a abrir una
      // nueva con otra abierta al lado.
      if (!cargadaRef.current) {
        const leida = await cargar()
        if (leida === 'sin_sesion') {
          // La pregunta queda guardada: después de volver a entrar sale igual.
          setAviso(null)
          ponerEnvio({ fase: 'error', texto: SIN_SESION, reintentar: true })
          return
        }
        if (leida === 'sin_red') {
          ponerEnvio({ fase: 'sin_senal' })
          return
        }
        if (leida === 'servidor') {
          ponerEnvio({ fase: 'error', texto: SERVIDOR_CAIDO, reintentar: true })
          return
        }
      }

      let paso = primero
      for (let vuelta = 0; vuelta <= ESPERAS_ENTRE_INTENTOS_MS.length; vuelta++) {
        const actual = pendienteRef.current
        if (!actual || !montado.current) return
        if (!hayRed()) {
          ponerEnvio({ fase: 'sin_senal' })
          return
        }

        const resultado = paso === 'mandar' ? await mandar(actual) : await recuperar(actual)
        if (resultado === 'terminada' || !montado.current) return
        if (resultado === 'servidor') {
          // Hay señal y del otro lado contestaron con un error: no se insiste
          // solo, ni ahora ni al volver a la pestaña (eso mira 'sin_senal').
          // La pregunta queda con su id, y «Probar de nuevo» la manda con el
          // mismo: si llegó a tomarse, el servidor la reconoce y no cobra.
          ponerEnvio({ fase: 'error', texto: SERVIDOR_CAIDO, reintentar: true })
          return
        }
        if (resultado === 'mandar') {
          paso = 'mandar'
          continue
        }

        paso = 'recuperar'
        if (vuelta < ESPERAS_ENTRE_INTENTOS_MS.length) await esperar(ESPERAS_ENTRE_INTENTOS_MS[vuelta])
      }
      // Tres cortes seguidos es señal que no alcanza. La pregunta sigue
      // guardada, y cuando vuelva se averigua sola si llegó a contestarse.
      ponerEnvio({ fase: 'sin_senal' })
    } finally {
      ponerOcupado(false)
    }
  }

  function preguntar(crudo: string) {
    const texto = crudo.trim()
    if (!texto || ocupado.current || olvidandoRef.current || pendienteRef.current || cerradaRef.current) return
    if (texto.length > LARGO_MAXIMO_PREGUNTA) {
      ponerEnvio({
        fase: 'error',
        texto: `La pregunta tiene ${texto.length} letras y el máximo son ${LARGO_MAXIMO_PREGUNTA}. Acortala un poco.`,
        reintentar: false,
      })
      return
    }

    const p: PreguntaPendiente = {
      preguntaId: nuevoId(),
      texto,
      escritaEn: new Date().toISOString(),
      mandada: false,
      conversacionId: null,
    }
    ponerPendiente(p)
    ponerBorrador('')
    ponerEnvio({ fase: 'quieto' })
    void atender(p, 'mandar')
  }

  /** La pendiente vuelve al cuadro para escribirla de otra forma. */
  function corregir() {
    const p = pendienteRef.current
    if (!p || ocupado.current) return
    ponerPendiente(null)
    ponerBorrador(p.texto)
    ponerEnvio({ fase: 'quieto' })
  }

  // ── Empezar de nuevo y olvidar ────────────────────────────────────────

  async function accion(que: 'nueva' | 'olvidar', id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const respuesta = await fetch('/api/migue/conversacion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accion: que, conversacionId: id }),
        cache: 'no-store',
      })
      if (respuesta.ok) return { ok: true }
      const cuerpo = (await respuesta.json().catch(() => null)) as { error?: unknown } | null
      return { ok: false, error: typeof cuerpo?.error === 'string' ? cuerpo.error : 'No se pudo. Probá de nuevo.' }
    } catch {
      return { ok: false, error: 'Sin señal: probá de nuevo cuando vuelva.' }
    }
  }

  function limpiarPantalla() {
    ponerConversacion(null)
    ponerCerrada(null)
    setMensajes([])
    ponerEnvio({ fase: 'quieto' })
    setOlvido(null)
  }

  async function empezarDeNuevo() {
    if (ocupado.current || olvidandoRef.current) return
    const id = conversacionRef.current
    const seguiaAbierta = id !== null && cerradaRef.current === null

    // Lo que quedó sin mandar no se tira: vuelve al cuadro, para la otra.
    const p = pendienteRef.current
    if (p) {
      ponerPendiente(null)
      if (!borrador) ponerBorrador(p.texto)
    }
    setAviso(null)
    limpiarPantalla()

    if (!seguiaAbierta) return
    // Si no se pudo cerrar del lado del servidor, igual se empieza de cero
    // acá: la pregunta siguiente abre otra, y la vieja queda como anterior.
    const resultado = await accion('nueva', id)
    if (resultado.ok && montado.current) refrescar()
  }

  async function olvidar(id: string) {
    // Los botones ya están deshabilitados mientras se pregunta; esto es por
    // si el toque llega en el mismo instante en que sale la pregunta.
    if (ocupado.current || olvidandoRef.current) return
    olvidandoRef.current = true
    setOlvido({ id, trabajando: true })
    let resultado: Awaited<ReturnType<typeof accion>>
    try {
      resultado = await accion('olvidar', id)
    } finally {
      olvidandoRef.current = false
    }
    if (!montado.current) return
    if (!resultado.ok) {
      setOlvido({ id, trabajando: false })
      setAviso({ clase: 'error', texto: resultado.error })
      return
    }

    setOlvido(null)
    // Lo escrito para esta conversación también se va de este navegador. En
    // sólo lectura no: la conversación de la pantalla es una vieja, y lo
    // guardado en el navegador es de la de ahora, que sigue viva.
    if (!soloLectura && id === conversacionRef.current) {
      ponerPendiente(null)
      ponerBorrador('')
      limpiarPantalla()
    }
    setAnteriores((antes) => antes.filter((a) => a.id !== id))
    setAviso({ clase: 'exito', texto: 'Listo: esa conversación se olvidó.' })
    anunciar('Listo: esa conversación se olvidó.')

    if (soloLectura) {
      // La que se estaba leyendo ya no existe: se vuelve a la de ahora, y el
      // aviso lo pone la página, porque este componente se desmonta al irse.
      router.replace('/migue?olvidada=1')
      router.refresh()
      return
    }
    refrescar()
  }

  // ── Al montar ─────────────────────────────────────────────────────────

  useEffect(() => {
    montado.current = true
    if (soloLectura) return () => { montado.current = false }

    if (esCelular) dispositivo.current = dispositivoDeEsteCelular(dueno)

    const guardado = leerDelNavegador(claveDe('borrador', dueno))
    if (guardado) setBorrador(guardado.slice(0, LARGO_MAXIMO_PREGUNTA))
    const p = leerPendiente(dueno)
    if (p) {
      pendienteRef.current = p
      setPendiente(p)
    }

    void (async () => {
      if (inicial) aplicar(inicial)
      else await cargar()

      const quedo = pendienteRef.current
      if (!quedo || apagado || !montado.current) return
      // Una que ya salió puede estar contestada: se averigua sola, sin cobrar.
      // Una que nunca salió espera a que la persona la mande.
      if (quedo.mandada && hayRed()) void atender(quedo, 'recuperar')
      else ponerEnvio({ fase: quedo.mandada ? 'sin_senal' : 'sin_mandar' })
    })()

    return () => { montado.current = false }
    // Una sola vez y sin dependencias: `inicial` es lo que trajo el servidor al
    // armar la pantalla, y lo que cambie después este componente lo sabe antes
    // que la página. Cuando el panel se refresca (router.refresh, después de
    // empezar otra), volver a aplicarlo pisaría lo que ya está en pantalla con
    // lo que se leyó antes.
  }, [])

  // Lo guardado en el celular que todavía no subió. Migue lee la base, y esos
  // movimientos no están ahí: se lo dice el pedido, para que no conteste «no
  // cargaste nada» a quien cargó tres sin señal.
  useEffect(() => {
    if (!esCelular || soloLectura) return
    let vivo = true
    const releer = () => {
      void listar().then((envios) => {
        if (!vivo) return
        enColaRef.current = envios.length
        setEnCola(envios.length)
      })
    }
    const baja = alCambiar(releer)
    releer()
    return () => { vivo = false; baja() }
  }, [esCelular, soloLectura])

  // Volvió la señal, o volvió a la pestaña después de caminar media cuadra.
  // Una pregunta que ya salió se averigua sola: consultar no cobra. Una que
  // nunca salió, no: la manda la persona.
  useEffect(() => {
    if (soloLectura) return
    const alVolver = () => {
      if (document.visibilityState === 'hidden' || !hayRed()) return
      if (!cargadaRef.current) void cargar()
      const p = pendienteRef.current
      if (p?.mandada && envioRef.current.fase === 'sin_senal') void atender(p, 'recuperar')
    }
    window.addEventListener('online', alVolver)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.removeEventListener('online', alVolver)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [soloLectura])

  // Que lo último quede a la vista. Si la conversación se desplaza adentro de
  // su caja (el panel en una pantalla ancha), se baja la caja; si no, la
  // pantalla entera. Se decide por lo que pasa de verdad y no por el rol: el
  // panel abajo de 720 px apila todo y la caja deja de desplazarse, y bajar la
  // caja ahí no movía nada. La coordinación mirando desde el celular se
  // quedaba sin ver «Buscando…» ni la respuesta.
  const estadoVisible = envio.fase === 'mandando' || envio.fase === 'recuperando' ? envio.estado : ''
  useEffect(() => {
    // La burbuja baja su hilo en el efecto de abajo.
    if (enBurbuja) return
    const caja = lista.current
    // El overflow también, no sólo el alto: una lista que no se desplaza
    // puede medir un pixel más que su caja y asignarle scrollTop no hace nada.
    if (caja && /auto|scroll/.test(getComputedStyle(caja).overflowY) && caja.scrollHeight > caja.clientHeight) {
      caja.scrollTop = caja.scrollHeight
      return
    }
    if (mensajes.length > 0 || pendiente) final.current?.scrollIntoView({ block: 'nearest' })
  }, [enBurbuja, mensajes.length, pendiente, estadoVisible])

  // En la burbuja se desplaza el hilo entero y el cuadro queda afuera, fijo
  // abajo: nada lo tapa. Se baja el hilo y no hasta el ancla, porque debajo
  // de la lista vienen el aviso con «Probar de nuevo», las acciones y la
  // confirmación de olvidar.
  const fase = envio.fase
  // «Está tardando más que de costumbre» se suma al mismo renglón sin cambiar
  // el estado: sin esto el hilo no bajaba y las acciones quedaban cortadas.
  const lento = envio.fase === 'mandando' && envio.lento
  useEffect(() => {
    const caja = hilo.current
    if (!enBurbuja || !aLaVista || !caja) return
    // Vacía no se baja: arriba está el saludo. Salvo que la primera pregunta
    // haya vuelto al cuadro con un error —un dato personal, el tope del mes—:
    // el porqué va abajo de los ejemplos, y en la ventana baja no se veía.
    if (mensajes.length === 0 && !pendiente && !cerrada && !aviso && fase !== 'error') {
      respuestaUbicada.current = null
      caja.scrollTop = 0
      hiloAlFondo.current = false
      return
    }
    const alFinal = caja.scrollHeight - caja.clientHeight
    const ultima = mensajes[mensajes.length - 1]
    const clave = ultima?.quien === 'migue' ? ultima.preguntaId : null
    const nueva = clave !== null && clave !== respuestaUbicada.current
    respuestaUbicada.current = clave
    const quieta = fase === 'quieto' && !pendiente && !olvido && !aviso && !cerrada
    // Nada nuevo: se desistió de olvidar, se corrigió una pregunta, se volvió
    // a abrir la ventana. El hilo queda donde estaba —o abajo, si estaba
    // abajo—, y no vuelve al principio de una respuesta que ya se leyó.
    if (quieta && clave !== null && !nueva) {
      if (hiloAlFondo.current) caja.scrollTop = alFinal
      return
    }
    // Recién contestada, que se lea desde su primer renglón: en la ventana
    // baja una respuesta con dos botones es más alta que el hilo, y bajando
    // hasta el final se veían sólo los botones. Una corta llega igual al
    // final. No si abajo hay algo que importa más: «Buscando…», un aviso con
    // «Probar de nuevo», la confirmación de olvidar. La que llegó con la
    // ventana cerrada cuenta como nueva al abrir: acá no se la anotó.
    const filas = quieta && nueva ? caja.querySelectorAll<HTMLElement>(`.${estilos.filaMigue}`) : null
    const fila = filas?.[filas.length - 1]
    const inicio = fila ? fila.getBoundingClientRect().top - caja.getBoundingClientRect().top + caja.scrollTop - 10 : alFinal
    const destino = Math.min(alFinal, inicio)
    caja.scrollTop = destino
    hiloAlFondo.current = destino >= alFinal - 1
  }, [enBurbuja, aLaVista, mensajes.length, pendiente, estadoVisible, lento, fase, cerrada, aviso, olvido])

  // Cuando el hilo se achica —el cuadro crece un renglón, aparece «Te quedan
  // N letras», se abre el teclado— lo último sigue a la vista. Sólo si ya
  // estaba abajo: a quien subió a releer no se lo mueve.
  useEffect(() => {
    const caja = hilo.current
    if (!enBurbuja || !caja || typeof ResizeObserver === 'undefined') return
    const alDesplazar = () => { hiloAlFondo.current = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 24 }
    const observador = new ResizeObserver(() => { if (hiloAlFondo.current) caja.scrollTop = caja.scrollHeight })
    caja.addEventListener('scroll', alDesplazar, { passive: true })
    observador.observe(caja)
    return () => {
      observador.disconnect()
      caja.removeEventListener('scroll', alDesplazar)
    }
  }, [enBurbuja])

  // El cuadro de la burbuja crece con lo escrito. Chrome y Edge lo hacen
  // solos, con field-sizing (en el CSS); donde no lo hay todavía —Safari y
  // Firefox de hace poco— se mide acá. El tope lo pone el max-height del CSS.
  // Con box-sizing: border-box, al scrollHeight se le suman los bordes. Se
  // vuelve a medir cuando el cuadro reaparece —«Empezar otra» después de una
  // cerrada, o se prende Migue—, que vuelve con lo que tenía escrito y un
  // renglón de alto; y cuando cambia el ancho, al girar el teléfono, que
  // cambia los renglones sin cambiar lo escrito.
  useLayoutEffect(() => {
    const c = cuadro.current
    if (!enBurbuja || !aLaVista || !c || CSS.supports('field-sizing', 'content')) return
    const medir = () => {
      c.style.height = 'auto'
      c.style.height = `${c.scrollHeight + c.offsetHeight - c.clientHeight}px`
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [enBurbuja, aLaVista, borrador, cerrada === null, apagado === null])

  // Se tocó un ejemplo: su botón ya no está. El foco va a la conversación,
  // que es donde va a aparecer la respuesta, y no al cuadro: en el celular
  // eso abriría el teclado encima de la respuesta. Antes que el efecto que
  // devuelve el foco cuando se cae, que si no lo mandaba primero al cuadro.
  useEffect(() => {
    if (!enfocarLista.current || !lista.current) return
    enfocarLista.current = false
    lista.current.focus({ preventScroll: true })
  }, [pendiente])

  // Adentro de la burbuja el foco no se puede caer afuera. Cuando se desmonta
  // o se deshabilita el botón que lo tenía —«Olvidar» pasa a la confirmación,
  // «Preguntar» se apaga al mandar, llega «cerrada»—, cae al body, fuera de
  // la ventana: Escape dejaba de cerrarla y el Tab arrancaba en la pantalla de
  // abajo. Se devuelve sólo si andaba por acá: tocar la pantalla de abajo,
  // que en escritorio sigue a la vista, no lo trae de vuelta.
  useEffect(() => {
    const s = seccion.current
    if (!enBurbuja || !s) return
    const mirar = (e: Event) => { focoAdentro.current = e.target instanceof Node && s.contains(e.target) }
    document.addEventListener('focusin', mirar)
    document.addEventListener('pointerdown', mirar, true)
    return () => {
      document.removeEventListener('focusin', mirar)
      document.removeEventListener('pointerdown', mirar, true)
    }
  }, [enBurbuja])

  // Después de cada cambio, sin dependencias a propósito: lo que tira el foco
  // es cualquier render. Va a lo que se puede hacer: «No, dejala» si se está
  // confirmando un olvido, «Olvidar» de nuevo si se desistió, «Empezar otra»
  // si se cerró la conversación. Si no, al cuadro, salvo con el dedo, donde
  // levantaría el teclado: ahí al hilo. El hilo va último: viniendo del
  // teclado se lo marca entero con el recuadro de foco.
  useEffect(() => {
    const aOlvidar = volverAOlvidar.current
    volverAOlvidar.current = false
    if (!enBurbuja || !aLaVista || !focoAdentro.current) return
    if (document.activeElement && document.activeElement !== document.body) return
    const conDedo = window.matchMedia(TECLADO_EN_PANTALLA).matches
    const destinos = [
      confirmacionNo.current,
      aOlvidar ? pedirOlvido.current : null,
      empezarOtra.current,
      conDedo ? null : cuadro.current,
      hilo.current,
    ]
    for (const destino of destinos) {
      if (!destino || (destino instanceof HTMLButtonElement && destino.disabled)) continue
      destino.focus({ preventScroll: true })
      if (document.activeElement === destino) return
    }
  })

  // ── Lo que se dibuja ──────────────────────────────────────────────────

  function alMandar(evento: FormEvent) {
    evento.preventDefault()
    preguntar(borrador)
  }

  function alTeclear(evento: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter manda, como en cualquier chat; con Shift, baja de renglón. El
    // teclado del celular muestra «Enviar» por el enterKeyHint.
    if (evento.key === 'Enter' && !evento.shiftKey && !evento.nativeEvent.isComposing) {
      evento.preventDefault()
      preguntar(borrador)
    }
  }

  const enVuelo = envio.fase === 'mandando' || envio.fase === 'recuperando'
  const olvidando = olvido?.trabajando === true
  // Preguntar y olvidar no van a la vez: ver olvidandoRef y el botón Olvidar.
  const sinPoderPreguntar = enVuelo || atendiendo || olvidando
  const olvidarBloqueado = (id: string) => enVuelo || atendiendo || (olvidando && olvido?.id !== id)
  const vacia = mensajes.length === 0 && !pendiente
  const restan = LARGO_MAXIMO_PREGUNTA - borrador.length
  const puedeEscribir = !soloLectura && !apagado && !cerrada
  const hayConversacion = conversacionId !== null && (mensajes.length > 0 || cerrada !== null)

  const marcaDePendiente =
    envio.fase === 'sin_senal' || envio.fase === 'sin_mandar'
      ? 'Sin mandar'
      : envio.fase === 'error' ? 'Sin contestar' : null

  // Sin role: cuando se cierra mientras se pregunta, la región viva ya lo
  // dijo; al volver a abrir una cerrada, es parte de la pantalla.
  const avisoCerrada = cerrada && !soloLectura && (
    <div className="aviso atencion pila-chica">
      <span>{cerrada}</span>
      <div className="fila">
        <button ref={empezarOtra} type="button" className="boton chico" onClick={() => { void empezarDeNuevo() }}>
          Empezar otra
        </button>
      </div>
    </div>
  )
  // En la burbuja, cerrada va abajo, en el lugar del cuadro: es donde se
  // estaba por escribir.
  const cerradaAbajo = enBurbuja && !apagado ? avisoCerrada : null

  const acciones = hayConversacion && (
    <div className={estilos.acciones}>
      {/* Apagado no hay a quién preguntarle de nuevo; olvidar, sí. */}
      {!cerrada && !apagado && (
        <button
          type="button"
          className="boton fantasma chico"
          disabled={enVuelo || atendiendo || olvidando}
          onClick={() => { void empezarDeNuevo() }}
        >
          Empezar de nuevo
        </button>
      )}
      {conversacionId && mensajes.length > 0 && (
        <Olvidar
          confirmando={olvido?.id === conversacionId}
          trabajando={olvido?.id === conversacionId && olvido.trabajando}
          bloqueado={olvidarBloqueado(conversacionId)}
          alPedir={() => setOlvido({ id: conversacionId, trabajando: false })}
          alConfirmar={() => { void olvidar(conversacionId) }}
          alDesistir={() => {
            volverAOlvidar.current = true
            setOlvido(null)
          }}
          refNo={confirmacionNo}
          refPedir={pedirOlvido}
        />
      )}
    </div>
  )

  return (
    <section
      ref={seccion}
      className={[estilos.chat, esCelular ? estilos.celular : estilos.panel, enBurbuja && estilos.enBurbuja].filter(Boolean).join(' ')}
      aria-label="Conversación con Migue"
    >
      {/* La región que lee el lector de pantalla. Está siempre, vacía o no:
          una región viva que aparece ya con su texto casi nunca se lee, y la
          burbuja de la respuesta entra en una lista que no avisa nada. Lo que
          cambia es el texto. */}
      <p className="sr-solo" role="status" aria-live="polite">
        {anuncio.texto}{anuncio.vez % 2 === 1 ? '\u00a0' : ''}
      </p>

      <Hilo enBurbuja={enBurbuja} caja={hilo}>
        {!cargada && !sinCargar && <p className="menor gris" style={{ margin: 0 }}>Trayendo la conversación…</p>}

        {sinCargar && (
          <div className="aviso atencion fila-entre">
            <span className="crecer">
              {sinCargar === 'servidor'
                ? 'Migue no está pudiendo traer la conversación ahora. Lo que escribas queda guardado; probá en un rato.'
                : 'Sin señal: no se pudo traer la conversación. Lo que escribas queda guardado y lo mandás cuando vuelva.'}
            </span>
            <button type="button" className="boton secundario chico" onClick={() => { void cargar() }}>
              Probar de nuevo
            </button>
          </div>
        )}

        {(mensajes.length > 0 || pendiente) && (
          <ol ref={lista} className={estilos.mensajes} tabIndex={-1} aria-label="Mensajes">
            {mensajes.map((m) => <Burbuja key={`${m.preguntaId}-${m.quien}`} mensaje={m} />)}

            {pendiente && (
              <li className={`${estilos.burbuja} ${estilos.persona} ${marcaDePendiente ? estilos.sinMandar : ''}`}>
                <p className={estilos.texto}>{pendiente.texto}</p>
                {marcaDePendiente && <span className={estilos.marca}>{marcaDePendiente}</span>}
              </li>
            )}

            {estadoVisible && (
              <li className={estilos.estado}>
                <Retrato tamano="chico" />
                {estadoVisible}
                {envio.fase === 'mandando' && envio.lento && TARDANDO}
              </li>
            )}

            <li ref={final} className={estilos.ancla} aria-hidden="true" />
          </ol>
        )}

        {/* Antes de la primera pregunta, quién es Migue y qué hace, en una frase.
            Lo que NO hace va dicho de entrada: el vigilador que crea que le puede
            dictar un movimiento lo va a intentar, y la primera respuesta sería un
            «no». */}
        {vacia && cargada && (
          <div className={estilos.presentacion}>
            <img
              src="/migue/migue-cuerpo.webp"
              alt="Migue, con el chaleco de la Secretaría de Ambiente"
              width={97}
              height={158}
              className={estilos.figura}
              decoding="async"
            />
            <p className={estilos.saludo}>
              <strong>Hola, soy Migue.</strong>{' '}
              {esCelular
                ? 'Preguntame lo que necesites saber de lo cargado en tu punto. Yo no cargo ni cambio nada: eso lo hacés vos desde tu pantalla.'
                : enBurbuja
                  // «Contesta con lo cargado» ya lo dice la cabeza de la ventana.
                  ? 'Cada número trae el botón a la pantalla que lo calcula. Sólo leo: no cargo ni cambio nada.'
                  : 'Te contesto con lo que está cargado en el sistema, y cada número viene con el botón a la pantalla que lo calcula. Sólo leo: no cargo, no anulo ni cambio nada.'}
            </p>
          </div>
        )}

        {vacia && puedeEscribir && cargada && ejemplos.length > 0 && (
          <div className="pila-chica">
            <p className={enBurbuja ? `menor gris ${estilos.rotuloEjemplos}` : 'menor gris'} style={{ margin: 0 }}>
              Podés preguntarle, por ejemplo:
            </p>
            <div className={estilos.ejemplos}>
              {ejemplos.map((ejemplo) => (
                <button
                  key={ejemplo}
                  type="button"
                  className="boton secundario"
                  disabled={sinPoderPreguntar}
                  onClick={() => {
                    enfocarLista.current = true
                    preguntar(ejemplo)
                  }}
                >
                  {ejemplo}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sin role: lo que dice ya lo leyó la región de arriba. */}
        {envio.fase === 'sin_senal' && pendiente && (
          <div className="aviso atencion pila-chica">
            <span>{SIN_SENAL}</span>
            <div className="fila">
              <button
                type="button"
                className="boton secundario chico"
                disabled={atendiendo || olvidando}
                onClick={() => { void atender(pendiente, pendiente.mandada ? 'recuperar' : 'mandar') }}
              >
                Mandarla ahora
              </button>
              <button type="button" className="boton fantasma chico" onClick={corregir}>Corregirla</button>
            </div>
          </div>
        )}

        {envio.fase === 'sin_mandar' && pendiente && (
          <div className="aviso atencion pila-chica" role="status">
            <span>Esta pregunta quedó escrita y todavía no salió.</span>
            <div className="fila">
              <button
                type="button"
                className="boton secundario chico"
                disabled={atendiendo || olvidando}
                onClick={() => { void atender(pendiente, 'mandar') }}
              >
                Mandarla ahora
              </button>
              <button type="button" className="boton fantasma chico" onClick={corregir}>Corregirla</button>
            </div>
          </div>
        )}

        {envio.fase === 'error' && (
          <div className="aviso error pila-chica" role="alert">
            <span>{envio.texto}</span>
            {envio.reintentar && pendiente && (
              <div className="fila">
                <button
                  type="button"
                  className="boton secundario chico"
                  disabled={atendiendo || olvidando}
                  onClick={() => { void atender(pendiente, 'mandar') }}
                >
                  Probar de nuevo
                </button>
                <button type="button" className="boton fantasma chico" onClick={corregir}>Corregirla</button>
              </div>
            )}
          </div>
        )}

        {!cerradaAbajo && avisoCerrada}

        {aviso && (
          <div className={`aviso ${aviso.clase}`} role={aviso.clase === 'error' ? 'alert' : undefined}>
            {aviso.texto}
          </div>
        )}

        {/* En la burbuja, al final de lo hablado y lejos de «Preguntar». */}
        {enBurbuja && acciones}
      </Hilo>

      {!soloLectura && (
        <div className={`pila-chica ${estilos.pie}`}>
          {/* Cerrada, en la burbuja no hay cuadro: la frase es de lo que se escribe. */}
          {!apagado && !cerradaAbajo && (
            <p
              id={`privacidad-${rol}`}
              className={enBurbuja ? `menor gris ${estilos.privacidad}` : 'menor gris'}
              style={{ margin: 0 }}
            >
              {privacidad}
            </p>
          )}

          {esCelular && enCola > 0 && (
            <p className={enBurbuja ? `menor gris ${estilos.enCola}` : 'menor gris'} style={{ margin: 0 }}>
              {enCola === 1
                ? 'Hay 1 movimiento guardado en el celular sin subir: Migue todavía no lo ve.'
                : `Hay ${enCola} movimientos guardados en el celular sin subir: Migue todavía no los ve.`}
            </p>
          )}

          {apagado ? (
            <div className="aviso atencion pila-chica" role="status">
              <span className="fuerte">{apagado.titulo}</span>
              {apagado.detalle.length === 1 ? <span>{apagado.detalle[0]}</span> : (
                <ul className={estilos.motivos}>
                  {apagado.detalle.map((motivo) => <li key={motivo}>{motivo}</li>)}
                </ul>
              )}
            </div>
          ) : cerradaAbajo ? cerradaAbajo : puedeEscribir && (
            <form className={estilos.cuadro} onSubmit={alMandar}>
              <label htmlFor={`pregunta-${rol}`} className="sr-solo">Tu pregunta para Migue</label>
              <textarea
                ref={cuadro}
                id={`pregunta-${rol}`}
                className={`control ${estilos.pregunta}`}
                rows={enBurbuja ? 1 : esCelular ? 3 : 2}
                maxLength={LARGO_MAXIMO_PREGUNTA}
                enterKeyHint="send"
                // En la ventana, el atajo del teclado no entraba en el renglón
                // y sacaba una barra con flechitas: va para el lector de
                // pantalla. Y corto: el cuadro vacío mide lo que su texto, y en
                // un teléfono de 360 con la letra agrandada «Escribí tu
                // pregunta…» ya iba en dos renglones.
                placeholder={enBurbuja ? 'Tu pregunta…' : esCelular ? 'Escribí tu pregunta…' : 'Escribí tu pregunta. Enter la manda; Shift+Enter baja de renglón.'}
                aria-describedby={enBurbuja && !esCelular ? `privacidad-${rol} atajo-${rol}` : `privacidad-${rol}`}
                value={borrador}
                onChange={(e) => ponerBorrador(e.target.value)}
                onKeyDown={alTeclear}
              />
              {enBurbuja && !esCelular && (
                <span id={`atajo-${rol}`} className="sr-solo">Enter la manda; Shift+Enter baja de renglón.</span>
              )}
              {restan <= 100 && (
                <span className="ayuda" aria-live="polite">
                  {restan === 1 ? 'Te queda 1 letra.' : `Te quedan ${restan} letras.`}
                </span>
              )}
              <button
                type="submit"
                className={enBurbuja ? 'boton' : `boton ${esCelular ? 'grande ancho-total' : ''}`}
                disabled={sinPoderPreguntar || pendiente !== null || !borrador.trim()}
              >
                {/* En la burbuja no cambia: «Preguntando…» es más ancho y
                    achicaba el cuadro. Lo que pasa lo dice la línea gris del
                    hilo, y la región viva lo lee. */}
                {enVuelo && !enBurbuja ? 'Preguntando…' : 'Preguntar'}
              </button>
            </form>
          )}

          {!enBurbuja && acciones}
        </div>
      )}

      {soloLectura && conversacionId && (
        <div className={estilos.acciones}>
          <Olvidar
            confirmando={olvido?.id === conversacionId}
            trabajando={olvido?.id === conversacionId && olvido.trabajando}
            bloqueado={olvidarBloqueado(conversacionId)}
            alPedir={() => setOlvido({ id: conversacionId, trabajando: false })}
            alConfirmar={() => { void olvidar(conversacionId) }}
            alDesistir={() => setOlvido(null)}
          />
        </div>
      )}

      {/* Las de hoy de este teléfono. En el panel van en la columna de al lado,
          y las dibuja la página. */}
      {esCelular && !soloLectura && !enBurbuja && anteriores.length > 0 && (
        <details className={estilos.anteriores}>
          <summary>
            {anteriores.length === 1 ? 'Otra conversación de hoy en este celular' : `Otras ${anteriores.length} conversaciones de hoy en este celular`}
          </summary>
          <div className="pila-chica">
            {anteriores.map((a) => (
              <details key={a.id} className={estilos.anterior}>
                <summary>
                  <span className="mono menor gris cifras">{hora(a.creadaEn)}</span> {a.titulo}
                </summary>
                <div className="pila-chica">
                  <ol className={estilos.mensajes}>
                    {(a.mensajes ?? []).map((m) => <Burbuja key={`${m.preguntaId}-${m.quien}`} mensaje={m} />)}
                  </ol>
                  <p className="menor gris" style={{ margin: 0 }}>Última pregunta: {fechaHora(a.actualizadaEn)}</p>
                  <Olvidar
                    confirmando={olvido?.id === a.id}
                    trabajando={olvido?.id === a.id && olvido.trabajando}
                    bloqueado={olvidarBloqueado(a.id)}
                    alPedir={() => setOlvido({ id: a.id, trabajando: false })}
                    alConfirmar={() => { void olvidar(a.id) }}
                    alDesistir={() => setOlvido(null)}
                  />
                </div>
              </details>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
