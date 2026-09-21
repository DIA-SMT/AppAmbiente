import Link from 'next/link'
import { notFound } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import { movimientoPorId, trazaDeSalida } from '@/lib/datos'
import { exigirPanel } from '@/lib/sesion'
import {
  ETIQUETA_ENTIDAD, ETIQUETA_FLUJO, ETIQUETA_TIPO, ETIQUETA_VALORIZACION,
  cantidad, fechaHora, numero,
} from '@/lib/formato'
import type { ItemListado } from '@/lib/tipos'
import AnularMovimiento from './AnularMovimiento'
import Trazabilidad from './Trazabilidad'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Una ficha se lee mejor angosta que estirada a lo ancho del panel.
const ANCHO = { maxWidth: 880, margin: '0 auto', width: '100%' } as const

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <dt className="etiqueta">{rotulo}</dt>
      <dd style={{ margin: 0, color: 'var(--tinta)', fontWeight: 600 }}>{children}</dd>
    </div>
  )
}

/** La unidad no viaja con sus decimales, así que se deducen del propio valor. */
function conUnidad(item: ItemListado): string {
  const n = Number(item.cantidad)
  return cantidad(n, {
    nombre: item.unidad_nombre,
    nombre_plural: item.unidad_plural,
    decimales: Number.isInteger(n) ? 0 : 2,
  })
}

