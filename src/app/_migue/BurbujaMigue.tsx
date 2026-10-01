'use client'
/**
 * La cara de Migue en la esquina de todas las pantallas, para preguntarle sin
 * irse de donde uno está.
 *
 * Abre la misma conversación que /migue o /preguntar, encima de la pantalla:
 * la coordinación pregunta mirando el tablero, y el vigilador a mitad de una
 * carga pregunta cuántos metros es un camión sin perder lo que llevaba
 * escrito. En escritorio es una ventana chica al lado de la cara; en un
 * teléfono, parado o acostado, la pantalla entera (pantallaEntera.ts).
 *
 * La conversación se arma la primera vez que se abre, no al entrar: si no,
 * cada pantalla le pediría la conversación al servidor aunque nadie la mire.
 * Después queda armada aunque se cierre la ventana o se cambie de pantalla
 * —los layouts no se desarman al navegar—, así que una pregunta que salió
 * sigue su curso con la ventana cerrada, y cuando llega la respuesta la cara
 * lo avisa con un punto.
 *
 * En la pantalla de Migue no va: serían dos conversaciones iguales, una
 * encima de la otra.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import estilos from './burbuja.module.css'
import Conversacion, { type PropsDeConversacion } from './Conversacion'
import { PANTALLA_ENTERA, TECLADO_EN_PANTALLA } from './pantallaEntera'
import { Retrato } from './Retrato'

type Props = Omit<PropsDeConversacion, 'inicial' | 'soloLectura' | 'enBurbuja' | 'aLaVista' | 'alContestar'> & {
  /** La pantalla entera del chat: ahí la burbuja no va, y a ella lleva «Ver todo». */
  pantalla: '/migue' | '/preguntar'
}

