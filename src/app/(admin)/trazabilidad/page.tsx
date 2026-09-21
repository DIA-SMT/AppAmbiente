import Link from 'next/link'
import { buscarMovimientos, trazabilidadDeSalidas } from '@/lib/datos'
import { ZONA, fecha, fechaHora, numero } from '@/lib/formato'
import { exigirPanel } from '@/lib/sesion'
import estilos from './trazabilidad.module.css'

export const dynamic = 'force-dynamic'

/**
 * De dónde salió cada camión de compost.
 *
 * El listado sirve tanto como se cargue la pila al registrar la salida, así que
 * arriba de la tabla va cuántas salidas del período la declaran y cuántas no.
 * Sin ese número, una tabla corta se lee como "salió poco compost" cuando lo
 * que pasó es que nadie cargó de dónde salió.
 */

/** Tope de filas que se leen. Más que esto no se mira en pantalla: se exporta. */
const LIMITE = 500

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const DIA = 86_400_000

type Parametros = Record<string, string | string[] | undefined>

function uno(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()
}

const fISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
})

/** Día de Tucumán en aaaa-mm-dd, que es lo que come <input type="date">. */
const hoyEnTucuman = (desplazamientoEnDias = 0) =>
  fISO.format(new Date(Date.now() + desplazamientoEnDias * DIA))

/** dd/mm/aaaa de un día suelto, leído al mediodía para que ninguna zona lo corra. */
const enDia = (clave: string) => fecha(`${clave}T12:00:00-03:00`)

/** Los mismos cuatro atajos que el filtro de Movimientos. */
function atajos(): Array<{ rotulo: string; desde: string; hasta: string }> {
  const hoy = hoyEnTucuman()
  const [anio, mes] = hoy.split('-').map(Number)
  const anteriorAnio = mes === 1 ? anio - 1 : anio
  const anteriorMes = mes === 1 ? 12 : mes - 1
  // Día 0 del mes actual es el último día del mes anterior.
  const ultimoDelPasado = new Date(Date.UTC(anio, mes - 1, 0)).toISOString().slice(0, 10)

  return [
    { rotulo: 'Hoy', desde: hoy, hasta: hoy },
    { rotulo: 'Últimos 7 días', desde: hoyEnTucuman(-6), hasta: hoy },
    { rotulo: 'Este mes', desde: `${hoy.slice(0, 7)}-01`, hasta: hoy },
    {
      rotulo: 'Mes pasado',
      desde: `${anteriorAnio}-${String(anteriorMes).padStart(2, '0')}-01`,
      hasta: ultimoDelPasado,
    },
  ]
}

/**
 * El corte de arriba del rango, igual que lo hace el SQL del listado de
 * movimientos: `ocurrido_en < hasta + 1 día`, con el día leído en UTC como lo
 * castea Postgres. La vista de trazabilidad no filtra por `hasta`, y si acá se
 * usara otro criterio las salidas con pila podrían dar más que el total.
 */
function antesDelCorte(ocurrido: string | Date, hasta: string): boolean {
  const [a, m, d] = hasta.split('-').map(Number)
  return new Date(ocurrido).getTime() < Date.UTC(a, m - 1, d) + DIA
}

const limpiar = (crudo: string | null) =>
  (crudo ?? '').split('·').map((p) => p.trim()).filter(Boolean)

