import Link from 'next/link'
import { conSesion } from '@db/sesion'
import { sitiosVisiblesEnTx } from '@/lib/datos'
import { ETIQUETA_DESTINO_CONTENEDOR, cantidad, fecha, hora, numero, paraInputFechaHora } from '@/lib/formato'
import { haySalidasDeContenedorEnTx, salidasDeContenedorEnTx } from '@/lib/salidasContenedor'
import { exigirPanel } from '@/lib/sesion'
import type { SalidaContenedor } from '@/lib/tipos'
import { anular } from './acciones'

export const dynamic = 'force-dynamic'

type Parametros = Record<string, string | string[] | undefined>

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function destino(s: SalidaContenedor): string {
  return s.destino === 'otro' && s.destino_detalle
    ? s.destino_detalle
    : ETIQUETA_DESTINO_CONTENEDOR[s.destino] ?? s.destino
}

/** El primer y el último día del mes de hoy, en Tucumán. */
function mesEnCurso(): { desde: string; hasta: string } {
  const hoy = paraInputFechaHora().slice(0, 10)
  const [a, m] = hoy.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { desde: `${a}-${mm}-01`, hasta: `${a}-${mm}-${String(ultimo).padStart(2, '0')}` }
}

/**
 * Lo que anotaron los puntos que se llevó la 9 de Julio. Es la tercera punta
 * para cruzar: lo que salió del punto, lo que llegó al nodo y lo que la
 * empresa informa y cobra.
 */
