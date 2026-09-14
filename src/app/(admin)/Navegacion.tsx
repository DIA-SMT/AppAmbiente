'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import estilos from './Navegacion.module.css'

const SECCIONES = [
  { destino: '/tablero', rotulo: 'Tablero' },
  { destino: '/movimientos', rotulo: 'Movimientos' },
  { destino: '/listas', rotulo: 'Listas' },
  { destino: '/vecinos', rotulo: 'Vecinos' },
  { destino: '/usuarios', rotulo: 'Usuarios' },
  { destino: '/importar', rotulo: 'Importar pesos' },
  { destino: '/auditoria', rotulo: 'Auditoría' },
]

export default function Navegacion() {
  const ruta = usePathname() ?? ''

  return (
    <nav className={estilos.barra} aria-label="Secciones del panel">
      <div className={`ancho ${estilos.pistas}`}>
        {SECCIONES.map(({ destino, rotulo }) => {
          const activa = ruta === destino || ruta.startsWith(`${destino}/`)
          return (
            <Link
              key={destino}
              href={destino}
              className={estilos.pestana}
              aria-current={activa ? 'page' : undefined}
            >
              {rotulo}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
