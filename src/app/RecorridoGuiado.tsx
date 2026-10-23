'use client'
/**
 * El recorrido guiado: ilumina una parte de la pantalla por vez y explica para
 * qué es. Arranca solo la primera vez en cada navegador y se vuelve a ver con
 * el botón «?» de la cabecera.
 *
 * Empieza por la pantalla donde se lo abre (recorridoDeLaPantalla.ts) y sigue
 * con lo que está en todas: el menú, Migue, el tema, la cuenta. La bienvenida
 * es sólo para la primera vez.
 *
 * Las partes se marcan en el marcado con data-recorrido="…". Lo que no está en
 * la pantalla —o está escondido, como el menú lateral en un teléfono— no
 * entra, y el contador cuenta sólo lo que se va a ver.
 *
 * Se recuerda en el navegador y no en la cuenta, como el tema: la cuenta del
 * punto la comparten los que rotan, y quien recién llega a ese celular
 * igual lo ve una vez.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { recorridoDeLaPantalla, type Paso } from './recorridoDeLaPantalla'
import estilos from './recorrido.module.css'

type Rol = 'admin' | 'vigilador'

const BIENVENIDA: Record<Rol, Paso> = {
  admin: {
    titulo: 'Te damos la bienvenida al panel',
    texto: 'En un minuto te mostramos dónde está cada cosa. Podés saltearlo y volver a verlo cuando quieras.',
  },
  vigilador: {
    titulo: 'Te damos la bienvenida',
    texto: 'En un minuto te mostramos cómo se usa. Podés saltearlo y volver a verlo cuando quieras.',
  },
}

/** Lo que está en todas las pantallas; va después de lo de la pantalla. */
const DE_SIEMPRE: Record<Rol, (Paso & { salvoEn?: string })[]> = {
  admin: [
    {
      destino: 'navegacion',
      titulo: 'El menú',
      texto: 'Tablero, Movimientos, Pilas, Conteos, Recambios y el resto de las secciones. El número al lado de Revisiones avisa cuántas cosas esperan tu confirmación.',
    },
    {
      destino: 'migue',
      titulo: 'Migue, el asistente',
      texto: 'Tocá su cara para preguntarle sobre lo cargado. Te ofrece preguntas de la pantalla donde estás, y cada número trae el botón a la pantalla que lo calcula. Sólo lee: no carga ni cambia nada.',
    },
    {
      destino: 'tema',
      titulo: 'Claro u oscuro',
      texto: 'Cambiá el tema de la pantalla. Queda guardado en esta computadora.',
    },
    {
      destino: 'ayuda',
      titulo: 'Este recorrido',
      texto: 'Si lo querés ver de nuevo, está acá. Empieza por la pantalla donde lo abras.',
    },
    {
      destino: 'cuenta',
      // En Mi cuenta ya se explicó al principio.
      salvoEn: '/cuenta',
      titulo: 'Tu cuenta',
      texto: 'Tu correo y tu contraseña.',
    },
    {
      destino: 'salir',
      titulo: 'Salir',
      texto: 'Cerrá la sesión cuando termines, sobre todo en una computadora que usa más gente.',
    },
  ],
  vigilador: [
    {
      destino: 'migue',
      titulo: 'Migue',
      texto: 'Tocá su cara para preguntarle sobre lo que cargaste: qué cargaste hoy, si ya pediste un recambio. No carga nada: eso lo hacés vos.',
    },
    {
      destino: 'tema',
      titulo: 'Claro u oscuro',
      texto: 'Cambiá el tema de la pantalla. Queda guardado en este celular.',
    },
    {
      destino: 'ayuda',
      titulo: 'Este recorrido',
      texto: 'Si lo querés ver de nuevo, está acá. Empieza por la pantalla donde lo abras.',
    },
    {
      destino: 'salir',
      titulo: 'Salir',
      texto: 'Cerrá la sesión al terminar el turno.',
    },
  ],
}

const CLAVE = (rol: Rol) => `ambiente.recorrido.${rol}`
const MARGEN = 8
const ANCHO_TARJETA = 340

/**
 * La cabecera de la pantalla: el título con lo que dice abajo, si van juntos
 * en un <header> —o en el bloque que lo envuelve— que no ocupa media
 * pantalla; si no, el título solo.
 */
