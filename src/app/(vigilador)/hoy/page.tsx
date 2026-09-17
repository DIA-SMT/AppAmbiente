import Link from 'next/link'
import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import { movimientosDelTurnoEnTx } from '@/lib/datos'
import { ETIQUETA_TIPO, ETIQUETA_VALORIZACION, cantidadDeMovimiento, hora } from '@/lib/formato'
import { sesionActual } from '@/lib/sesion'
import { ListaPendientes } from '../turno/SelectorVigilador'

export const dynamic = 'force-dynamic'

export default async function Hoy() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  // El tipo de sitio decide cómo se nombran los dos botones del final. Los
  // chips de cada fila no lo necesitan: cada movimiento trae su propio flujo.
  //
  // Las dos consultas van adentro de una sola transacción. Abrir una cuesta
  // cuatro viajes a la base (BEGIN, poner la identidad, la consulta, COMMIT) y
  // el pool serverless tiene una conexión sola: dos conSesion se hacen uno
  // después del otro por más Promise.all que los envuelva. Sobre el mismo `tx`
  // sí salen encauzadas y viajan juntas.
  const [movimientos, sitios] = await conSesion(sesion, (tx) => Promise.all([
    movimientosDelTurnoEnTx(tx, 100),
    sesion.sitioId
      ? tx.consultar<{ tipo: string }>(
          `select tipo from sitios where id = $1`, [sesion.sitioId],
        )
      : Promise.resolve([]),
  ]))

  const esPuntoVerde = sitios[0]?.tipo === 'punto_verde'

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
            ? m.origen_clase === 'vecino' ? 'De un vecino' : `De ${m.origen_nombre ?? '—'}`
            : m.destino_clase === 'vecino' ? 'Se lo llevó un vecino' : `A ${m.destino_nombre ?? '—'}`

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
                  {m.flujo === 'punto_verde' && m.tipo === 'salida' && m.tipo_valorizacion && (
                    <span className="chip">{ETIQUETA_VALORIZACION[m.tipo_valorizacion]}</span>
                  )}
                  {m.vecino_sin_datos && <span className="chip">Sin datos</span>}
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

      <Link href="/cargar/ingreso" className="boton secundario ancho-total">
        {esPuntoVerde ? 'Registrar lo que trae un vecino' : 'Registrar otro ingreso'}
      </Link>
      <Link href="/cargar/salida" className="boton secundario ancho-total">
        {esPuntoVerde ? 'Registrar lo que se lleva alguien' : 'Registrar otra salida'}
      </Link>
    </div>
  )
}
