import { Fragment, type CSSProperties } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buscarMovimientos, resumenMensual, sitiosVisibles } from '@/lib/datos'
import { mesCorto, mesLargo, numero, paraInputFechaHora } from '@/lib/formato'
import { consultarConSesion } from '@db/sesion'
import { sesionActual, type Sesion } from '@/lib/sesion'
import type { TipoMovimiento } from '@/lib/tipos'
import GraficoMensual, { type MesGrafico } from './GraficoMensual'
import SubNavegacion from './SubNavegacion'

export const dynamic = 'force-dynamic'

const PERIODOS = [6, 12, 24]

interface Par { ingreso: number; salida: number }

interface FilaMaterial {
  clave: string
  material: string
  unidad: string
  color: string
  volumen: number
  porMes: Map<string, Par>
  total: Par
}

/**
 * El mes llega como date y, según el motor, como texto o como Date. Se reduce a
 * 'aaaa-mm' para usarlo de clave, y se vuelve a armar como mediodía de Tucumán
 * para mostrarlo: así ninguna conversión de zona lo corre al mes anterior.
 */
function claveDeMes(valor: string | Date): string {
  const texto = valor instanceof Date ? valor.toISOString() : String(valor)
  const partes = /(\d{4})-(\d{2})/.exec(texto)
  return partes ? `${partes[1]}-${partes[2]}` : texto.slice(0, 7)
}

const instanteDeMes = (clave: string) => `${clave}-01T12:00:00-03:00`

