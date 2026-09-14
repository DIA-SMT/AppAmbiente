import Link from 'next/link'
import { redirect } from 'next/navigation'
import { movimientosDelTurno } from '@/lib/datos'
import { ETIQUETA_TIPO, cantidadDeMovimiento, hora } from '@/lib/formato'
import { sesionActual } from '@/lib/sesion'
import { ListaPendientes } from '../turno/SelectorVigilador'

export const dynamic = 'force-dynamic'

export default async function Hoy() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  const movimientos = await movimientosDelTurno(sesion, 100)

  return (
    <div className="pila">
      <div className="fila-entre">
        <h1>Lo de hoy</h1>
        <Link href="/turno" className="boton fantasma chico">Volver</Link>
      </div>

      <ListaPendientes />

      <ul className="lista">
        {movimientos.length === 0 && (
          <li className="vacio">
            Todavía no cargaste nada en este turno.<br />
            Lo que registres va a aparecer acá.
          </li>
        )}

        {movimientos.map((m) => {
          const anulado = m.estado === 'anulado'
          const cuanto = cantidadDeMovimiento(m)
          const lugar = m.tipo === 'ingreso'
            ? `De ${m.origen_nombre ?? '—'}`
            : `A ${m.destino_nombre ?? '—'}`

          return (
            <li key={m.id} className={anulado ? 'anulado' : undefined}>
              <Link
                href={`/listo/${m.numero}`}
                className="pila-chica"
                style={{ color: 'inherit', textDecoration: 'none', display: 'flex' }}
              >
                <span className="fila">
                  <span className="mono menor gris cifras">{hora(m.ocurrido_en)}</span>
                  <span className={`chip ${m.tipo}`}>{ETIQUETA_TIPO[m.tipo]}</span>
                  {anulado && <span className="chip anulado">Anulado</span>}
                  {m.carga_diferida && !anulado && <span className="chip diferida">Cargado después</span>}
                </span>

                <span
                  className="fuerte"
                  style={anulado ? { textDecoration: 'line-through', color: 'var(--gris-suave)' } : undefined}
                >
                  {m.materiales ?? 'Sin material'} · {cuanto}
                </span>

                <span className="menor gris">{lugar}</span>
              </Link>
            </li>
          )
        })}
      </ul>

      <Link href="/cargar/ingreso" className="boton secundario ancho-total">Registrar otro ingreso</Link>
      <Link href="/cargar/salida" className="boton secundario ancho-total">Registrar otra salida</Link>
    </div>
  )
}
