import Link from 'next/link'
import { conSesion } from '@db/sesion'
import { fecha, numero } from '@/lib/formato'
import { exigirPanel } from '@/lib/sesion'
import estilos from '../gente.module.css'
import { anonimizarVecino } from './acciones'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50

interface FilaVecino {
  id: string
  nombre: string | null
  telefono: string | null
  barrio: string | null
  anonimizado: boolean
  anonimizado_en: string | null
  creado_en: string
  sitio_nombre: string | null
  /** Ingresos que trajo: cada vez que vino a dejar material. */
  visitas: number
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
  const sesion = await exigirPanel()

  const parametros = await searchParams
  const busqueda = texto(parametros.q).slice(0, 80)
  const aviso = texto(parametros.aviso)
  const conTelefonoPedido = texto(parametros.tel)
  const filtroTel = conTelefonoPedido === 'con' || conTelefonoPedido === 'sin' ? conTelefonoPedido : ''

  const paginaPedida = Number(texto(parametros.pagina))
  const paginaPuesta = Number.isFinite(paginaPedida) && paginaPedida > 1 ? Math.floor(paginaPedida) : 1

  // Cada valor entra como parámetro; par() devuelve su marcador para no
  // escribir los números a mano.
  const valores: unknown[] = []
  const par = (valor: unknown) => `$${valores.push(valor)}`
  const condiciones: string[] = []

  if (busqueda) {
    const como = par(`%${busqueda}%`)
    // El teléfono se guarda normalizado (los 10 dígitos de un número
    // argentino), así que buscar "0381 15 456-7890" tal cual no encuentra
    // nada: se compara también por los dígitos sueltos y por el número
    // normalizado con la misma función que usa el alta.
    const digitos = busqueda.replace(/\D/g, '')
    const porTelefono = digitos.length >= 3
      ? ` or v.telefono like ${par(`%${digitos}%`)} or v.telefono = app.normalizar_telefono(${par(busqueda)})`
      : ''
    condiciones.push(`(v.nombre ilike ${como} or v.barrio ilike ${como}${porTelefono})`)
  }
  if (filtroTel === 'con') condiciones.push('v.telefono is not null')
  if (filtroTel === 'sin') condiciones.push('v.telefono is null')

  const condicion = condiciones.length ? `where ${condiciones.join(' and ')}` : ''

  const { filas, total, identificados, pagina } = await conSesion(sesion, async (tx) => {
    const [conteo] = await tx.consultar<{ total: number; identificados: number }>(
      `select count(*)::int as total,
              count(*) filter (where v.telefono is not null)::int as identificados
         from vecinos v ${condicion}`,
      valores,
    )
    const total = conteo?.total ?? 0
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
    const pagina = Math.min(paginaPuesta, paginas)

    const filas = await tx.consultar<FilaVecino>(
      `select v.id, v.nombre, v.telefono, v.barrio, v.anonimizado, v.anonimizado_en, v.creado_en,
              s.nombre as sitio_nombre,
              (select count(*) from movimientos m where m.origen_vecino_id = v.id)::int as visitas
         from vecinos v
         left join sitios s on s.id = v.sitio_alta_id
         ${condicion}
        order by v.creado_en desc, v.id
        limit ${POR_PAGINA} offset ${(pagina - 1) * POR_PAGINA}`,
      valores,
    )
    return { filas, total, identificados: conteo?.identificados ?? 0, pagina }
  })

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const desdeFila = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1
  const hastaFila = Math.min(pagina * POR_PAGINA, total)
  const filtrando = Boolean(busqueda || filtroTel)

