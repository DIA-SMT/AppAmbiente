'use client'
/**
 * El botón del sol y la luna: pasa de un tema al otro y se acuerda en este
 * navegador. Muestra el tema al que se va, no el que está: con la pantalla
 * oscura, el sol.
 */
import { useEffect, useState } from 'react'
import { CLAVE_DEL_TEMA, type Tema } from './tema'

function temaEnPantalla(): Tema {
  const elegido = document.documentElement.dataset.tema
  if (elegido === 'claro' || elegido === 'oscuro') return elegido
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'
}

export default function SelectorDeTema({ className }: { className?: string }) {
  // Hasta montar no se sabe cuál está: el servidor no ve ni el navegador ni
  // el dispositivo. Mientras tanto el botón se dibuja igual, sin ícono.
  const [tema, setTema] = useState<Tema | null>(null)

  useEffect(() => {
    setTema(temaEnPantalla())
    // Si nadie eligió y el dispositivo cambia solo (de día a de noche), el
    // botón tiene que seguirlo.
    const oscuro = window.matchMedia('(prefers-color-scheme: dark)')
    const alCambiar = () => setTema(temaEnPantalla())
    oscuro.addEventListener('change', alCambiar)
    return () => oscuro.removeEventListener('change', alCambiar)
  }, [])

  function cambiar() {
    const nuevo: Tema = temaEnPantalla() === 'oscuro' ? 'claro' : 'oscuro'
    document.documentElement.dataset.tema = nuevo
    try { localStorage.setItem(CLAVE_DEL_TEMA, nuevo) } catch { /* modo privado: dura lo que la pestaña */ }
    setTema(nuevo)
  }

  const rotulo = tema === 'oscuro' ? 'Pasar a tema claro' : 'Pasar a tema oscuro'

  return (
    <button type="button" className={className} onClick={cambiar} aria-label={rotulo} title={rotulo} data-recorrido="tema">
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {tema === 'oscuro' ? (
          <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
          </>
        ) : tema === 'claro' ? (
          <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" />
        ) : null}
      </svg>
    </button>
  )
}
