import Link from 'next/link'
import { conSesion } from '@db/sesion'
import {
  buscarMovimientosEnTx, materialesVisiblesEnTx, metrosCubicosPorTipo, sitiosVisiblesEnTx,
  totalesDeMovimientosEnTx, type TotalDeMovimientos,
} from '@/lib/datos'
import { exigirPanel } from '@/lib/sesion'
import {
  ETIQUETA_FLUJO, ETIQUETA_TIPO, cantidad, cantidadDeMovimiento, fechaHora, numero,
} from '@/lib/formato'
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

/** Kilos, bolsas y camiones son enteros; los m³ no. Como en la ficha del movimiento. */
const decimalesDe = (valor: number) => (Number.isInteger(valor) ? 0 : 2)

/**
 * Cuánto suman los movimientos del filtro.
 *
 * Sin esto la pantalla contaba camiones y no material: «57 movimientos» no
 * contesta cuánta poda entró la semana pasada, y la cuenta había que sacarla
 * exportando a Excel. Va arriba de la tabla porque es lo que se vino a buscar;
 * la tabla es el detalle.
 */
function Totales({
  totales,
  estado,
  material,
}: {
  totales: TotalDeMovimientos[]
  estado: string
  material: string | null
}) {
  const m3 = metrosCubicosPorTipo(totales)
  // En m³ la equivalencia repetiría la cantidad, y en kg o en bolsas no existe:
  // sólo se escribe donde agrega algo. Si no agrega nada en ninguna fila —lo
  // común en la Planta, que carga casi todo en m³— la columna entera se va: una
  // columna de guiones se lee como un dato que falta.
  const convierte = (t: TotalDeMovimientos) => t.factor_m3 !== null && t.unidad_codigo !== 'm3'
  const conEquivalencia = totales.some(convierte)
  const resumen = (['ingreso', 'salida'] as const)
    .flatMap((tipo) => {
      const suma = m3[tipo]
      return suma === null ? [] : [`${tipo === 'ingreso' ? 'entraron' : 'salieron'} ${numero(suma, 1)} m³`]
    })
    .join(' · ')

  return (
    <section className="tarjeta pila-chica" aria-label="Cuánto suman los movimientos del filtro">
      <div className="fila-entre">
        <h2 style={{ fontSize: '1rem' }}>Cuánto suman</h2>
        {resumen && <span className="menor gris cifras">{resumen}</span>}
      </div>

      {totales.length === 0 ? (
        <p className="menor gris" style={{ margin: 0 }}>
          Los movimientos anulados siguen registrados para consulta, pero no suman: no es material
          que haya entrado o salido.
        </p>
      ) : (
        /* Cinco columnas no entran en 390 px: abajo de 720 cada fila pasa a
           ser una ficha apilada, como la tabla de materiales de la ficha. */
        <div className="desplazable tabla-ficha">
          <table className="datos">
            <caption className="sr-solo">
              Cantidad por tipo, material y unidad de los movimientos del filtro.
            </caption>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Material</th>
                <th style={{ textAlign: 'right' }}>Cantidad</th>
                {conEquivalencia && <th style={{ textAlign: 'right' }}>Equivale a</th>}
                <th style={{ textAlign: 'right' }}>Movimientos</th>
              </tr>
            </thead>
            <tbody>
              {totales.map((t) => {
                const suma = Number(t.cantidad)
                return (
                  <tr key={`${t.tipo}|${t.material_id}|${t.unidad_codigo}`}>
                    <td data-rotulo="Tipo"><ChipTipo tipo={t.tipo} /></td>
                    <td data-rotulo="Material">
                      <span className="fila" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <span className="punto" style={{ background: t.material_color }} aria-hidden="true" />
                        <span className="fuerte">{t.material_nombre}</span>
                      </span>
                    </td>
                    <td data-rotulo="Cantidad" className="numero fuerte">
                      {cantidad(suma, {
                        nombre: t.unidad_nombre,
                        nombre_plural: t.unidad_plural,
                        decimales: decimalesDe(suma),
                      })}
                    </td>
                    {conEquivalencia && (
                      <td data-rotulo="Equivale a" className="numero gris">
                        {convierte(t) ? `${numero(t.equivalente_m3, 1)} m³` : '—'}
                      </td>
                    )}
                    <td data-rotulo="Movimientos" className="numero">{numero(t.movimientos)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {material && totales.length > 0 && (
        <p className="menor gris" style={{ margin: 0 }}>
          Suma sólo lo cargado como {material}. Si un movimiento trajo además otro material, ese
          otro no entra en esta cuenta, aunque el movimiento sí aparezca en la lista.
        </p>
      )}
      {estado === 'todos' && totales.length > 0 && (
        <p className="menor gris" style={{ margin: 0 }}>
          La lista incluye los anulados, pero la suma es sólo de los vigentes.
        </p>
      )}
      {totales.some((t) => t.factor_m3 === null) && (
        <p className="menor gris" style={{ margin: 0 }}>
          Los kilos y las bolsas no se pasan a m³: se informan en su unidad y no entran en los m³
          de arriba.
        </p>
      )}
    </section>
  )
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

  // Una sola transacción para las cuatro lecturas: abrir cada una por separado
  // son cuatro viajes fijos por cabeza, y el pool en serverless tiene una sola
  // conexión, así que se hacían cola. Sobre el mismo `tx` viajan juntas.
  const [{ filas, total }, totales, sitios, materiales] = await conSesion(sesion, (tx) =>
    Promise.all([
      buscarMovimientosEnTx(tx, filtros),
      totalesDeMovimientosEnTx(tx, filtros),
      sitiosVisiblesEnTx(tx),
      materialesVisiblesEnTx(tx),
    ]),
  )

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const desdeFila = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1
  const hastaFila = Math.min(pagina * POR_PAGINA, total)

  const qsBase = aQuerystring(valores)
  const hrefPagina = (n: number) => {
    const qs = aQuerystring(valores, n > 1 ? { pagina: String(n) } : {})
    return qs ? `/movimientos?${qs}` : '/movimientos'
  }
  const hrefExportar = `/api/exportar?${['vista=movimientos', qsBase].filter(Boolean).join('&')}`

  const materialElegido = valores.materialId
    ? materiales.find((m) => m.id === valores.materialId)?.nombre ?? 'ese material'
    : null

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
    <div className="ancho pila">
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

      {filas.length > 0 && (
        <Totales totales={totales} estado={valores.estado} material={materialElegido} />
      )}

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