function restarMeses(clave: string, cantidad: number): string {
  const [anio, mes] = clave.split('-').map(Number)
  const total = anio * 12 + (mes - 1) - cantidad
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`
}

function ultimoDia(clave: string): string {
  const [anio, mes] = clave.split('-').map(Number)
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10)
}

/**
 * Mismo día de corte en el mes anterior. Comparar un mes a la mitad contra un
 * mes entero muestra caídas que no existen: el 14 de septiembre contra todo
 * agosto siempre da negativo, y la coordinadora lee una alarma donde solo
 * faltan días.
 */
function mismoDiaDelMesAnterior(hoy: string, mesPrevio: string): string {
  const dia = Number(hoy.slice(8, 10))
  const ultimo = Number(ultimoDia(mesPrevio).slice(8, 10))
  return `${mesPrevio}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`
}

/** Volumen equivalente en m³ movido entre dos fechas, por tipo. */
async function volumenEnRango(
  sesion: Sesion,
  desde: string,
  hasta: string,
): Promise<{ ingreso: number; salida: number }> {
  const filas = await consultarConSesion<{ tipo: TipoMovimiento; total: string }>(
    sesion,
    `select tipo, coalesce(sum(equivalente_m3), 0)::text as total
       from v_movimiento_items
      where flujo = 'planta' and estado = 'vigente'
        and ocurrido_en >= $1::timestamptz
        and ocurrido_en < ($2::date + interval '1 day')
      group by tipo`,
    [desde, hasta],
  )
  const por = (t: string) => Number(filas.find((f) => f.tipo === t)?.total ?? 0)
  return { ingreso: por('ingreso'), salida: por('salida') }
}

async function contarMovimientos(
  sesion: Sesion,
  tipo: TipoMovimiento,
  desde: string,
  hasta?: string,
): Promise<number> {
  const { total } = await buscarMovimientos(sesion, { flujo: 'planta', tipo, desde, hasta, porPagina: 1 })
  return total
}

export default async function Tablero({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')
  if (sesion.rol !== 'admin') redirect('/turno')

  const parametros = await searchParams
  const pedido = Number(Array.isArray(parametros.meses) ? parametros.meses[0] : parametros.meses)
  const meses = PERIODOS.includes(pedido) ? pedido : 6

  const filas = await resumenMensual(sesion, { flujo: 'planta', meses })
  const sitios = await sitiosVisibles(sesion)
  const planta = sitios.find((s) => s.tipo === 'planta')

  const mesActual = paraInputFechaHora().slice(0, 7)
  const rango: string[] = []
  for (let i = meses - 1; i >= 0; i--) rango.push(restarMeses(mesActual, i))
  const claves = Array.from(new Set([...rango, ...filas.map((f) => claveDeMes(f.mes))])).sort()
  const mesPrevio = restarMeses(mesActual, 1)

  const volumenPorMes = new Map<string, Par>()
  const materiales = new Map<string, FilaMaterial>()

  for (const f of filas) {
    if (f.tipo !== 'ingreso' && f.tipo !== 'salida') continue
    const mes = claveDeMes(f.mes)
    const cantidad = Number(f.cantidad) || 0
    const volumen = Number(f.equivalente_m3) || 0

    const totalMes = volumenPorMes.get(mes) ?? { ingreso: 0, salida: 0 }
    totalMes[f.tipo] += volumen
    volumenPorMes.set(mes, totalMes)

    const clave = `${f.material_id}|${f.unidad_codigo}`
    const fila = materiales.get(clave) ?? {
      clave,
      material: f.material_nombre,
      unidad: f.unidad_codigo,
      color: f.material_color,
      volumen: 0,
      porMes: new Map<string, Par>(),
      total: { ingreso: 0, salida: 0 },
    }
    const celda = fila.porMes.get(mes) ?? { ingreso: 0, salida: 0 }
    celda[f.tipo] += cantidad
    fila.porMes.set(mes, celda)
    fila.total[f.tipo] += cantidad
    fila.volumen += volumen
    materiales.set(clave, fila)
  }

  const porMaterial = [...materiales.values()].sort(
    (a, b) => b.volumen - a.volumen || a.material.localeCompare(b.material, 'es'),
  )

  const periodo = claves.length
    ? `${mesLargo(instanteDeMes(claves[0]))} a ${mesLargo(instanteDeMes(claves[claves.length - 1]))}`
    : mesLargo(instanteDeMes(mesActual))

  const enlaceExcel = `/api/exportar?vista=resumen&flujo=planta&meses=${meses}`

  const encabezado = (
    <>
      <SubNavegacion />
      <header className="fila-entre" style={{ flexWrap: 'wrap', rowGap: 12 }}>
        <div>
          <h1>Planta de Valorización</h1>
          <p className="menor gris" style={{ margin: 0 }}>
            {periodo}
            {planta ? ` · ${planta.nombre}` : ''}
          </p>
        </div>
        <div className="fila">
          <div className="fila" style={{ gap: 6 }} role="group" aria-label="Meses que se muestran">
            {PERIODOS.map((n) => (
              <Link
                key={n}
                href={`/tablero?meses=${n}`}
                className={`boton chico ${n === meses ? '' : 'secundario'}`}
                aria-current={n === meses ? 'page' : undefined}
              >
                {n} meses
              </Link>
            ))}
          </div>
          {filas.length > 0 && (
            <a className="boton chico secundario" href={enlaceExcel}>
              <IconoBajar />
              Exportar a Excel
            </a>
          )}
        </div>
      </header>
    </>
  )

  if (!filas.length) {
    return (
      <div className="pila" style={{ gap: 20 }}>
        {encabezado}
        <div className="tarjeta pila">
          <h2>Todavía no hay movimientos en la Planta</h2>
          <p style={{ margin: 0 }}>
            Acá va a aparecer cuánto material entró y cuánto salió de la Planta cada mes, con el
            detalle por material y el volumen equivalente en m³. Se arma solo con lo que se
            registra desde la calle: no hay que cargar nada dos veces.
          </p>
          {meses < 24 && (
            <p className="menor gris" style={{ margin: 0 }}>
              Estás mirando los últimos {meses} meses. Si esperabas ver algo más viejo, probá con 24.
            </p>
          )}
          <p style={{ margin: 0 }}>
            El primer movimiento lo carga el vigilador desde el celular: entra con el usuario de su
            punto y elige ingreso o salida. Si todavía no tiene usuario, creáselo en{' '}
            <Link href="/usuarios">Usuarios</Link>. Los materiales, los destinos y los vehículos que
            va a ver en las listas se administran en <Link href="/listas">Listas</Link>.
          </p>
          <div className="fila">
            <Link className="boton" href="/usuarios">Crear el usuario de un punto</Link>
            <Link className="boton secundario" href="/listas">Revisar las listas</Link>
          </div>
        </div>
      </div>
    )
  }

  const inicioMes = `${mesActual}-01`
  const hoy = paraInputFechaHora().slice(0, 10)
  const cortePrevio = mismoDiaDelMesAnterior(hoy, mesPrevio)
  // El mes en curso se compara contra los mismos días del anterior, no contra
  // el mes entero. El último día del mes las dos ventanas coinciden solas.
  const mesIncompleto = hoy < ultimoDia(mesActual)

  const ingresosMes = await contarMovimientos(sesion, 'ingreso', inicioMes, hoy)
  const salidasMes = await contarMovimientos(sesion, 'salida', inicioMes, hoy)
  const ingresosPrevio = await contarMovimientos(sesion, 'ingreso', `${mesPrevio}-01`, cortePrevio)
  const salidasPrevio = await contarMovimientos(sesion, 'salida', `${mesPrevio}-01`, cortePrevio)

  const volumenMes = await volumenEnRango(sesion, inicioMes, hoy)
  const volumenPrevio = await volumenEnRango(sesion, `${mesPrevio}-01`, cortePrevio)
  const diaCorte = Number(hoy.slice(8, 10))
  const rotuloPrevio = mesIncompleto
    ? `los primeros ${diaCorte} días de ${mesCorto(instanteDeMes(mesPrevio))}`
    : mesCorto(instanteDeMes(mesPrevio))

  const datosGrafico: MesGrafico[] = claves.map((clave) => ({
    clave,
    rotulo: mesCorto(instanteDeMes(clave)),
    ingreso: volumenPorMes.get(clave)?.ingreso ?? 0,
    salida: volumenPorMes.get(clave)?.salida ?? 0,
  }))

  const fija: CSSProperties = { position: 'sticky', left: 0, zIndex: 2, background: 'var(--panel)', boxShadow: '1px 0 0 var(--linea)' }
  const fijaCabecera: CSSProperties = { ...fija, zIndex: 3, background: 'var(--panel-2)' }
  const separa: CSSProperties = { borderLeft: '1px solid var(--linea)' }
  const derecha: CSSProperties = { textAlign: 'right' }

  return (
    <div className="pila" style={{ gap: 20 }}>
      {encabezado}

      <section className="pila-chica">
        <h2 className="sr-solo">Resumen de {mesLargo(instanteDeMes(mesActual))}</h2>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))' }}>
          <Indicador
            rotulo={`Ingresos de ${mesCorto(instanteDeMes(mesActual))}`}
            valor={numero(ingresosMes)}
            detalle="movimientos registrados"
            actual={ingresosMes}
            anterior={ingresosPrevio}
            mesAnterior={rotuloPrevio}
          />
          <Indicador
            rotulo={`Salidas de ${mesCorto(instanteDeMes(mesActual))}`}
            valor={numero(salidasMes)}
            detalle="movimientos registrados"
            actual={salidasMes}
            anterior={salidasPrevio}
            mesAnterior={rotuloPrevio}
          />
          <Indicador
            rotulo="Volumen que entró"
            valor={`${numero(volumenMes.ingreso, 1)} m³`}
            detalle="equivalente de todos los materiales"
            actual={volumenMes.ingreso}
            anterior={volumenPrevio.ingreso}
            mesAnterior={rotuloPrevio}
          />
          <Indicador
            rotulo="Volumen que salió"
            valor={`${numero(volumenMes.salida, 1)} m³`}
            detalle="equivalente de todos los materiales"
            actual={volumenMes.salida}
            anterior={volumenPrevio.salida}
            mesAnterior={rotuloPrevio}
          />
        </div>
        <p className="menor gris" style={{ margin: 0 }}>
          Los m³ son una equivalencia estimada: cada material convierte su unidad a volumen con un
          factor que se configura en Listas. Sirven para comparar meses, no para facturar.
        </p>
      </section>

      <section className="tarjeta pila">
        <div className="fila-entre">
          <h2>Volumen por mes</h2>
          <span className="menor gris">{meses} meses</span>
        </div>
        <GraficoMensual meses={datosGrafico} />
      </section>

      <section className="pila-chica">
        <h2>Detalle por material</h2>
        <div className="desplazable">
          <table className="datos">
            <caption className="sr-solo">
              Cantidades por material y por mes, separando lo que entró de lo que salió.
            </caption>
            <thead>
              <tr>
                <th rowSpan={2} style={fijaCabecera}>Material</th>
                {claves.map((clave) => (
                  <th key={clave} colSpan={2} className="centrado" style={separa}>
                    {mesCorto(instanteDeMes(clave))}
                  </th>
                ))}
                <th colSpan={2} className="centrado" style={separa}>Total</th>
              </tr>
              <tr>
                {claves.map((clave) => (
                  <Fragment key={clave}>
                    <th style={{ ...separa, ...derecha }}>Entró</th>
                    <th style={derecha}>Salió</th>
                  </Fragment>
                ))}
                <th style={{ ...separa, ...derecha }}>Entró</th>
                <th style={derecha}>Salió</th>
              </tr>
            </thead>
            <tbody>
              {porMaterial.map((fila) => {
                const valores = [
                  ...claves.flatMap((c) => [fila.porMes.get(c)?.ingreso ?? 0, fila.porMes.get(c)?.salida ?? 0]),
                  fila.total.ingreso,
                  fila.total.salida,
                ]
                // Kilos y unidades son enteros; los m³ no. Se decide por fila para
                // que la columna no mezcle formatos.
                const decimales = valores.every((v) => Number.isInteger(v)) ? 0 : 2
                const celda = (v: number) => (v > 0 ? numero(v, decimales) : <span className="gris">—</span>)

                return (
                  <tr key={fila.clave}>
                    <th scope="row" style={fija}>
                      <span className="fila" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <span className="punto" style={{ background: fila.color }} />
                        <span className="fuerte">{fila.material}</span>
                        <span className="gris menor">{fila.unidad}</span>
                      </span>
                    </th>
                    {claves.map((clave) => (
                      <Fragment key={clave}>
                        <td className="numero" style={separa}>{celda(fila.porMes.get(clave)?.ingreso ?? 0)}</td>
                        <td className="numero">{celda(fila.porMes.get(clave)?.salida ?? 0)}</td>
                      </Fragment>
                    ))}
                    <td className="numero fuerte" style={separa}>{celda(fila.total.ingreso)}</td>
                    <td className="numero fuerte">{celda(fila.total.salida)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Indicador({
  rotulo,
  valor,
  detalle,
  actual,
  anterior,
  mesAnterior,
}: {
  rotulo: string
  valor: string
  detalle: string
  actual: number
  anterior: number
  mesAnterior: string
}) {
  return (
    <div className="tarjeta pila-chica">
      <span className="etiqueta">{rotulo}</span>
      <strong className="cifras" style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--tinta)', lineHeight: 1.05 }}>
        {valor}
      </strong>
      <span className="menor gris">{detalle}</span>
      <Variacion actual={actual} anterior={anterior} mesAnterior={mesAnterior} />
    </div>
  )
}

/** Sin mes anterior con datos no hay contra qué comparar: no se muestra nada. */
function Variacion({ actual, anterior, mesAnterior }: { actual: number; anterior: number; mesAnterior: string }) {
  if (!(anterior > 0)) return null

  const porcentaje = Math.round(((actual - anterior) / anterior) * 100)
  if (porcentaje === 0) {
    return <span className="menor gris">igual que en {mesAnterior}</span>
  }

  const sube = porcentaje > 0
  return (
    <span className="menor fila" style={{ gap: 5, color: sube ? 'var(--ingreso)' : 'var(--gris)', fontWeight: 700 }}>
      <IconoFlecha sube={sube} />
      {sube ? '+' : '−'}
      {numero(Math.abs(porcentaje))}% vs {mesAnterior}
    </span>
  )
}

function IconoFlecha({ sube }: { sube: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {sube ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}
    </svg>
  )
}

function IconoBajar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 10l5 5 5-5M4 19h16" />
    </svg>
  )
}
