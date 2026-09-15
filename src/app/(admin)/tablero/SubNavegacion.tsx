'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import estilos from './SubNavegacion.module.css'

const TABLEROS = [
  { destino: '/tablero', rotulo: 'Planta' },
  { destino: '/tablero/puntos-verdes', rotulo: 'Puntos Verdes' },
]

export default function SubNavegacion() {
  const ruta = usePathname() ?? ''

  // /tablero es prefijo de /tablero/puntos-verdes: si se marcara por prefijo,
  // las dos pestañas quedarían activas a la vez. Gana la coincidencia más larga.
  const activa = TABLEROS.reduce((mejor, t) => {
    const coincide = ruta === t.destino || ruta.startsWith(`${t.destino}/`)
    return coincide && t.destino.length > mejor.length ? t.destino : mejor
  }, '')

  return (
    <nav className={estilos.barra} aria-label="Tableros">
      {TABLEROS.map(({ destino, rotulo }) => (
        <Link
          key={destino}
          href={destino}
          className={estilos.pestana}
          aria-current={destino === activa ? 'page' : undefined}
        >
          {rotulo}
        </Link>
      ))}
    </nav>
  )
}
