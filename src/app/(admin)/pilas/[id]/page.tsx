import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import { pilaPorId } from '@/lib/datos'
import {
  ETIQUETA_VALORIZACION, cantidadDeMovimiento, fecha, fechaDeCalendario, fechaHora, haceCuanto, numero,
  paraInputFechaHora,
} from '@/lib/formato'
import { UUID } from '@/lib/recursos'
import { exigirAdmin } from '@/lib/sesion'
import type { EstadoPila, TipoControl } from '@/lib/tipos'
import { cambiarEstado, cerrarPila } from '../acciones'
import estilos from '../pilas.module.css'

export const dynamic = 'force-dynamic'

const MS_DIA = 86_400_000

/** A partir de acá la diferencia entre el volumen nominal y lo que entró se cuenta. */
const DIFERENCIA_QUE_IMPORTA = 0.2

const ETIQUETA_ESTADO: Record<EstadoPila, string> = {
  en_formacion: 'En formación',
  madurando: 'Madurando',
  lista: 'Lista',
  despachada: 'Despachada',
}

const CHIP_ESTADO: Record<EstadoPila, string> = {
  en_formacion: 'chip diferida',
  madurando: 'chip',
  lista: 'chip ingreso',
  despachada: 'chip pendiente',
}

const ETIQUETA_CONTROL: Record<TipoControl, string> = {
  volteo: 'Volteo',
  riego: 'Riego',
  temperatura: 'Temperatura',
  humedad: 'Humedad',
  observacion: 'Observación',
}

/** El paso siguiente del ciclo, que es el que se toca todos los días. */
const SIGUIENTE: Partial<Record<EstadoPila, { estado: EstadoPila; rotulo: string }>> = {
  madurando: { estado: 'lista', rotulo: 'Marcar como lista para despachar' },
  lista: { estado: 'despachada', rotulo: 'Marcar como despachada' },
}

type Parametros = { [clave: string]: string | string[] | undefined }

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? ''
}


function enMs(v: string | Date | null | undefined): number | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/** 100 se lee mejor que 100,00, pero 1,5 no se puede redondear a 2. */
function medida(v: string | number | null): string {
  const n = Number(v)
  return numero(n, Number.isInteger(n) ? 0 : 2)
}

