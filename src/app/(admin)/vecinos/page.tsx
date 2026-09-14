import Link from 'next/link'
import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import { fecha, numero } from '@/lib/formato'
import { exigirAdmin } from '@/lib/sesion'
import estilos from '../gente.module.css'
import { anonimizarVecino } from './acciones'

export const dynamic = 'force-dynamic'

const POR_PANTALLA = 200

interface FilaVecino {
  id: string
  nombre: string | null
  telefono: string | null
  barrio: string | null
  anonimizado: boolean
  anonimizado_en: string | null
  creado_en: string
  sitio_nombre: string | null
}

type Busqueda = Record<string, string | string[] | undefined>

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? ''
}

export default async function PantallaVecinos({
  searchParams,
}: {
  searchParams: Promise<Busqueda>
}) {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const parametros = await searchParams
  const busqueda = texto(parametros.q)
  const aviso = texto(parametros.aviso)

  const { filas, total } = await conSesion(sesion, async (tx) => {
    const condicion = busqueda
      ? `where v.nombre ilike $1 or v.telefono ilike $1 or v.barrio ilike $1`
      : ''
    const valores = busqueda ? [`%${busqueda}%`] : []

    const [conteo] = await tx.consultar<{ total: number }>(
      `select count(*)::int as total from vecinos v ${condicion}`,
      valores,
    )
    const filas = await tx.consultar<FilaVecino>(
      `select v.id, v.nombre, v.telefono, v.barrio, v.anonimizado, v.anonimizado_en, v.creado_en,
              s.nombre as sitio_nombre
         from vecinos v
         left join sitios s on s.id = v.sitio_alta_id
         ${condicion}
        order by v.creado_en desc
        limit ${POR_PANTALLA}`,
      valores,
    )
    return { filas, total: conteo?.total ?? 0 }
  })

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Vecinos</h1>
        <p className="menor gris">
          Quienes traen material a un punto verde y dejaron sus datos.
        </p>
      </header>

      <div className="aviso atencion">
        <p style={{ margin: 0 }}>
          <span className="fuerte">Es la única pantalla del sistema con datos personales a la vista.</span>{' '}
          Nombre, teléfono y barrio los ve solo la coordinación: la base no se los muestra a los
          usuarios de los puntos aunque la consulten directo, y no salen en la exportación.
        </p>
      </div>

      {aviso === 'anonimizado' && (
        <div className="aviso exito" role="status">
          Listo. Ese vecino quedó sin nombre, sin teléfono y sin barrio. Sus movimientos siguen contando igual.
        </div>
      )}
      {aviso === 'error' && (
        <div className="aviso error" role="alert">
          No se pudo anonimizar. Probá de nuevo; si sigue fallando, avisale a la Dirección de IA.
        </div>
      )}

      <form method="get" className={estilos.filtros}>
        <div className={`campo ${estilos.filtroAncho}`}>
          <label htmlFor="q">Buscar</label>
          <input
            id="q"
            name="q"
            className="control"
            defaultValue={busqueda}
            placeholder="Nombre, teléfono o barrio"
            autoComplete="off"
          />
        </div>
        <div className={estilos.filtroBotones}>
          <button className="boton" type="submit">Buscar</button>
          {busqueda && <Link className="boton secundario" href="/vecinos">Ver todos</Link>}
        </div>
      </form>

      {total === 0 && !busqueda ? (
        <section className="tarjeta pila-chica">
          <h2>Todavía no hay vecinos cargados</h2>
          <p className="menor gris" style={{ margin: 0 }}>
            Es lo esperado en esta etapa. En la fase 1 los ingresos de vecinos se registran sin
            datos personales: el formulario los marca como vecino sin datos y cuenta el material
            igual. Pedir nombre y teléfono es de la fase 2, y cuando arranque, la lista aparece acá.
          </p>
        </section>
      ) : (
        <>
          <p className="menor gris" style={{ margin: 0 }}>
            {numero(total)} vecino{total === 1 ? '' : 's'}
            {busqueda && <> que coinciden con «{busqueda}»</>}
            {total > POR_PANTALLA && <> · se muestran los {numero(POR_PANTALLA)} más recientes</>}
          </p>

          <div className="desplazable">
            <table className="datos">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Teléfono</th>
                  <th>Barrio</th>
                  <th>Punto donde se dio de alta</th>
                  <th>Fecha</th>
                  <th className={estilos.columnaAcciones}>Datos personales</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((v) => (
                  <tr key={v.id}>
                    <td className="fuerte">{v.nombre ?? <span className="gris">—</span>}</td>
                    <td className="mono">{v.telefono ?? <span className="gris">—</span>}</td>
                    <td>{v.barrio ?? <span className="gris">—</span>}</td>
                    <td>{v.sitio_nombre ?? <span className="gris">—</span>}</td>
                    <td>{fecha(v.creado_en)}</td>
                    <td className={estilos.columnaAcciones}>
                      {v.anonimizado ? (
                        <span className="chip anulado">
                          Anonimizado el {fecha(v.anonimizado_en)}
                        </span>
                      ) : (
                        <details className={estilos.confirmar}>
                          <summary>Anonimizar</summary>
                          <div className={estilos.confirmarCuerpo}>
                            <span>
                              Se vacían el nombre, el teléfono y el barrio de esta ficha y queda
                              marcada con la fecha. Los movimientos que trajo y el tablero no
                              pierden nada: el vínculo sigue existiendo y las cantidades siguen
                              contando. No se puede deshacer.
                            </span>
                            <form action={anonimizarVecino}>
                              <input type="hidden" name="id" value={v.id} />
                              <input type="hidden" name="q" value={busqueda} />
                              <button className="boton peligro chico" type="submit">
                                Sí, anonimizar
                              </button>
                            </form>
                          </div>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="centrado gris">
                      Ningún vecino coincide con «{busqueda}».
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