function cabecera(): HTMLElement | null {
  const titulo = document.querySelector<HTMLElement>('[data-recorrido="contenido"] h1')
  if (!titulo) return null
  const bloque = titulo.closest<HTMLElement>('header') ?? titulo.parentElement
  const adentro = bloque && bloque.dataset.recorrido !== 'contenido' && bloque.closest('[data-recorrido="contenido"]')
  return bloque && adentro && bloque.getBoundingClientRect().height <= window.innerHeight * 0.4
    ? bloque
    : titulo
}

/** Lo iluminable de ese destino, o null si no está o no se ve. */
function buscar(destino: string | undefined): HTMLElement | null {
  if (!destino) return null
  const el = document.querySelector<HTMLElement>(`[data-recorrido="${destino}"]`)
    ?? (destino === 'pantalla' ? cabecera() : null)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' ? el : null
}

interface Ubicacion {
  foco: { top: number; left: number; width: number; height: number } | null
  tarjeta: { top: number; left: number }
}

function ubicar(el: HTMLElement | null, alto: number): Ubicacion {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const ancho = Math.min(ANCHO_TARJETA, vw - 32)
  if (!el) return { foco: null, tarjeta: { top: Math.max(16, (vh - alto) / 2), left: (vw - ancho) / 2 } }

  const r = el.getBoundingClientRect()
  // Lo que es más grande que la pantalla se ilumina en lo que se ve.
  const top = Math.max(r.top - MARGEN, MARGEN)
  const bottom = Math.min(r.bottom + MARGEN, vh - MARGEN)
  const left = Math.max(r.left - MARGEN, MARGEN)
  const right = Math.min(r.right + MARGEN, vw - MARGEN)
  const foco = { top, left, width: right - left, height: bottom - top }

  const alLado = (izquierda: number) => ({ foco, tarjeta: { top: Math.min(Math.max(top, 16), vh - alto - 16), left: izquierda } })
  // Abajo, arriba, y si es más alto que la pantalla (el menú), al costado;
  // recién si tampoco entra, adentro.
  if (vh - bottom >= alto + 12 || top >= alto + 12) {
    const tTop = vh - bottom >= alto + 12 ? bottom + 12 : top - alto - 12
    return { foco, tarjeta: { top: tTop, left: Math.min(Math.max(r.left, 16), vw - ancho - 16) } }
  }
  if (vw - right >= ancho + 12) return alLado(right + 12)
  if (left >= ancho + 12) return alLado(left - ancho - 12)
  return { foco, tarjeta: { top: Math.min(Math.max(top + 16, 16), vh - alto - 16), left: Math.min(Math.max(r.left, 16), vw - ancho - 16) } }
}