function diasDesde(v: string | Date | null | undefined): number | null {
  const ms = enMs(v)
  return ms === null ? null : Math.max(0, Math.floor((Date.now() - ms) / MS_DIA))
}

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="etiqueta">{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export default async function FichaDePila({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Parametros>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()

  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const datos = await pilaPorId(sesion, id)
  if (!datos) notFound()

  const { pila, composicion, controles, salidas } = datos
  const sp = await searchParams
  const aviso = texto(sp.aviso)
  const detalle = texto(sp.detalle)

  // v_trazabilidad_salidas contesta de dónde salió cada camión, pero no cuánto
  // llevaba: la cantidad de cada salida se pide al listado de movimientos.
  interface FilaCantidad {
    id: string
    items: number | string
    cantidad_total: number | string | null
    unidad_nombre: string | null
    unidad_plural: string | null
    unidad_decimales: number | null
  }
  const cantidades = salidas.length
    ? await consultarConSesion<FilaCantidad>(
        sesion,
        `select id, items, cantidad_total, unidad_nombre, unidad_plural, unidad_decimales
           from v_movimientos where id = any($1::uuid[])`,
        [salidas.map((s) => s.movimiento_id)],
      )
    : []
  const cantidadPorMovimiento = new Map(cantidades.map((c) => [c.id, c]))

  const volteos = Number(pila.volteos)
  const riegos = Number(pila.riegos)
  const nominal = Number(pila.volumen_nominal_m3 ?? 0)
  const entraron = Number(pila.m3_ingresados ?? 0)
  const diferencia = nominal > 0 ? (entraron - nominal) / nominal : 0
  const hayDiferencia = nominal > 0 && entraron > 0 && Math.abs(diferencia) >= DIFERENCIA_QUE_IMPORTA
  const sinIngresos = entraron === 0
  const sinVoltear = diasDesde(pila.ultimo_volteo ?? pila.fecha_cierre)
  const siguiente = SIGUIENTE[pila.estado]
  const hoy = paraInputFechaHora().slice(0, 10)
  const m3Compuestos = composicion.reduce((total, c) => total + Number(c.m3 ?? 0), 0)

  return (
    <div className="pila">
      <div>
        <Link className="boton fantasma" href="/pilas" style={{ paddingLeft: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18 9 12l6-6" />
          </svg>
          Volver a las pilas
        </Link>
      </div>

      {aviso === 'cerrada' && (
        <div className="aviso exito" role="status">
          La pila <span className="fuerte">{detalle}</span> quedó cerrada y empezó a madurar. Desde
          la fecha de cierre se cuentan los meses.
        </div>
      )}
      {aviso === 'estado' && (
        <div className="aviso exito" role="status">
          Listo: la pila <span className="fuerte">{detalle}</span> cambió de estado.
        </div>
      )}
      {aviso === 'error' && (
        <div className="aviso error" role="alert">
          {detalle || 'No se pudo completar la acción. Probá de nuevo.'}
        </div>
      )}

      {/* ── 1. Encabezado ─────────────────────────────────────────────── */}

      <header className="pila-chica">
        <div className="fila" style={{ gap: 10 }}>
          <h1 className="mono">{pila.codigo}</h1>
          <span className={CHIP_ESTADO[pila.estado]}>{ETIQUETA_ESTADO[pila.estado]}</span>
          {pila.volteo_atrasado && <span className="chip salida">Volteo atrasado</span>}
          {!pila.activo && <span className="chip anulado">Dada de baja</span>}
        </div>
        <p className="gris" style={{ margin: 0 }}>
          {pila.sitio_nombre}
          {pila.dias_desde_armado !== null && (
            <> · armada hace {numero(Number(pila.dias_desde_armado))} días</>
          )}
        </p>
      </header>

      <section className="tarjeta pila">
        <dl className={estilos.datos}>
          <Dato rotulo="Fecha de armado">{fechaDeCalendario(pila.fecha_armado)}</Dato>
          <Dato rotulo="Fecha de cierre">
            {pila.fecha_cierre
              ? fechaDeCalendario(pila.fecha_cierre)
              : <span className="gris">Todavía recibe material</span>}
          </Dato>
          <Dato rotulo="Madurez">
            {pila.madurez ? fechaDeCalendario(pila.madurez) : <span className="gris">Se cuenta desde el cierre</span>}
            {pila.dias_para_madurez !== null && (
              <span className="gris menor" style={{ fontWeight: 400 }}>
                {Number(pila.dias_para_madurez) > 0
                  ? ` · faltan ${numero(Number(pila.dias_para_madurez))} días`
                  : Number(pila.dias_para_madurez) === 0
                    ? ' · es hoy'
                    : ` · pasó hace ${numero(-Number(pila.dias_para_madurez))} días`}
              </span>
            )}
          </Dato>
          <Dato rotulo="Responsable">
            {pila.responsable ?? <span className="gris">Sin asignar</span>}
          </Dato>
          <Dato rotulo="Dimensiones">
            {medida(pila.largo_m)} × {medida(pila.ancho_m)} × {medida(pila.alto_m)} m
            <span className="gris menor" style={{ fontWeight: 400 }}>
              {' '}· {numero(pila.volumen_nominal_m3, 1)} m³ nominales
            </span>
          </Dato>
          <Dato rotulo="Entró y salió">
            Entraron {numero(pila.m3_ingresados, 1)} m³ · salieron {numero(pila.m3_despachados, 1)} m³
          </Dato>
        </dl>

        {pila.notas && <p className="menor" style={{ margin: 0 }}>{pila.notas}</p>}

        {sinIngresos ? (
          <p className="aviso" style={{ margin: 0 }}>
            Todavía no hay ningún ingreso cargado con esta pila, así que de qué está hecha no se
            puede reconstruir. Se vincula eligiendo la pila al cargar el ingreso de poda.
          </p>
        ) : hayDiferencia && (
          <p className="aviso" style={{ margin: 0 }}>
            La cancha mide {numero(pila.volumen_nominal_m3, 1)} m³ y los ingresos cargados suman{' '}
            <span className="fuerte">{numero(entraron, 1)} m³</span>, un{' '}
            {numero(Math.abs(Math.round(diferencia * 100)))}%{' '}
            {diferencia < 0 ? 'menos' : 'más'}. El nominal es la medida del espacio, no lo que se
            acopió: la diferencia puede ser material que entró sin registrarse, o una pila que
            todavía no se llenó.
          </p>
        )}

        <div className={estilos.acciones}>
          <Link href={`/pilas?editar=${pila.id}#formulario`} className="boton secundario">
            Editar la pila
          </Link>

          {pila.estado === 'en_formacion' && (
            <form action={cerrarPila.bind(null, pila.id)}>
              <div className="campo">
                <label htmlFor="fecha_cierre">Fecha de cierre</label>
                <input
                  id="fecha_cierre"
                  name="fecha_cierre"
                  type="date"
                  className="control"
                  defaultValue={hoy}
                  max={hoy}
                />
              </div>
              <button type="submit" className="boton">Cerrar la pila</button>
            </form>
          )}

          {siguiente && (
            <form action={cambiarEstado.bind(null, pila.id)}>
              <input type="hidden" name="estado" value={siguiente.estado} />
              <button type="submit" className="boton">{siguiente.rotulo}</button>
            </form>
          )}
        </div>

        <form action={cambiarEstado.bind(null, pila.id)} className={estilos.correccion}>
          <div className="campo">
            <label htmlFor="estado">Corregir el estado</label>
            <select id="estado" name="estado" className="control" defaultValue={pila.estado}>
              {(Object.keys(ETIQUETA_ESTADO) as EstadoPila[]).map((e) => (
                <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="boton secundario">Cambiar</button>
        </form>
      </section>

      {/* ── 2. De qué está hecha ──────────────────────────────────────── */}

      <section className="pila-chica">
        <h2>De qué está hecha</h2>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          No es una declaración: cada línea sale de un ingreso que se cargó con esta pila, con el
          material y de dónde venía.
        </p>

        {composicion.length === 0 ? (
          <div className="tarjeta centrado pila-chica" style={{ padding: 28 }}>
            <h3>Sin ingresos vinculados</h3>
            <p className="menor gris" style={{ margin: 0 }}>
              Ningún ingreso quedó registrado con esta pila. Los que se carguen de acá en adelante
              van a aparecer en esta tabla.
            </p>
          </div>
        ) : (
          <div className="desplazable">
            <table className="datos">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Procedencia</th>
                  <th>Cuándo entró</th>
                  <th style={{ textAlign: 'right' }}>Movimientos</th>
                  <th style={{ textAlign: 'right' }}>m³</th>
                </tr>
              </thead>
              <tbody>
                {composicion.map((c) => {
                  const desde = fecha(c.primer_ingreso)
                  const hasta = fecha(c.ultimo_ingreso)
                  return (
                    <tr key={`${c.material_id}-${c.origen}`}>
                      <td>
                        <span className="fila" style={{ gap: 8, flexWrap: 'nowrap' }}>
                          <span className="punto" style={{ background: c.material_color }} aria-hidden="true" />
                          <span className="fuerte">{c.material}</span>
                        </span>
                      </td>
                      <td>{c.origen}</td>
                      <td className="gris">{desde === hasta ? desde : `${desde} → ${hasta}`}</td>
                      <td className="numero">{numero(Number(c.movimientos))}</td>
                      <td className="numero fuerte">{numero(c.m3, 1)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="fuerte" colSpan={3}>Total</td>
                  <td className="numero fuerte">
                    {numero(composicion.reduce((t, c) => t + Number(c.movimientos), 0))}
                  </td>
                  <td className="numero fuerte">{numero(m3Compuestos, 1)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {pila.composicion && (
          <div className="tarjeta-plana" style={{ padding: 14, background: 'var(--panel-2)' }}>
            <span className="etiqueta">Lo que se agregó y no pasa por un movimiento</span>
            <p style={{ margin: '4px 0 0' }}>{pila.composicion}</p>
          </div>
        )}
      </section>

      {/* ── 3. Cómo se la trató ───────────────────────────────────────── */}

      <section className="pila-chica">
        <h2>Cómo se la trató</h2>

        {pila.volteo_atrasado && (
          <div className="aviso atencion" role="alert">
            <span className="fuerte">
              {volteos === 0
                ? 'Esta pila nunca se volteó desde que se cerró.'
                : `Hace ${numero(sinVoltear ?? 0)} días que esta pila no se voltea.`}
            </span>{' '}
            Más de tres semanas sin volteo y la pila se compacta, se apaga y termina perdida.
          </div>
        )}

        <div className={`tarjeta-plana ${estilos.marcas}`} style={{ padding: 14 }}>
          <span><b>{numero(volteos)}</b> volteos</span>
          <span><b>{numero(riegos)}</b> riegos</span>
          <span>
            Última temperatura:{' '}
            <b>{pila.ultima_temperatura === null ? 'sin registro' : `${numero(pila.ultima_temperatura, 1)} °C`}</b>
          </span>
          <span>
            Último volteo:{' '}
            <b>{pila.ultimo_volteo ? `${fecha(pila.ultimo_volteo)} · ${haceCuanto(pila.ultimo_volteo)}` : 'sin registro'}</b>
          </span>
        </div>

        {controles.length === 0 ? (
          <div className="tarjeta centrado pila-chica" style={{ padding: 28 }}>
            <h3>Sin controles anotados</h3>
            <p className="menor gris" style={{ margin: 0 }}>
              Los volteos, los riegos y las temperaturas se anotan en la Planta y aparecen acá en
              orden, del más nuevo al más viejo.
            </p>
          </div>
        ) : (
          <ul className="lista">
            {controles.map((c) => (
              <li key={c.id}>
                <div className="fila-entre">
                  <span className="fuerte">
                    {ETIQUETA_CONTROL[c.tipo] ?? c.tipo}
                    {c.valor !== null && (
                      <span className="cifras">
                        {' · '}
                        {c.tipo === 'temperatura' ? `${numero(c.valor, 1)} °C`
                          : c.tipo === 'humedad' ? `${numero(c.valor, 0)} %`
                          : numero(c.valor, 1)}
                      </span>
                    )}
                  </span>
                  <span className="menor gris">
                    {fechaHora(c.ocurrido_en)} · {haceCuanto(c.ocurrido_en)}
                  </span>
                </div>
                {c.observacion && <p className="menor" style={{ margin: '2px 0 0' }}>{c.observacion}</p>}
                <p className="menor gris" style={{ margin: 0 }}>
                  Lo anotó {c.registrado_por ?? 'un usuario que ya no está'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 4. Qué salió de ella ──────────────────────────────────────── */}

      <section className="pila-chica">
        <h2>Qué salió de ella</h2>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          La otra punta de la trazabilidad: cada camión que se llevó material de esta pila, con su
          destino y su patente.
        </p>

        {salidas.length === 0 ? (
          <div className="tarjeta centrado pila-chica" style={{ padding: 28 }}>
            <h3>Todavía no salió nada</h3>
            <p className="menor gris" style={{ margin: 0 }}>
              Cuando se cargue una salida eligiendo esta pila, va a quedar listada acá con su
              destino y su patente.
            </p>
          </div>
        ) : (
          <>
            <div className="desplazable">
              <table className="datos">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Movimiento</th>
                    <th>Destino</th>
                    <th>Patente</th>
                    <th>Chofer</th>
                    <th style={{ textAlign: 'right' }}>Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {salidas.map((s) => {
                    const c = cantidadPorMovimiento.get(s.movimiento_id)
                    return (
                      <tr key={s.movimiento_id}>
                        <td>{fecha(s.ocurrido_en)}</td>
                        <td className="mono">
                          <Link href={`/movimientos/${s.movimiento_id}`}>Nº {s.numero}</Link>
                        </td>
                        <td className="fuerte">
                          {s.destino}
                          {s.tipo_valorizacion && (
                            <span className="gris menor" style={{ fontWeight: 400 }}>
                              {' '}· {ETIQUETA_VALORIZACION[s.tipo_valorizacion] ?? s.tipo_valorizacion}
                            </span>
                          )}
                        </td>
                        <td className="mono">{s.patente ?? '—'}</td>
                        <td className="gris">{s.chofer ?? '—'}</td>
                        <td className="numero fuerte">
                          {c
                            ? cantidadDeMovimiento({
                                items: Number(c.items),
                                cantidad_total: c.cantidad_total,
                                unidad_nombre: c.unidad_nombre,
                                unidad_plural: c.unidad_plural,
                                unidad_decimales: c.unidad_decimales,
                              })
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="menor gris" style={{ margin: 0 }}>
              {numero(salidas.length)} {salidas.length === 1 ? 'salida' : 'salidas'} ·{' '}
              {numero(pila.m3_despachados, 1)} m³ despachados en total.
            </p>
          </>
        )}
      </section>
    </div>
  )
}
