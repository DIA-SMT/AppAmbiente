'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import estilos from './Navegacion.module.css'
import { contarPendientes } from './revisiones/acciones'

const SECCIONES = [
  { destino: '/tablero', rotulo: 'Tablero' },
  { destino: '/movimientos', rotulo: 'Movimientos' },
  { destino: '/listas', rotulo: 'Listas' },
  { destino: '/revisiones', rotulo: 'Revisiones' },
  { destino: '/vecinos', rotulo: 'Vecinos' },
  { destino: '/usuarios', rotulo: 'Usuarios' },
  { destino: '/importar', rotulo: 'Importar pesos' },
  { destino: '/auditoria', rotulo: 'Auditoría' },
]

export default function Navegacion() {
  const ruta = usePathname() ?? ''
  const [pendientes, setPendientes] = useState(0)

  // El número al lado de "Revisiones" es lo que hace que alguien entre a
  // revisar: sin él, las altas de la calle se quedan ahí para siempre. El
  // layout no pasa props y no es de esta tarea, así que el dato se pide al
  // servidor desde acá, al montar y cada vez que se cambia de sección.
  useEffect(() => {
    let vigente = true
    contarPendientes()
      .then((n) => { if (vigente) setPendientes(n) })
      .catch(() => { /* La barra funciona igual sin el número. */ })
    return () => { vigente = false }
  }, [ruta])

  return (
    <nav className={estilos.barra} aria-label="Secciones del panel">
      <div className={`ancho ${estilos.pistas}`}>
        {SECCIONES.map(({ destino, rotulo }) => {
          const activa = ruta === destino || ruta.startsWith(`${destino}/`)
          const marcar = destino === '/revisiones' && pendientes > 0

          return (
            <Link
              key={destino}
              href={destino}
              className={estilos.pestana}
              aria-current={activa ? 'page' : undefined}
            >
              {rotulo}
              {marcar && (
                <span className="chip salida cifras" style={{ marginLeft: 7 }}>
                  {pendientes}
                  <span className="sr-solo">
                    {pendientes === 1 ? ' alta sin revisar' : ' altas sin revisar'}
                  </span>
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
