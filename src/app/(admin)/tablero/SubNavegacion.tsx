'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import estilos from './SubNavegacion.module.css'

interface Pestana {
  destino: string
  rotulo: string
}

const TABLEROS: Pestana[] = [
  { destino: '/tablero', rotulo: 'Planta' },
  { destino: '/tablero/puntos-verdes', rotulo: 'Puntos Verdes' },
]

/**
 * Las pestañas de arriba de una sección con más de una pantalla. Nació para
 * los tableros y la usa también Importar: por eso las pestañas y el nombre de
 * la barra se pueden pasar, y sin pasarlos son los de los tableros.
 */
export default function SubNavegacion({
  pestanas = TABLEROS,
  rotulo = 'Tableros',
}: {
  pestanas?: Pestana[]
  rotulo?: string
}) {
  const ruta = usePathname() ?? ''

  // /tablero es prefijo de /tablero/puntos-verdes: si se marcara por prefijo,
  // las dos pestañas quedarían activas a la vez. Gana la coincidencia más larga.
  const activa = pestanas.reduce((mejor, t) => {
    const coincide = ruta === t.destino || ruta.startsWith(`${t.destino}/`)
    return coincide && t.destino.length > mejor.length ? t.destino : mejor
  }, '')

  return (
    <nav className={estilos.barra} aria-label={rotulo}>
      {pestanas.map(({ destino, rotulo }) => (
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
