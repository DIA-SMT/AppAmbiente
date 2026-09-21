import { pedidosDeRecambio, respuestaDeRecambio } from '@/lib/datos'
import { fecha, fechaHora, numero, paraInputFechaHora } from '@/lib/formato'
import { exigirPanel } from '@/lib/sesion'
import type { PedidoRecambio } from '@/lib/tipos'
import { avisar, cancelar } from './acciones'
import ConfirmarRetiro, { CopiarParaWhatsApp } from './ConfirmarRetiro'
import estilos from './recambios.module.css'

export const dynamic = 'force-dynamic'

/** Las casillas viven en la lista, fuera del formulario, y se atan por acá. */
const FORMULARIO_LOTE = 'avisar-en-lote'

type Parametros = Record<string, string | string[] | undefined>

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()

/**
 * Una espera, leída como se habla: en horas hasta dos días, en días después.
 * Pasadas las 48 horas «73,4 h» no le dice nada a nadie; «3,1 días» sí.
 */
function espera(horas: number | string | null | undefined): string {
  if (horas === null || horas === undefined || horas === '') return '—'
  const h = Number(horas)
  if (!Number.isFinite(h)) return '—'
  if (h < 1) return 'menos de 1 h'
  if (h < 48) return `${numero(h, 1)} h`
  return `${numero(h / 24, 1)} días`
}

/** La misma espera, contada desde el presente: «hace 2 días». */
function hace(horas: number | string | null | undefined): string {
  const h = Number(horas)
  if (!Number.isFinite(h)) return 'hace un rato'
  if (h < 1) return 'recién'
  if (h < 48) return `hace ${numero(Math.round(h))} h`
  return `hace ${numero(Math.floor(h / 24))} días`
}

const diasEnteros = (horas: number | string | null | undefined) =>
  Math.floor(Number(horas) / 24) || 0

/** Horas transcurridas desde un instante, para poder leerlo con hace(). */
const horasDesde = (v: string | Date) => (Date.now() - new Date(v).getTime()) / 3_600_000

/** El material del contenedor. Sin numeración física, es lo que lo nombra. */
const corriente = (p: PedidoRecambio) => p.material ?? 'sin corriente asignada'

/**
 * Los demorados primero, y dentro de cada grupo el orden que ya trae la
 * consulta: urgentes arriba y después del más viejo al más nuevo. El sort de
 * JavaScript es estable, así que alcanza con levantar los demorados.
 */
const demoradosArriba = (pedidos: PedidoRecambio[]) =>
  [...pedidos].sort((a, b) => Number(b.demorado) - Number(a.demorado))