export default function BurbujaMigue({ pantalla, ...conversacion }: Props) {
  const ruta = usePathname()
  const [abierta, setAbierta] = useState(false)
  const [armada, setArmada] = useState(false)
  const [sinLeer, setSinLeer] = useState(false)
  const abiertaRef = useRef(abierta)
  abiertaRef.current = abierta
  const lanzador = useRef<HTMLButtonElement>(null)
  const ventana = useRef<HTMLDivElement>(null)
  const region = useRef<HTMLParagraphElement>(null)
  const titulo = useId()
  const idVentana = useId()

  const enLaPantallaDeMigue = ruta === pantalla || ruta.startsWith(`${pantalla}/`)

  // Otra pantalla —el botón de una respuesta, «Ver todo», el atrás del
  // teléfono—: la ventana se cierra para dejar ver adónde se fue. La
  // conversación sigue armada y vuelve igual al abrir.
  useEffect(() => { setAbierta(false) }, [ruta])

  // Al abrir, el foco va a la ventana y no al cuadro si se toca con el dedo:
  // en el teléfono o la tableta eso levantaría el teclado encima de la
  // conversación. Con mouse sí al cuadro, que es a lo que se viene. Al cerrar con la X, Escape o la cara,
  // vuelve a la cara; recién acá y no en cerrar(), porque en el celular la
  // cara estuvo inert mientras la ventana tapaba todo, y React saca el inert
  // en la limpieza del efecto de abajo, que corre antes que éste.
  const devolverFoco = useRef(false)
  useEffect(() => {
    if (!abierta) {
      if (devolverFoco.current) lanzador.current?.focus({ preventScroll: true })
      devolverFoco.current = false
      return
    }
    const conTeclado = !window.matchMedia(TECLADO_EN_PANTALLA).matches
    const cuadro = ventana.current?.querySelector<HTMLTextAreaElement>('textarea')
    if (conTeclado && cuadro) cuadro.focus({ preventScroll: true })
    else ventana.current?.focus({ preventScroll: true })
  }, [abierta])

  // A pantalla entera la ventana tapa todo, así que es modal: lo de abajo —el
  // encabezado, la pantalla, la cara— sale del Tab y del lector de pantalla.
  // Sin esto, del «Preguntar» el Tab iba a la cara tapada y de ahí a «Cargar
  // un ingreso», que no se ve. En escritorio no: la pantalla sigue a la vista
  // y se usa con la ventana abierta.
  useEffect(() => {
    const caja = ventana.current
    const padre = caja?.parentElement
    if (!abierta || !caja || !padre) return
    const entera = window.matchMedia(PANTALLA_ENTERA)
    let tapados: HTMLElement[] = []
    const soltar = () => {
      caja.removeAttribute('aria-modal')
      for (const el of tapados) el.inert = false
      tapados = []
    }
    const tapar = () => {
      soltar()
      if (!entera.matches) return
      caja.setAttribute('aria-modal', 'true')
      // Los que ya estaban inert por otro motivo no se tocan, ni al poner ni al sacar.
      tapados = Array.from(padre.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && el !== caja && el !== region.current && !el.inert,
      )
      for (const el of tapados) el.inert = true
    }
    tapar()
    entera.addEventListener('change', tapar)
    return () => {
      entera.removeEventListener('change', tapar)
      soltar()
    }
  }, [abierta])

  // Escape cierra también cuando el foco se cayó al body (un botón que lo
  // tenía se desmontó), no sólo desde adentro de la ventana. Desde un campo
  // de la pantalla de abajo, no: ese Escape es de él.
  useEffect(() => {
    if (!abierta) return
    const alTeclear = (evento: globalThis.KeyboardEvent) => {
      if (evento.key !== 'Escape' || evento.defaultPrevented || evento.isComposing) return
      const foco = document.activeElement
      const nuestro = !foco || foco === document.body || foco === lanzador.current || ventana.current?.contains(foco)
      if (nuestro) cerrar()
    }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [abierta])

  // En el celular el teclado tapa la mitad de abajo, y ahí está el cuadro.
  // Chrome de Android y Safari no achican la pantalla para el teclado: achican
  // sólo lo que se ve (visualViewport). La ventana se ajusta a eso: la cabeza
  // arriba y el cuadro justo arriba del teclado. Con zoom de dos dedos no se
  // toca, porque ahí lo que se ve es un pedazo a propósito.
  useEffect(() => {
    const caja = ventana.current
    const vista = window.visualViewport
    if (!abierta || !caja || !vista) return
    const entera = window.matchMedia(PANTALLA_ENTERA)
    const limpiar = () => {
      caja.style.removeProperty('--alto-visible')
      caja.style.removeProperty('--arriba-visible')
      delete caja.dataset.teclado
      delete caja.dataset.baja
    }
    const ajustar = () => {
      if (!entera.matches || vista.scale > 1.01) return limpiar()
      caja.style.setProperty('--alto-visible', `${Math.round(vista.height)}px`)
      caja.style.setProperty('--arriba-visible', `${Math.round(vista.offsetTop)}px`)
      // Sin teclado, abajo va el margen de la barrita del iPhone; con teclado, no.
      const tapado = document.documentElement.clientHeight - vista.height - vista.offsetTop
      if (tapado > 120) caja.dataset.teclado = 'abierto'
      else delete caja.dataset.teclado
      // Teclado abierto en un teléfono chico: el cuadro se achica a dos
      // renglones (conversacion.module.css). Va por atributo y no por
      // @container, que Safari de iOS 15 no tiene.
      if (vista.height <= 380) caja.dataset.baja = ''
      else delete caja.dataset.baja
    }
    ajustar()
    vista.addEventListener('resize', ajustar)
    vista.addEventListener('scroll', ajustar)
    entera.addEventListener('change', ajustar)
    return () => {
      vista.removeEventListener('resize', ajustar)
      vista.removeEventListener('scroll', ajustar)
      entera.removeEventListener('change', ajustar)
      limpiar()
    }
  }, [abierta])

  // A pantalla entera la ventana se ve como una pantalla más, y el atrás del
  // teléfono (el botón, el gesto, deslizar desde el borde en Safari) tiene que
  // cerrarla. Sin esto volvía de pantalla por debajo: el vigilador que
  // preguntaba a mitad de una carga perdía lo que llevaba escrito. Abrirla
  // deja una entrada en la historia con la misma dirección; el atrás la saca
  // y cierra. El resto del estado se conserva, así el router de Next recorre
  // la misma página y no la vuelve a montar.
  useEffect(() => {
    if (!abierta) return
    const alVolver = () => {
      devolverFoco.current = true
      setAbierta(false)
    }
    window.addEventListener('popstate', alVolver)
    return () => window.removeEventListener('popstate', alVolver)
  }, [abierta])

  function abrir() {
    setArmada(true)
    setSinLeer(false)
    setAbierta(true)
    // Si la entrada de ahora ya es la de Migue (se volvió con atrás desde
    // «Ver todo»), no se agrega otra: harían falta dos atrás para cerrar.
    if (window.matchMedia(PANTALLA_ENTERA).matches && !window.history.state?.migue) {
      window.history.pushState({ ...window.history.state, migue: true }, '')
    }
  }

  function cerrar() {
    devolverFoco.current = true
    setAbierta(false)
    // La X y Escape sacan la entrada que dejó abrir(), así el atrás siguiente
    // hace lo de siempre.
    if (window.history.state?.migue) window.history.back()
  }

  // Un enlace de la respuesta que lleva a la misma pantalla con otro filtro
  // no cambia la ruta, y la ventana quedaría tapando lo que se fue a ver.
  function alTocar(evento: MouseEvent<HTMLDivElement>) {
    const enlace = (evento.target as HTMLElement).closest('a[href]')
    if (enlace && !evento.metaKey && !evento.ctrlKey && !evento.shiftKey) setAbierta(false)
  }

  if (enLaPantallaDeMigue) return null

  const rotulo = abierta
    ? 'Cerrar la conversación con Migue'
    : sinLeer ? 'Migue te contestó. Abrir la conversación' : 'Preguntale a Migue'

  return (
    <>
      {/* Siempre presente y con el texto que cambia: una región viva que
          aparece ya con su texto casi nunca se lee. */}
      <p ref={region} className="sr-solo" role="status" aria-live="polite">
        {sinLeer ? 'Migue te contestó.' : ''}
      </p>

      {armada && (
        <div
          ref={ventana}
          id={idVentana}
          className={estilos.ventana}
          role="dialog"
          aria-labelledby={titulo}
          tabIndex={-1}
          hidden={!abierta}
          onClickCapture={alTocar}
        >
          <header className={estilos.cabeza}>
            <Retrato tamano="burbuja" />
            <div className={estilos.nombre}>
              <strong id={titulo}>Migue</strong>
              <span>Contesta con lo cargado</span>
            </div>
            <Link href={pantalla} className={`boton fantasma chico ${estilos.verTodo}`}>Ver todo</Link>
            <button
              type="button"
              className={estilos.cerrar}
              onClick={cerrar}
              aria-label="Cerrar la conversación con Migue"
              title="Cerrar"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                   strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          <div className={estilos.cuerpo}>
            <Conversacion
              {...conversacion}
              inicial={null}
              enBurbuja
              aLaVista={abierta}
              alContestar={() => { if (!abiertaRef.current) setSinLeer(true) }}
            />
          </div>
        </div>
      )}

      <button
        ref={lanzador}
        type="button"
        className={estilos.lanzador}
        data-abierta={abierta ? 'true' : 'false'}
        aria-expanded={abierta}
        aria-controls={armada ? idVentana : undefined}
        aria-label={rotulo}
        title={abierta ? 'Cerrar' : 'Preguntale a Migue'}
        onClick={() => (abierta ? cerrar() : abrir())}
      >
        <img src="/migue/migue-cara.webp" alt="" width={64} height={64} decoding="async" />
        {sinLeer && <span className={estilos.punto} aria-hidden="true" />}
      </button>
    </>
  )
}
