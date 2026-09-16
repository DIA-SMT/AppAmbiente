'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import estilos from './Navegacion.module.css'
import { contarPendientes } from './revisiones/acciones'

const SECCIONES = [
  { destino: '/tablero', rotulo: 'Tablero', icono: 'tablero' },
  { destino: '/movimientos', rotulo: 'Movimientos', icono: 'movimientos' },
  { destino: '/pilas', rotulo: 'Pilas', icono: 'pilas' },
  { destino: '/trazabilidad', rotulo: 'Trazabilidad', icono: 'trazabilidad' },
  { destino: '/conteos', rotulo: 'Conteos', icono: 'conteos' },
  { destino: '/listas', rotulo: 'Listas', icono: 'listas' },
  { destino: '/revisiones', rotulo: 'Revisiones', icono: 'revisiones' },
  { destino: '/vecinos', rotulo: 'Vecinos', icono: 'vecinos' },
  { destino: '/usuarios', rotulo: 'Usuarios', icono: 'usuarios' },
  { destino: '/importar', rotulo: 'Importar pesos', icono: 'importar' },
  { destino: '/auditoria', rotulo: 'Auditoría', icono: 'auditoria' },
] as const

type Icono = (typeof SECCIONES)[number]['icono']

function IconoNavegacion({ nombre }: { nombre: Icono }) {
  const contenido = {
    tablero: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    movimientos: <><path d="M7 7h11" /><path d="m14 3 4 4-4 4" /><path d="M17 17H6" /><path d="m10 21-4-4 4-4" /></>,
    pilas: <><path d="m12 3-9 5 9 5 9-5-9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>,
    trazabilidad: <><circle cx="5" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 6h4a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3" /><path d="m9 14-3 3 3 3" /></>,
    conteos: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2" /><path d="m9 13 2 2 4-5" /></>,
    listas: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
    revisiones: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    vecinos: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    usuarios: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><circle cx="12" cy="9" r="2" /><path d="M8.8 16a3.5 3.5 0 0 1 6.4 0" /></>,
    importar: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
    auditoria: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>,
  }[nombre]

  return (
    <svg className={estilos.icono} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {contenido}
    </svg>
  )
}

export default function Navegacion({ contraida = false }: { contraida?: boolean }) {
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
    <nav id="navegacion-panel" className={`${estilos.barra} ${contraida ? estilos.contraida : ''}`} aria-label="Secciones del panel">
      <div className={estilos.pistas}>
        {SECCIONES.map(({ destino, rotulo, icono }) => {
          const activa = ruta === destino || ruta.startsWith(`${destino}/`)
          const marcar = destino === '/revisiones' && pendientes > 0

          return (
            <Link
              key={destino}
              href={destino}
              className={estilos.pestana}
              aria-current={activa ? 'page' : undefined}
              aria-label={contraida ? rotulo : undefined}
              title={contraida ? rotulo : undefined}
            >
              <IconoNavegacion nombre={icono} />
              <span className={estilos.rotulo}>{rotulo}</span>
              {marcar && (
                <span className={`chip salida cifras ${estilos.contador}`}>
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
