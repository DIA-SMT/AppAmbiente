import Link from 'next/link'
import { buscarMovimientos, materialesVisibles, sitiosVisibles } from '@/lib/datos'
import { exigirPanel } from '@/lib/sesion'
import { ETIQUETA_FLUJO, ETIQUETA_TIPO, cantidadDeMovimiento, fechaHora, numero } from '@/lib/formato'
import type {
  EstadoMovimiento, FiltrosMovimientos, Flujo, MovimientoListado, TipoMovimiento,
} from '@/lib/tipos'
import Filtros, { type ValoresFiltro } from './Filtros'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50

type Parametros = Record<string, string | string[] | undefined>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FECHA = /^\d{4}-\d{2}-\d{2}$/

const FLUJOS: Flujo[] = ['planta', 'punto_verde', 'gran_generador']
const TIPOS: TipoMovimiento[] = ['ingreso', 'salida', 'contenedor']

function uno(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()
}

/**
 * Lo que venga por la URL entra a una consulta parametrizada, así que no hay
 * riesgo de inyección; el problema es otro: un uuid o una fecha mal escritos
 * hacen fallar el casteo en Postgres. Lo que no tiene forma válida se ignora.
 */
function leerValores(p: Parametros): ValoresFiltro {
  const sitioId = uno(p.sitioId)
  const materialId = uno(p.materialId)
  const desde = uno(p.desde)
  const hasta = uno(p.hasta)
  const flujo = uno(p.flujo)
  const tipo = uno(p.tipo)
  const estado = uno(p.estado)

  return {
    flujo: FLUJOS.includes(flujo as Flujo) ? flujo : '',
    tipo: TIPOS.includes(tipo as TipoMovimiento) ? tipo : '',
    sitioId: UUID.test(sitioId) ? sitioId : '',
    materialId: UUID.test(materialId) ? materialId : '',
    desde: FECHA.test(desde) ? desde : '',
    hasta: FECHA.test(hasta) ? hasta : '',
    patente: uno(p.patente).slice(0, 20),
    estado: estado === 'anulado' || estado === 'todos' ? estado : 'vigente',
    texto: uno(p.texto).slice(0, 80),
  }
}

function aQuerystring(v: ValoresFiltro, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  for (const [clave, valor] of Object.entries(v)) {
    if (!valor) continue
    if (clave === 'estado' && valor === 'vigente') continue
    p.set(clave, valor)
  }
  for (const [clave, valor] of Object.entries(extra)) {
    if (valor) p.set(clave, valor)
  }
  return p.toString()
}

/**
 * Las fechas de la URL son días sueltos, no instantes: pasarlas por new Date()
 * las lee como UTC y en Tucumán retroceden un día. Se dan vuelta a mano.
 */