export default async function PantallaRecambios({
  searchParams,
}: {
  searchParams: Promise<Parametros>
}) {
  const sesion = await exigirPanel()

  const parametros = await searchParams
  const aviso = uno(parametros.aviso)
  const detalle = uno(parametros.detalle)

  const [respuesta, abiertos] = await Promise.all([
    respuestaDeRecambio(sesion),
    pedidosDeRecambio(sesion),
  ])

  const hoy = paraInputFechaHora().slice(0, 10)

  const sinAvisar = demoradosArriba(abiertos.filter((p) => p.estado === 'pedido'))
  const avisados = demoradosArriba(abiertos.filter((p) => p.estado === 'avisado'))
  const demorados = abiertos.filter((p) => p.demorado).length

  // Mientras no haya un solo retiro confirmado, el tramo de la empresa no se
  // puede promediar: no hay de qué sacar el promedio.
  const cerrados = respuesta.reduce((suma, r) => suma + Number(r.retirados || 0), 0)

  const lineas = sinAvisar.map((p) => ({
    id: p.id,
    texto:
      `· ${p.sitio_nombre} — ${corriente(p)}`
      + (p.urgente ? ' — URGENTE' : '')
      + ` (pedido ${hace(p.horas_totales)})`,
  }))

  /** La ficha de un pedido: lo mismo en las dos colas, cambia lo que se mide. */
  const ficha = (p: PedidoRecambio) => (
    <>
      <div className="fila" style={{ gap: 6 }}>
        {p.urgente && <span className="chip salida">Urgente</span>}
        {p.demorado && (
          <span className="chip anulado cifras">
            Demorado · {numero(diasEnteros(p.horas_totales))} días
          </span>
        )}
        <span className="chip">
          {p.material_color && (
            <span className="punto" style={{ background: p.material_color }} aria-hidden="true" />
          )}
          {corriente(p)}
        </span>
      </div>

      <h3 className={estilos.titulo}>
        <span className={`mono ${estilos.codigo}`}>{p.sitio_codigo}</span> {p.sitio_nombre}
      </h3>

      <div className={estilos.datos}>
        <span>
          Pedido {hace(p.horas_totales)} ({fechaHora(p.pedido_en)}) · lo pidió{' '}
          <span className="fuerte">{p.pedido_por ?? 'alguien que ya no está'}</span>
        </span>
        {p.estado === 'avisado' ? (
          <span>
            Avisado a la empresa el {fechaHora(p.avisado_en)}
            {p.avisado_por && <> por <span className="fuerte">{p.avisado_por}</span></>} · el
            municipio tardó {espera(p.horas_hasta_aviso)} en pasarlo · hace{' '}
            <span className="fuerte">{espera(p.horas_hasta_retiro)}</span> que está del lado de la
            9 de Julio
          </span>
        ) : (
          <span>Todavía sin avisar a la empresa</span>
        )}
        {p.observaciones && <span className={estilos.observacion}>«{p.observaciones}»</span>}
      </div>
    </>
  )

  /** Confirmar el retiro y cancelar, que es lo que se puede hacer con cualquiera. */
  const acciones = (p: PedidoRecambio) => (
    <div className={estilos.acciones}>
      <ConfirmarRetiro
        id={p.id}
        punto={p.sitio_nombre}
        corriente={corriente(p)}
        hoy={hoy}
        desde={p.avisado_en ? paraInputFechaHora(p.avisado_en).slice(0, 10) : null}
      />

      <details className={`${estilos.desplegable} ${estilos.peligroso}`}>
        <summary>Cancelar</summary>
        <div className={estilos.cuerpo}>
          <p>
            Para cuando el pedido no correspondía: el contenedor no estaba tan lleno, o lo
            retiraron sin que nadie avisara y ya no hay nada que pedir. El pedido no se borra —acá
            no se borra nada—, queda cancelado y deja de contar en el tiempo de respuesta.
          </p>
          <form action={cancelar.bind(null, p.id)} className="pila-chica">
            <div className="campo">
              <label htmlFor={`motivo-${p.id}`}>Por qué se cancela</label>
              <input
                id={`motivo-${p.id}`}
                name="motivo"
                type="text"
                className="control"
                maxLength={200}
                autoComplete="off"
                placeholder="Ej.: lo retiraron ayer sin aviso"
                required
              />
            </div>
            <button type="submit" className="boton peligro ancho-total">
              Cancelar el pedido
            </button>
          </form>
        </div>
      </details>
    </div>
  )

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Recambios de contenedores</h1>
        <p className="gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          El vigilador ve un contenedor lleno y lo pide desde el punto. Acá está lo que hay
          pendiente y desde cuándo, para pasarlo al grupo de choferes de la 9 de Julio. La app no le
          avisa a la empresa: ese canal sigue siendo el WhatsApp de ellos. Lo que sí hace es dejar
          registrado cuándo se pidió, cuándo se avisó y cuándo vinieron.
        </p>
      </header>

      {aviso === 'avisados' && (
        <div className="aviso exito" role="status">
          Quedaron marcados como avisados{' '}
          <span className="fuerte">
            {detalle} {Number(detalle) === 1 ? 'pedido' : 'pedidos'}
          </span>
          . Desde ahora el reloj corre del lado de la empresa, no del municipio.
        </div>
      )}
      {aviso === 'retirado' && (
        <div className="aviso exito" role="status">
          Retiro confirmado{detalle && <> · <span className="fuerte">{detalle}</span></>}. El pedido
          salió de la cola y su espera ya cuenta en el tiempo de respuesta del punto.
        </div>
      )}
      {aviso === 'cancelado' && (
        <div className="aviso exito" role="status">
          El pedido quedó cancelado: <span className="fuerte">{detalle}</span>. No cuenta en el
          tiempo de respuesta, y el motivo queda guardado.
        </div>
      )}
      {aviso === 'error' && (
        <div className="aviso error" role="alert">
          {detalle || 'No se pudo completar la acción. Probá de nuevo.'}
        </div>
      )}

      {/* ── Tiempo de respuesta ──────────────────────────────────────── */}

      <section className={estilos.seccion}>
        <header className="pila-chica">
          <div className="fila-entre">
            <h2>Tiempo de respuesta por punto</h2>
            <span className="menor gris">
              {numero(abiertos.length)} {abiertos.length === 1 ? 'pedido abierto' : 'pedidos abiertos'}
              {demorados > 0 && (
                <> · <span className="fuerte">{numero(demorados)} demorados</span></>
              )}
            </span>
          </div>
          <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
            Las dos esperas van separadas y no se suman: que el municipio tarde en avisar y que la
            empresa tarde en venir son dos problemas distintos y se arreglan de maneras distintas.
          </p>
        </header>

        {respuesta.length === 0 ? (
          <div className="tarjeta pila-chica centrado" style={{ padding: 32 }}>
            <h3>Todavía no se pidió ningún recambio</h3>
            <p className="menor gris" style={{ margin: 0 }}>
              El indicador aparece solo, con el primer pedido que entre desde un punto.
            </p>
          </div>
        ) : (
          <>
            {cerrados === 0 && (
              <div className="aviso atencion">
                Todavía no hay ningún retiro confirmado, así que no hay promedio de la empresa que
                mostrar: un número inventado sobre cero retiros no sirve para reclamar nada. En
                cuanto se cierren unos cuantos pedidos —con su remito— la columna empieza a decir
                algo.
              </div>
            )}

            <div className="desplazable">
              <table className="datos">
                <caption className="sr-solo">
                  Tiempo de respuesta de cada punto, con el tramo del municipio y el de la empresa
                  medidos por separado.
                </caption>
                <thead>
                  <tr>
                    <th>Punto</th>
                    <th style={{ textAlign: 'right' }}>Abiertos</th>
                    <th style={{ textAlign: 'right' }}>Demorados</th>
                    <th className={estilos.tramo} style={{ textAlign: 'right' }}>
                      El municipio tarda en avisar
                    </th>
                    <th className={estilos.tramo} style={{ textAlign: 'right' }}>
                      La empresa tarda en venir
                    </th>
                    <th style={{ textAlign: 'right' }}>Retiros cerrados</th>
                    <th>Pedido abierto más viejo</th>
                  </tr>
                </thead>
                <tbody>
                  {respuesta.map((r) => {
                    const retirados = Number(r.retirados || 0)
                    const enEspera = Number(r.abiertos || 0)
                    const atrasados = Number(r.demorados || 0)

                    return (
                      <tr key={r.sitio_id}>
                        <th scope="row" style={{ fontWeight: 400 }}>
                          <span className="fila" style={{ gap: 8 }}>
                            <span className={`mono ${estilos.codigo}`}>{r.sitio_codigo}</span>
                            <span className="fuerte">{r.sitio_nombre}</span>
                          </span>
                        </th>
                        <td className="numero">{numero(enEspera)}</td>
                        <td className={`numero ${atrasados > 0 ? 'fuerte' : 'gris'}`}>
                          {numero(atrasados)}
                        </td>
                        <td className={`numero ${estilos.tramo}`}>
                          {espera(r.promedio_hasta_aviso)}
                        </td>
                        <td className={`numero ${estilos.tramo}`}>
                          {retirados > 0 ? (
                            espera(r.promedio_hasta_retiro)
                          ) : (
                            <span className="gris">sin retiros cerrados</span>
                          )}
                        </td>
                        <td className="numero">{numero(retirados)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {r.pedido_mas_viejo ? (
                            <>
                              {fecha(r.pedido_mas_viejo)}{' '}
                              <span className="gris menor">
                                {hace(horasDesde(r.pedido_mas_viejo))}
                              </span>
                            </>
                          ) : (
                            <span className="gris">sin pedidos abiertos</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
              «El municipio tarda en avisar» cuenta también los pedidos que siguen sin avisar, con
              el reloj corriendo: por eso sube solo mientras algo queda pendiente. «La empresa tarda
              en venir» solo cuenta los retiros ya confirmados, del aviso al retiro. Los pedidos
              cancelados no entran en ninguna de las dos.
            </p>
          </>
        )}
      </section>

      {/* ── Sin avisar ───────────────────────────────────────────────── */}

      <section className={estilos.seccion}>
        <header className="pila-chica">
          <div className="fila-entre">
            <h2>Sin avisar a la empresa</h2>
            <span className="menor gris">
              {numero(sinAvisar.length)} {sinAvisar.length === 1 ? 'pedido' : 'pedidos'}
            </span>
          </div>
          <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
            Esto le toca a la coordinación: juntar lo del día y pasarlo al grupo de choferes. Copiá
            el texto, mandalo por WhatsApp y volvé a marcarlos acá; recién ahí el reloj pasa a
            correr del lado de la empresa.
          </p>
        </header>

        {sinAvisar.length === 0 ? (
          <div className="tarjeta pila-chica centrado" style={{ padding: 32 }}>
            <h3>No hay nada para pasarle a la empresa</h3>
            <p className="menor gris" style={{ margin: 0 }}>
              Todo lo que se pidió ya está avisado. Lo que entre nuevo desde un punto va a aparecer
              acá.
            </p>
          </div>
        ) : (
          <>
            <form id={FORMULARIO_LOTE} action={avisar} className={estilos.lote}>
              <CopiarParaWhatsApp
                titulo={`Recambios pedidos — ${fecha(new Date())}`}
                lineas={lineas}
              />
              <button type="submit" className="boton">
                Marcar como avisados
              </button>
              <span className={`menor gris ${estilos.ayudaLote}`}>
                Vienen todos tildados: destildá los que no hayas pasado. Se marca lo mismo que se
                copia, así lo que dice la pantalla es lo que se mandó.
              </span>
            </form>

            <ul className="lista">
              {sinAvisar.map((p) => (
                <li key={p.id} className={p.demorado ? estilos.demorado : undefined}>
                  <div className={estilos.pedido}>
                    <label className={estilos.elegir}>
                      <input
                        type="checkbox"
                        name="id"
                        value={p.id}
                        form={FORMULARIO_LOTE}
                        defaultChecked
                      />
                      <span className="sr-solo">
                        Pasarle a la empresa el recambio de {corriente(p)} de {p.sitio_nombre}
                      </span>
                    </label>
                    <div className="crecer pila-chica">{ficha(p)}</div>
                    {acciones(p)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ── Avisados ─────────────────────────────────────────────────── */}

      <section className={estilos.seccion}>
        <header className="pila-chica">
          <div className="fila-entre">
            <h2>Avisados, esperando a la 9 de Julio</h2>
            <span className="menor gris">
              {numero(avisados.length)} {avisados.length === 1 ? 'pedido' : 'pedidos'}
            </span>
          </div>
          <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
            Ya están del lado de la empresa y lo que se mide acá es cuánto tardan. Se cierran cuando
            alguien ve el camión o cuando llega el Excel de fin de mes.
          </p>
        </header>

        {avisados.length === 0 ? (
          <div className="tarjeta pila-chica centrado" style={{ padding: 32 }}>
            <h3>No hay nada esperando a la empresa</h3>
            <p className="menor gris" style={{ margin: 0 }}>
              Los pedidos aparecen acá una vez que los marcás como avisados.
            </p>
          </div>
        ) : (
          <ul className="lista">
            {avisados.map((p) => (
              <li key={p.id} className={p.demorado ? estilos.demorado : undefined}>
                <div className={estilos.pedido}>
                  <div className="crecer pila-chica">{ficha(p)}</div>
                  {acciones(p)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