export default function RecorridoGuiado({
  rol,
  autoIniciar,
  className,
}: {
  rol: Rol
  /** Que arranque solo si en este navegador nunca se vio. */
  autoIniciar: boolean
  /** La del botón «?» de la cabecera, para que sea igual al del tema. */
  className?: string
}) {
  const ruta = usePathname()
  // Los pasos se arman al abrirlo, con lo que hay en esa pantalla.
  const [pasos, setPasos] = useState<Paso[] | null>(null)
  const [indice, setIndice] = useState(0)
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null)
  const tarjeta = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const titulo = useId()
  const texto = useId()

  const terminar = useCallback(() => {
    try { localStorage.setItem(CLAVE(rol), 'visto') } catch { /* modo privado */ }
    setPasos(null)
    setUbicacion(null)
    boton.current?.focus({ preventScroll: true })
  }, [rol])

  const abrir = useCallback((conBienvenida: boolean) => {
    const todos = [
      ...(conBienvenida ? [BIENVENIDA[rol]] : []),
      ...recorridoDeLaPantalla(rol, ruta),
      ...DE_SIEMPRE[rol].filter((p) => p.salvoEn !== ruta),
    ]
    const visibles = todos.filter((p) => !p.destino || buscar(p.destino))
    if (visibles.length === 0) return
    setPasos(visibles)
    setIndice(0)
  }, [rol, ruta])

  // La primera vez, solo, un rato después de que se dibuje la pantalla.
  useEffect(() => {
    if (!autoIniciar) return
    let visto = false
    try { visto = localStorage.getItem(CLAVE(rol)) === 'visto' } catch { visto = true }
    if (visto) return
    // Si se pasa a otra pantalla antes de que arranque, arranca en esa.
    const t = window.setTimeout(() => abrir(true), 700)
    return () => window.clearTimeout(t)
  }, [autoIniciar, rol, abrir])

  // Si cambia la pantalla (el botón atrás del teléfono), lo que explicaba ya
  // no está: se cierra.
  const rutaAbierta = useRef(ruta)
  useEffect(() => {
    if (rutaAbierta.current !== ruta) {
      rutaAbierta.current = ruta
      setPasos(null)
      setUbicacion(null)
    }
  }, [ruta])

  // Llevar a la vista lo que se ilumina y ubicar la tarjeta; de nuevo si
  // cambia el tamaño o se desplaza algo.
  const paso = pasos?.[indice] ?? null
  useLayoutEffect(() => {
    if (!paso) return
    const el = buscar(paso.destino)
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el?.scrollIntoView({ block: 'nearest', behavior: quieto ? 'auto' : 'smooth' })
    const medir = () => setUbicacion(ubicar(buscar(paso.destino), tarjeta.current?.offsetHeight ?? 200))
    medir()
    const t = window.setTimeout(medir, 350)
    window.addEventListener('resize', medir)
    window.addEventListener('scroll', medir, true)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', medir)
      window.removeEventListener('scroll', medir, true)
    }
  }, [paso])

  useEffect(() => {
    if (paso) tarjeta.current?.focus({ preventScroll: true })
  }, [paso])

  const total = pasos?.length ?? 0
  const ultimo = indice === total - 1

  function alTeclear(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      terminar()
    } else if (e.key === 'ArrowRight' && !ultimo) {
      setIndice(indice + 1)
    } else if (e.key === 'ArrowLeft' && indice > 0) {
      setIndice(indice - 1)
    } else if (e.key === 'Tab') {
      // El foco no sale de la tarjeta mientras el recorrido está abierto.
      const botones = Array.from(tarjeta.current?.querySelectorAll<HTMLElement>('button') ?? [])
      if (botones.length === 0) return
      const primero = botones[0]
      const final = botones[botones.length - 1]
      if (e.shiftKey && (document.activeElement === primero || document.activeElement === tarjeta.current)) {
        e.preventDefault()
        final.focus()
      } else if (!e.shiftKey && document.activeElement === final) {
        e.preventDefault()
        primero.focus()
      }
    }
  }

  return (
    <>
      <button
        ref={boton}
        type="button"
        className={className}
        data-recorrido="ayuda"
        onClick={() => abrir(false)}
        aria-label="Ver el recorrido guiado de esta pantalla"
        title="Recorrido guiado"
      >
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01" />
        </svg>
      </button>

      {paso && (
        <div className={estilos.capa} onKeyDown={alTeclear}>
          {ubicacion?.foco ? (
            <div className={estilos.foco} style={ubicacion.foco} aria-hidden="true" />
          ) : (
            <div className={estilos.velo} aria-hidden="true" />
          )}
          <div
            ref={tarjeta}
            className={estilos.tarjeta}
            style={ubicacion ? { top: ubicacion.tarjeta.top, left: ubicacion.tarjeta.left } : { visibility: 'hidden' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titulo}
            aria-describedby={texto}
            tabIndex={-1}
          >
            <p className={estilos.contador}>
              {indice + 1} de {total}
            </p>
            <h2 id={titulo} className={estilos.titulo}>{paso.titulo}</h2>
            <p id={texto} className={estilos.texto}>{paso.texto}</p>
            <div className={estilos.botones}>
              <button type="button" className="boton fantasma chico" onClick={terminar}>
                {ultimo ? 'Cerrar' : 'Saltar'}
              </button>
              <div className={estilos.avanzar}>
                {indice > 0 && (
                  <button type="button" className="boton secundario chico" onClick={() => setIndice(indice - 1)}>
                    Anterior
                  </button>
                )}
                <button type="button" className="boton chico" onClick={() => (ultimo ? terminar() : setIndice(indice + 1))}>
                  {ultimo ? 'Listo' : 'Siguiente'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