function fechaDeUrl(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function ChipTipo({ tipo }: { tipo: MovimientoListado['tipo'] }) {
  const clase = tipo === 'ingreso' || tipo === 'salida' ? ` ${tipo}` : ''
  return <span className={`chip${clase}`}>{ETIQUETA_TIPO[tipo] ?? tipo}</span>
}

export default async function PantallaMovimientos({
  searchParams,
}: {
  searchParams: Promise<Parametros>
}) {
  const sesion = await exigirPanel()

  const parametros = await searchParams
  const valores = leerValores(parametros)

  const paginaPedida = Number(uno(parametros.pagina))
  const pagina = Number.isFinite(paginaPedida) && paginaPedida > 1 ? Math.floor(paginaPedida) : 1

  const filtros: FiltrosMovimientos = {
    flujo: valores.flujo as Flujo | '',
    tipo: valores.tipo as TipoMovimiento | '',
    sitioId: valores.sitioId || undefined,
    materialId: valores.materialId || undefined,
    desde: valores.desde || undefined,
    hasta: valores.hasta || undefined,
    patente: valores.patente || undefined,
    estado: valores.estado as EstadoMovimiento | 'todos',
    texto: valores.texto || undefined,
    pagina,
    porPagina: POR_PAGINA,
  }

  const [{ filas, total }, sitios, materiales] = await Promise.all([
    buscarMovimientos(sesion, filtros),
    sitiosVisibles(sesion),
    materialesVisibles(sesion),
  ])

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const desdeFila = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1
  const hastaFila = Math.min(pagina * POR_PAGINA, total)

  const qsBase = aQuerystring(valores)
  const hrefPagina = (n: number) => {
    const qs = aQuerystring(valores, n > 1 ? { pagina: String(n) } : {})
    return qs ? `/movimientos?${qs}` : '/movimientos'
  }
  const hrefExportar = `/api/exportar?${['vista=movimientos', qsBase].filter(Boolean).join('&')}`

  // Para el estado vacío: decir exactamente qué está achicando el resultado.
  const puestos: string[] = []
  if (valores.texto) puestos.push(`texto «${valores.texto}»`)
  if (valores.flujo) puestos.push(ETIQUETA_FLUJO[valores.flujo] ?? valores.flujo)
  if (valores.tipo) puestos.push(ETIQUETA_TIPO[valores.tipo] ?? valores.tipo)
  if (valores.sitioId) {
    puestos.push(sitios.find((s) => s.id === valores.sitioId)?.nombre ?? 'un punto')
  }
  if (valores.materialId) {
    puestos.push(materiales.find((m) => m.id === valores.materialId)?.nombre ?? 'un material')
  }
  if (valores.patente) puestos.push(`patente ${valores.patente}`)
  if (valores.desde && valores.hasta) puestos.push(`del ${fechaDeUrl(valores.desde)} al ${fechaDeUrl(valores.hasta)}`)
  else if (valores.desde) puestos.push(`desde el ${fechaDeUrl(valores.desde)}`)
  else if (valores.hasta) puestos.push(`hasta el ${fechaDeUrl(valores.hasta)}`)
  if (valores.estado === 'anulado') puestos.push('solo anulados')

  return (
    <div className="contenido ancho pila">
      <div className="fila-entre">
        <div className="crecer">
          <h1>Movimientos</h1>
          <p className="menor gris" style={{ margin: 0 }}>
            {total === 0
              ? (puestos.length ? 'Ningún movimiento con estos filtros' : 'Todavía no hay movimientos cargados')
              : `${numero(total)} ${total === 1 ? 'movimiento' : 'movimientos'}${puestos.length ? ' con los filtros puestos' : ' registrados'}`}
          </p>
        </div>
        <a className="boton secundario" href={hrefExportar}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M4 20h16" />
          </svg>
          Exportar a Excel
        </a>
      </div>

      <Filtros valores={valores} sitios={sitios} materiales={materiales} />

      {filas.length === 0 ? (
        <div className="tarjeta centrado pila" style={{ padding: 36 }}>
          <p className="fuerte" style={{ margin: 0 }}>No hay movimientos para mostrar.</p>
          {puestos.length > 0 ? (
            <>
              <p className="menor gris" style={{ margin: 0 }}>
                Están filtrando: {puestos.join(' · ')}.
              </p>
              <p className="menor gris" style={{ margin: 0 }}>
                Aflojá primero el período o la patente: son los que más achican la lista.
              </p>
              <div>
                <Link className="boton secundario" href="/movimientos">Quitar todos los filtros</Link>
              </div>
            </>
          ) : (
            <p className="menor gris" style={{ margin: 0 }}>
              Todavía no se cargó ningún movimiento.
            </p>
          )}
        </div>
      ) : (
        <div className="desplazable">
          <table className="datos">
            <caption className="sr-solo">
              Movimientos registrados. Cada fila abre el detalle del movimiento.
            </caption>
            <thead>
              <tr>
                <th style={{ textAlign: 'right' }}>Nº</th>
                <th>Fecha y hora</th>
                <th>Punto</th>
                <th>Tipo</th>
                <th>Materiales</th>
                <th style={{ textAlign: 'right' }}>Cantidad</th>
                <th>Origen</th>
                <th>Destino</th>
                <th>Patente</th>
                <th>Cargó</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((m) => (
                <tr key={m.id} className={m.estado === 'anulado' ? 'anulado' : undefined}>
                  <td className="mono numero">
                    <Link href={`/movimientos/${m.id}`} style={{ fontWeight: 800 }}>
                      {m.numero}
                      <span className="sr-solo"> — ver detalle</span>
                    </Link>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fechaHora(m.ocurrido_en)}</td>
                  <td>{m.sitio_nombre}</td>
                  <td><ChipTipo tipo={m.tipo} /></td>
                  <td style={{ minWidth: 180 }}>{m.materiales ?? '—'}</td>
                  <td className="numero">
                    {cantidadDeMovimiento(m)}
                    {m.items > 1 && <span className="gris menor"> · {m.items} mat.</span>}
                  </td>
                  <td>{m.origen_nombre ?? '—'}</td>
                  <td>{m.destino_nombre ?? '—'}</td>
                  <td className="mono">{m.patente ?? '—'}</td>
                  <td>{m.cargado_por_nombre ?? '—'}</td>
                  <td>
                    <span className="fila" style={{ gap: 5, flexWrap: 'nowrap' }}>
                      {m.estado === 'anulado'
                        ? <span className="chip anulado">Anulado</span>
                        : <span className="gris menor">Vigente</span>}
                      {m.carga_diferida && <span className="chip diferida">Diferida</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 && (
        <nav className="fila-entre" aria-label="Paginado">
          <span className="menor gris">
            {numero(desdeFila)}–{numero(hastaFila)} de {numero(total)}
          </span>
          <div className="fila" style={{ gap: 8 }}>
            {pagina > 1
              ? <Link className="boton chico secundario" href={hrefPagina(pagina - 1)}>Anterior</Link>
              : <span className="boton chico secundario" aria-disabled="true" style={{ opacity: .5 }}>Anterior</span>}
            <span className="menor gris cifras">Página {pagina} de {paginas}</span>
            {pagina < paginas
              ? <Link className="boton chico secundario" href={hrefPagina(pagina + 1)}>Siguiente</Link>
              : <span className="boton chico secundario" aria-disabled="true" style={{ opacity: .5 }}>Siguiente</span>}
          </div>
        </nav>
      )}
    </div>
  )
}