export default async function SalidasDeContenedores({
  searchParams,
}: {
  searchParams: Promise<Parametros>
}) {
  const sesion = await exigirPanel()
  const p = await searchParams

  const porDefecto = mesEnCurso()
  const desde = ES_FECHA.test(uno(p.desde)) ? uno(p.desde) : porDefecto.desde
  const hasta = ES_FECHA.test(uno(p.hasta)) ? uno(p.hasta) : porDefecto.hasta
  const sitioId = ES_UUID.test(uno(p.sitio)) ? uno(p.sitio) : ''
  const conAnuladas = uno(p.anuladas) === '1'
  const aviso = uno(p.aviso)
  const detalle = uno(p.detalle)

  const datos = await conSesion(sesion, async (tx) => {
    if (!(await haySalidasDeContenedorEnTx(tx))) return null
    const [sitios, salidas] = await Promise.all([
      sitiosVisiblesEnTx(tx),
      salidasDeContenedorEnTx(tx, { desde, hasta, sitioId: sitioId || undefined, conAnuladas, limite: 2000 }),
    ])
    return { sitios: sitios.filter((s) => s.tipo === 'punto_verde'), salidas }
  })

  const consulta = new URLSearchParams({ desde, hasta })
  if (sitioId) consulta.set('sitio', sitioId)
  if (conAnuladas) consulta.set('anuladas', '1')
  const estaVista = `/recambios/salidas?${consulta}`

  const excel = new URLSearchParams({ desde, hasta })
  if (sitioId) excel.set('sitioId', sitioId)
  if (conAnuladas) excel.set('anuladas', '1')

  // Totales por material y unidad: kilos con kilos y m³ con m³.
  const totales = new Map<string, { material: string; unidad: string; decimales: number; suma: number }>()
  for (const s of datos?.salidas ?? []) {
    if (s.anulada_en) continue
    for (const i of s.items) {
      const clave = `${i.material}|${i.unidad_codigo}`
      const t = totales.get(clave) ?? { material: i.material, unidad: i.unidad_plural || i.unidad, decimales: i.decimales, suma: 0 }
      t.suma += Number(i.cantidad) || 0
      totales.set(clave, t)
    }
  }
  const vigentes = (datos?.salidas ?? []).filter((s) => !s.anulada_en).length

  return (
    <div className="pila">
      <header className="pila-chica">
        <div className="fila-entre">
          <h1>Salidas de contenedores</h1>
          <Link href="/recambios" className="boton fantasma chico">Volver a Recambios</Link>
        </div>
        <p className="gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Cada contenedor lleno que se llevó la 9 de Julio, anotado por el vigilador en el momento:
          a qué hora, en qué camión, quién manejaba, qué llevaba de verdad y a dónde fue. Bajalo en
          Excel para cruzarlo con lo que informa y cobra la empresa.
        </p>
      </header>

      {aviso === 'anulada' && (
        <div className="aviso exito" role="status">
          Salida anulada. Ya no cuenta en los totales ni en el Excel; la ves, con el motivo, marcando
          «Ver también las anuladas».
        </div>
      )}
      {aviso === 'error' && <div className="aviso error" role="alert">{detalle || 'No se pudo anular.'}</div>}

      {!datos ? (
        <div className="aviso atencion">
          La base todavía no tiene las salidas de contenedores: falta aplicar la migración 0027.
          Hasta entonces los puntos no ven el botón para anotarlas.
        </div>
      ) : (
        <>
          <form method="get" className="tarjeta fila" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: 14 }}>
            <div className="campo">
              <label htmlFor="desde">Desde</label>
              <input id="desde" name="desde" type="date" className="control" defaultValue={desde} />
            </div>
            <div className="campo">
              <label htmlFor="hasta">Hasta</label>
              <input id="hasta" name="hasta" type="date" className="control" defaultValue={hasta} />
            </div>
            <div className="campo">
              <label htmlFor="sitio">Punto</label>
              <select id="sitio" name="sitio" className="control" defaultValue={sitioId}>
                <option value="">Todos los puntos</option>
                {datos.sitios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <label className="fila menor" style={{ gap: 6, minHeight: 44 }}>
              <input type="checkbox" name="anuladas" value="1" defaultChecked={conAnuladas} />
              Ver también las anuladas
            </label>
            <button type="submit" className="boton secundario">Filtrar</button>
            <a href={`/api/exportar/salidas?${excel}`} className="boton">Bajar en Excel</a>
          </form>

          <section className="pila-chica">
            <div className="fila-entre">
              <h2>{numero(vigentes)} {vigentes === 1 ? 'salida' : 'salidas'}</h2>
              {totales.size > 0 && (
                <span className="menor gris">
                  {[...totales.values()]
                    .map((t) => `${t.material}: ${numero(t.suma, t.decimales)} ${t.unidad}`)
                    .join(' · ')}
                </span>
              )}
            </div>

            {datos.salidas.length === 0 ? (
              <div className="tarjeta centrado pila" style={{ padding: 32 }}>
                <p className="fuerte" style={{ margin: 0 }}>No hay salidas anotadas en este período.</p>
                <p className="menor gris" style={{ margin: 0 }}>
                  El vigilador las anota desde el celular con «Se va un contenedor».
                </p>
              </div>
            ) : (
              <div className="desplazable tabla-ficha">
                <table className="datos">
                  <caption className="sr-solo">Salidas de contenedores anotadas en los puntos.</caption>
                  <thead>
                    <tr>
                      <th>Cuándo</th>
                      <th>Punto</th>
                      <th>Patente / interno</th>
                      <th>Chofer</th>
                      <th>Qué llevaba</th>
                      <th>Destino</th>
                      <th><span className="sr-solo">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.salidas.map((s) => (
                      <tr key={s.id} className={s.anulada_en ? 'anulado' : undefined}>
                        <td data-rotulo="Cuándo" className="cifras">{fecha(s.salio_en)} · {hora(s.salio_en)}</td>
                        {/* Quién la cargó no va: la cuenta es la del punto, y
                            repetirlo sólo apretaba la columna. Está en el Excel. */}
                        <td data-rotulo="Punto">
                          <span className="fuerte">{s.sitio_codigo}</span> {s.sitio_nombre}
                        </td>
                        <td data-rotulo="Patente" className="mono">{s.patente}</td>
                        <td data-rotulo="Chofer">{s.chofer ?? '—'}</td>
                        <td data-rotulo="Qué llevaba">
                          {s.items.map((i) => (
                            <span key={i.material} style={{ display: 'block' }}>
                              {i.material}: {cantidad(i.cantidad, { nombre: i.unidad, nombre_plural: i.unidad_plural, decimales: i.decimales })}
                            </span>
                          ))}
                          {s.observaciones && <span className="menor gris" style={{ display: 'block' }}>«{s.observaciones}»</span>}
                        </td>
                        <td data-rotulo="Destino">{destino(s)}</td>
                        <td>
                          {s.anulada_en ? (
                            <span className="menor gris">Anulada{s.anulada_por ? ` por ${s.anulada_por}` : ''}: {s.motivo_anulacion}</span>
                          ) : (
                            <details>
                              <summary className="boton chico secundario">Anular</summary>
                              <form action={anular.bind(null, s.id, estaVista)} className="pila-chica" style={{ marginTop: 8 }}>
                                <input
                                  name="motivo"
                                  className="control"
                                  type="text"
                                  maxLength={200}
                                  placeholder="Por qué (ej.: se cargó dos veces)"
                                  aria-label="Motivo de la anulación"
                                  required
                                  minLength={3}
                                />
                                <button type="submit" className="boton peligro chico">Anular la salida</button>
                              </form>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
