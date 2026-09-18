import Link from 'next/link'
import { consultarConSesion } from '@db/sesion'
import { numero } from '@/lib/formato'
import { RECURSOS, identificador } from '@/lib/recursos'
import { exigirAdmin } from '@/lib/sesion'
import estilos from './listas.module.css'

export const dynamic = 'force-dynamic'

function Flecha() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export default async function IndiceDeListas() {
  const sesion = await exigirAdmin()

  // Una sola ida a la base para los seis conteos. Los nombres de tabla salen
  // de la definición y pasan por identificador(): nada viene del pedido.
  const conteos = await consultarConSesion<{ clave: string; total: string }>(
    sesion,
    RECURSOS.map(
      (r) => `select '${identificador(r.clave)}' as clave, count(*)::text as total
                from ${identificador(r.tabla)} where activo`,
    ).join(' union all '),
  )
  const porClave = new Map(conteos.map((c) => [c.clave, Number(c.total)]))

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Listas</h1>
        <p className="gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Todo lo que el vigilador elige en el celular sale de acá.
        </p>
      </header>

      <div className="aviso">
        Nada se borra. Lo que se desactiva deja de ofrecerse en el celular, y los
        movimientos que ya lo usaron se siguen viendo igual.
      </div>

      <div className={estilos.tarjetas}>
        {RECURSOS.map((recurso) => {
          const total = porClave.get(recurso.clave) ?? 0
          return (
            <Link
              key={recurso.clave}
              href={`/listas/${recurso.clave}`}
              className={`tarjeta ${estilos.tarjetaLista}`}
            >
              <h2 className={estilos.titulo}>
                {recurso.plural}
                <Flecha />
              </h2>
              <p className="menor gris" style={{ margin: 0 }}>{recurso.paraQue}</p>
              <p className={`menor ${estilos.conteo}`} style={{ margin: 0 }}>
                <span className="fuerte cifras">{numero(total)}</span>{' '}
                <span className="gris">
                  {recurso.articulo === 'una'
                    ? (total === 1 ? 'activa' : 'activas')
                    : (total === 1 ? 'activo' : 'activos')}
                </span>
              </p>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