export default async function PantallaTrazabilidad({
  searchParams,
}: {
  searchParams: Promise<Parametros>
}) {
  const sesion = await exigirPanel()

  const parametros = await searchParams
  // Una fecha mal escrita rompe el casteo en Postgres: lo que no tiene forma
  // válida se ignora, como en Movimientos.
  const pedidoDesde = uno(parametros.desde)
  const pedidoHasta = uno(parametros.hasta)
  const desde = FECHA.test(pedidoDesde) ? pedidoDesde : ''
  const hasta = FECHA.test(pedidoHasta) ? pedidoHasta : ''

  const [leidas, { total }] = await Promise.all([
    trazabilidadDeSalidas(sesion, { desde: desde || undefined, limite: LIMITE }),
    buscarMovimientos(sesion, {
      flujo: 'planta',
      tipo: 'salida',
      desde: desde || undefined,
      hasta: hasta || undefined,
      porPagina: 1,
    }),
  ])

  const filas = hasta ? leidas.filter((f) => antesDelCorte(f.ocurrido_en, hasta)) : leidas

  const conPila = filas.length
  // El total sale de las salidas de la Planta; la vista, de cualquier salida con
  // pila. Si por algo no cierran, el faltante se muestra en cero y no en rojo.
  const sinPila = Math.max(total - conPila, 0)
  const porcentaje = total > 0 ? Math.min(Math.round((conPila / total) * 100), 100) : null
  const mayoriaSinPila = total > 0 && sinPila > conPila
  const seCortoElListado = leidas.length >= LIMITE

  const periodo = desde && hasta
    ? `Del ${enDia(desde)} al ${enDia(hasta)}`
    : desde
      ? `Desde el ${enDia(desde)}`
      : hasta
        ? `Hasta el ${enDia(hasta)}`
        : 'Todo el período registrado'

  const rangos = atajos()

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Trazabilidad</h1>
        <p className="menor gris">
          De dónde salió cada camión de compost: la pila que lo formó, cuánto material entró en esa
          pila y de dónde vino. Cada fila abre el movimiento con el que salió.
        </p>
      </header>

      <section className="tarjeta pila" aria-label="Período del listado">
        <form method="get" className={estilos.periodo}>
          <div className="campo">
            <label htmlFor="desde">Desde</label>
            <input
              id="desde"
              name="desde"
              type="date"
              className="control"
              defaultValue={desde}
              max={hasta || undefined}
            />
          </div>
          <div className="campo">
            <label htmlFor="hasta">Hasta</label>
            <input
              id="hasta"
              name="hasta"
              type="date"
              className="control"
              defaultValue={hasta}
              min={desde || undefined}
            />
          </div>
          <button type="submit" className="boton">Filtrar</button>
        </form>

        <div className={`sugerencias ${estilos.atajos}`}>
          {rangos.map((r) => {
            const puesto = desde === r.desde && hasta === r.hasta
            return (
              <Link
                key={r.rotulo}
                href={`/trazabilidad?desde=${r.desde}&hasta=${r.hasta}`}
                aria-current={puesto ? 'true' : undefined}
              >
                {r.rotulo}
              </Link>
            )
          })}
          {(desde || hasta) && <Link href="/trazabilidad">Todo el período</Link>}
        </div>
      </section>

      <section className="pila-chica">
        <div className={estilos.indicadores}>
          <div className="tarjeta pila-chica">
            <span className="etiqueta">Salidas con pila declarada</span>
            <strong className={estilos.cifra}>{numero(conPila)}</strong>
            <span className="menor gris">{periodo.toLowerCase()}</span>
          </div>
          <div className={`tarjeta pila-chica ${sinPila > 0 ? estilos.atencion : ''}`}>
            <span className="etiqueta">Salidas sin pila declarada</span>
            <strong className={estilos.cifra}>{numero(sinPila)}</strong>
            <span className="menor gris">
              {total > 0
                ? `de ${numero(total)} salidas de la Planta en el período · ${numero(porcentaje ?? 0)}% tiene la pila cargada`
                : 'no hubo salidas de la Planta en el período'}
            </span>
          </div>
        </div>

        {mayoriaSinPila && (
          <div className="aviso atencion">
            <p style={{ margin: 0 }}>
              <span className="fuerte">
                La mayoría de las salidas del período no dice de qué pila salió.
              </span>{' '}
              Hasta que se cargue parejo, esta tabla muestra una parte y no sirve para sacar
              conclusiones: un destino puede aparecer poco solo porque a esas salidas no les
              cargaron la pila. Se elige al registrar la salida, en el celular.
            </p>
          </div>
        )}

        {seCortoElListado && (
          <p className="menor gris" style={{ margin: 0 }}>
            Se leyeron las últimas {numero(LIMITE)} salidas con pila. Si el período es largo puede
            faltar lo más viejo: achicalo para verlo completo.
          </p>
        )}
      </section>

      {filas.length === 0 ? (
        <div className="tarjeta centrado pila" style={{ padding: 36 }}>
          <p className="fuerte" style={{ margin: 0 }}>
            Ninguna salida del período dice de qué pila salió.
          </p>
          <p className="menor gris" style={{ margin: 0 }}>
            {total > 0
              ? `Hubo ${numero(total)} ${total === 1 ? 'salida' : 'salidas'} de la Planta en el período, pero ninguna declara la pila. Se elige al registrar la salida, en el celular.`
              : 'No hubo salidas de la Planta en el período. Probá con un rango más ancho.'}
          </p>
          <div className="fila" style={{ justifyContent: 'center' }}>
            <Link className="boton secundario" href="/movimientos?flujo=planta&tipo=salida">
              Ver las salidas de la Planta
            </Link>
          </div>
        </div>
      ) : (
        <div className="desplazable">
          <table className="datos">
            <caption className="sr-solo">
              Salidas de compost que declaran la pila de la que salieron. Cada fila abre el
              movimiento.
            </caption>
            <thead>
              <tr>
                <th style={{ textAlign: 'right' }}>Nº</th>
                <th>Fecha y hora</th>
                <th>Destino</th>
                <th>Patente</th>
                <th>Chofer</th>
                <th>Pila</th>
                <th style={{ textAlign: 'right' }}>Volteos</th>
                <th style={{ textAlign: 'right' }}>m³ que la formaron</th>
                <th>Procedencias</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const m3 = Number(f.m3_que_la_formaron)
                const volteos = Number(f.volteos) || 0
                const procedencias = limpiar(f.procedencias)

                return (
                  <tr key={f.movimiento_id}>
                    <td className="mono numero">
                      <Link href={`/movimientos/${f.movimiento_id}`} style={{ fontWeight: 800 }}>
                        {f.numero}
                        <span className="sr-solo"> — ver el movimiento</span>
                      </Link>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fechaHora(f.ocurrido_en)}</td>
                    <td>{f.destino}</td>
                    <td className="mono">{f.patente ?? '—'}</td>
                    <td>{f.chofer ?? '—'}</td>
                    <td className="mono">
                      <Link href={`/pilas/${f.pila_id}`} style={{ fontWeight: 800 }}>
                        {f.pila}
                      </Link>
                    </td>
                    <td className="numero">
                      {volteos > 0 ? numero(volteos) : <span className="gris">0</span>}
                    </td>
                    <td className="numero">
                      {Number.isFinite(m3) && m3 > 0
                        ? numero(m3, Number.isInteger(m3) ? 0 : 1)
                        : <span className="gris">—</span>}
                    </td>
                    <td className={estilos.procedencias}>
                      {procedencias.length > 0
                        ? procedencias.join(' · ')
                        : <span className="gris">Sin identificar</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {filas.length > 0 && (
        <p className="menor gris" style={{ margin: 0 }}>
          Los volteos y los m³ son de la pila entera, no de este camión: dos salidas de la misma
          pila repiten esos números. El material y la cantidad que se llevó cada camión están en el
          movimiento.
        </p>
      )}
    </div>
  )
}