export default async function PantallaMovimiento({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()

  const sesion = await exigirPanel()

  const datos = await movimientoPorId(sesion, id)
  if (!datos) notFound()

  const { movimiento: m, items } = datos
  const anulado = m.estado === 'anulado'

  // v_movimientos trae el motivo y la fecha de la anulación, pero no el nombre
  // de quien la hizo. Se pide aparte y solo cuando hace falta.
  const [anulador] = anulado
    ? await consultarConSesion<{ nombre: string | null }>(
        sesion,
        `select p.nombre
           from movimientos mv
           left join perfiles p on p.id = mv.anulado_por_id
          where mv.id = $1`,
        [id],
      )
    : []

  // La vista de trazabilidad solo mira salidas vigentes: en una anulada no hay
  // nada que contar, y el aviso de arriba ya explica por qué.
  const esSalidaVigente = m.tipo === 'salida' && !anulado
  const traza = esSalidaVigente ? await trazaDeSalida(sesion, id) : null

  const claseTipo = m.tipo === 'ingreso' || m.tipo === 'salida' ? ` ${m.tipo}` : ''

  return (
    <div className="contenido pila" style={ANCHO}>
      <div>
        <Link className="boton fantasma" href="/movimientos" style={{ paddingLeft: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18 9 12l6-6" />
          </svg>
          Volver al listado
        </Link>
      </div>

      <header className="pila-chica">
        <div className="fila" style={{ gap: 10 }}>
          <h1 className="mono">Nº {m.numero}</h1>
          <span className={`chip${claseTipo}`}>{ETIQUETA_TIPO[m.tipo] ?? m.tipo}</span>
          {anulado && <span className="chip anulado">Anulado</span>}
          {m.carga_diferida && <span className="chip diferida">Carga diferida</span>}
        </div>
        <p className="gris" style={{ margin: 0 }}>
          Ocurrió el {fechaHora(m.ocurrido_en)} en {m.sitio_nombre}
        </p>
      </header>

      {anulado && (
        <div className="aviso error">
          <span className="fuerte">Este movimiento está anulado.</span>{' '}
          Sigue registrado para consulta, pero no suma en los totales ni en la exportación.
        </div>
      )}

      <section className="tarjeta">
        <dl
          style={{
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
            gap: 16,
          }}
        >
          <Dato rotulo="Flujo">{ETIQUETA_FLUJO[m.flujo] ?? m.flujo}</Dato>
          <Dato rotulo="Punto">
            {m.sitio_nombre} <span className="gris mono menor">{m.sitio_codigo}</span>
          </Dato>

          <Dato rotulo="Origen">
            {m.origen_nombre ?? '—'}
            {m.origen_clase === 'vecino' && m.vecino_sin_datos && (
              <span className="chip pendiente" style={{ marginLeft: 8 }}>Sin datos</span>
            )}
          </Dato>
          <Dato rotulo="Destino">
            {m.destino_nombre ?? '—'}
            {m.destino_entidad_tipo && (
              <span className="gris menor"> · {ETIQUETA_ENTIDAD[m.destino_entidad_tipo] ?? m.destino_entidad_tipo}</span>
            )}
            {m.destino_clase === 'vecino' && m.vecino_sin_datos && (
              <span className="chip pendiente" style={{ marginLeft: 8 }}>Sin datos</span>
            )}
          </Dato>

          <Dato rotulo="Vehículo">
            {m.patente ? (
              <>
                <span className="mono">{m.patente}</span>
                {m.vehiculo_tipo && <span className="gris menor"> · {m.vehiculo_tipo}</span>}
              </>
            ) : '—'}
          </Dato>
          <Dato rotulo="Chofer">{m.chofer_nombre ?? '—'}</Dato>

          <Dato rotulo="Autoriza">{m.autorizante_nombre ?? '—'}</Dato>
          {m.tipo_valorizacion && (
            <Dato rotulo="Tipo de valorización">
              {ETIQUETA_VALORIZACION[m.tipo_valorizacion] ?? m.tipo_valorizacion}
            </Dato>
          )}

          <div style={{ gridColumn: '1 / -1' }}>
            <Dato rotulo="Observaciones">
              {m.observaciones
                ? <span style={{ fontWeight: 400 }}>{m.observaciones}</span>
                : <span className="gris">Sin observaciones</span>}
            </Dato>
          </div>
        </dl>
      </section>

      <section className="pila-chica">
        <h2>Materiales</h2>
        <div className="desplazable">
          <table className="datos">
            <thead>
              <tr>
                <th>Material</th>
                <th>Categoría</th>
                <th style={{ textAlign: 'right' }}>Cantidad</th>
                <th style={{ textAlign: 'right' }}>Equivale a</th>
                <th>Observación</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.item_id}>
                  <td>
                    <span className="fila" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <span className="punto" style={{ background: i.material_color }} aria-hidden="true" />
                      <span className="fuerte">{i.material_nombre}</span>
                    </span>
                  </td>
                  <td className="gris">{i.material_categoria}</td>
                  <td className="numero fuerte">{conUnidad(i)}</td>
                  <td className="numero gris">
                    {i.factor_m3 ? `${numero(i.equivalente_m3, 2)} m³` : '—'}
                  </td>
                  <td className="gris">{i.observacion ?? '—'}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} className="gris centrado">Sin materiales cargados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {esSalidaVigente && <Trazabilidad traza={traza} />}

      <section className="tarjeta-plana pila-chica" style={{ padding: 16, background: 'var(--panel-2)' }}>
        <h2>Trazabilidad</h2>
        <ul className="lista">
          <li>
            <span className="etiqueta">Lo cargó</span>
            <div className="fuerte">{m.cargado_por_nombre ?? '—'}</div>
            <div className="menor gris">{fechaHora(m.creado_en)}</div>
          </li>
          <li>
            <span className="etiqueta">Vigilador de turno</span>
            <div className="fuerte">
              {m.vigilador_nombre ?? <span className="gris">No se registró quién estaba de turno</span>}
            </div>
          </li>
          <li>
            <span className="etiqueta">Momento de la carga</span>
            <div className="fuerte">
              {m.carga_diferida ? 'Carga diferida' : 'Cargado en el momento'}
            </div>
            <div className="menor gris">
              Ocurrió el {fechaHora(m.ocurrido_en)} y se registró el {fechaHora(m.creado_en)}.
            </div>
          </li>
          {anulado && (
            <li>
              <span className="etiqueta">Anulación</span>
              <div className="fuerte">
                {anulador?.nombre ?? 'Sin registro de quién'}
                <span className="gris" style={{ fontWeight: 400 }}> · {fechaHora(m.anulado_en)}</span>
              </div>
              <div className="menor">Motivo: {m.motivo_anulacion ?? '—'}</div>
            </li>
          )}
        </ul>
      </section>

      {!anulado && <AnularMovimiento id={m.id} numero={m.numero} />}
    </div>
  )
}
