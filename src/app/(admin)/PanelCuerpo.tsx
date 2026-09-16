'use client'

import { useEffect, useState } from 'react'
import Navegacion from './Navegacion'
import estilos from './PanelLayout.module.css'

const CLAVE_MENU = 'ambiente.menu-contraido'

export default function PanelCuerpo({ children }: { children: React.ReactNode }) {
  const [contraida, setContraida] = useState(false)

  useEffect(() => {
    try { setContraida(localStorage.getItem(CLAVE_MENU) === '1') } catch { /* modo privado */ }
  }, [])

  function alternarMenu() {
    setContraida((actual) => {
      const siguiente = !actual
      try { localStorage.setItem(CLAVE_MENU, siguiente ? '1' : '0') } catch { /* modo privado */ }
      return siguiente
    })
  }

  const accion = contraida ? 'Mostrar menú' : 'Ocultar menú'

  return (
    <div className={estilos.cuerpo} data-contraida={contraida ? 'true' : 'false'}>
      <aside className={estilos.lateral}>
        <div className={estilos.rotuloMenu}>
          <span className={estilos.rotuloNavegacion}>Navegación</span>
          <span className={estilos.estado} aria-label="Sistema disponible" />
          <button
            type="button"
            className={estilos.botonMenu}
            onClick={alternarMenu}
            aria-label={accion}
            aria-expanded={!contraida}
            aria-controls="navegacion-panel"
            title={accion}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={contraida ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6'} />
            </svg>
          </button>
        </div>

        <Navegacion contraida={contraida} />

        <div className={estilos.pieLateral}>
          <strong>Ambiente SMT</strong>
          <span>Gestión y trazabilidad</span>
        </div>
      </aside>

      <main className={`contenido ${estilos.contenido}`}>{children}</main>
    </div>
  )
}