  const enlace = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams()
    if (busqueda) p.set('q', busqueda)
    if (filtroTel) p.set('tel', filtroTel)
    for (const [clave, valor] of Object.entries(extra)) if (valor) p.set(clave, valor)
    const qs = p.toString()
    return qs ? `/vecinos?${qs}` : '/vecinos'
  }

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Vecinos</h1>
        <p className="menor gris">
          Quienes traen material a un punto verde y dejaron sus datos. Quien deja el teléfono se
          reconoce la próxima vez que viene y el tablero lo cuenta como vecino identificado; quien
          no deja nada suma una visita y nada más.
        </p>
      </header>

      <div className="aviso atencion">
        <p style={{ margin: 0 }}>
          <span className="fuerte">Es la única pantalla del sistema con datos personales a la vista.</span>{' '}
          Nombre, teléfono y barrio los ve solo la coordinación, y no salen en la exportación.
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
        <div className={`campo ${estilos.filtro}`}>
          <label htmlFor="tel">Teléfono</label>
          <select id="tel" name="tel" className="control" defaultValue={filtroTel}>
            <option value="">Todos</option>
            <option value="con">Solo los que dejaron teléfono</option>
            <option value="sin">Solo los que no dejaron</option>
          </select>
        </div>
        <div className={estilos.filtroBotones}>
          <button className="boton" type="submit">Buscar</button>
          {filtrando && <Link className="boton secundario" href="/vecinos">Ver todos</Link>}
        </div>
      </form>

      {total === 0 && !filtrando ? (
        <section className="tarjeta pila-chica">
          <h2>Todavía no hay vecinos cargados</h2>
          <p className="menor gris" style={{ margin: 0 }}>
            Un vecino aparece acá recién cuando un vigilador carga un ingreso en un punto verde y
            anota al menos el teléfono o el nombre. Los que prefieren no dejar datos se registran
            como vecino sin datos: el material se cuenta igual, pero no se crea ninguna ficha.
          </p>
        </section>
      ) : (
        <>
          <p className="menor gris" style={{ margin: 0 }}>
            {numero(total)} vecino{total === 1 ? '' : 's'}
            {busqueda && <> que coinciden con «{busqueda}»</>}
            {' · '}
            {numero(identificados)} con teléfono
            {total > 0 && <> · {numero(total - identificados)} sin teléfono</>}
          </p>

          <div className="desplazable">
            <table className="datos">
              <caption className="sr-solo">
                Vecinos registrados. Las visitas son los ingresos que trajo cada uno.
              </caption>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Teléfono</th>
                  <th>Barrio</th>
                  <th>Punto donde se dio de alta</th>
                  <th>Fecha</th>
                  <th style={{ textAlign: 'right' }}>Visitas</th>
                  <th className={estilos.columnaAcciones}>Datos personales</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((v) => (
                  <tr key={v.id}>
                    <td className="fuerte">{v.nombre ?? <span className="gris">Sin nombre</span>}</td>
                    <td>
                      {v.telefono
                        ? <span className="mono">{v.telefono}</span>
                        : v.anonimizado
                          ? <span className="gris">—</span>
                          : <span className="chip pendiente">Sin teléfono</span>}
                    </td>
                    <td>{v.barrio ?? <span className="gris">—</span>}</td>
                    <td>{v.sitio_nombre ?? <span className="gris">—</span>}</td>
                    <td>{fecha(v.creado_en)}</td>
                    <td className="numero">{numero(v.visitas)}</td>
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
                    <td colSpan={7} className="centrado gris">
                      Ningún vecino coincide con lo que buscaste.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {paginas > 1 && (
            <nav className={estilos.paginado} aria-label="Paginado">
              <span className="menor gris">
                {numero(desdeFila)}–{numero(hastaFila)} de {numero(total)}
              </span>
              <div className="fila" style={{ gap: 8 }}>
                {pagina > 1
                  ? <Link className="boton chico secundario" href={enlace(pagina - 1 > 1 ? { pagina: String(pagina - 1) } : {})}>Anterior</Link>
                  : <span className="boton chico secundario" aria-disabled="true" style={{ opacity: .5 }}>Anterior</span>}
                <span className="menor gris cifras">Página {pagina} de {paginas}</span>
                {pagina < paginas
                  ? <Link className="boton chico secundario" href={enlace({ pagina: String(pagina + 1) })}>Siguiente</Link>
                  : <span className="boton chico secundario" aria-disabled="true" style={{ opacity: .5 }}>Siguiente</span>}
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
