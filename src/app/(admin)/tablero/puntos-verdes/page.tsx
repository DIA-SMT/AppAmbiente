import { Fragment, type CSSProperties } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import {
  buscarMovimientos, entidadesPendientes, resumenValorizacion, resumenVecinos, sitiosVisibles,
} from '@/lib/datos'
import {
  ETIQUETA_VALORIZACION, cantidad, fecha, mesCorto, mesLargo, numero, paraInputFechaHora,
} from '@/lib/formato'
import { sesionActual } from '@/lib/sesion'
import type { TipoValorizacion } from '@/lib/tipos'
import SubNavegacion from '../SubNavegacion'
import GraficoVecinos, { type PuntoGrafico } from './GraficoVecinos'
import estilos from './puntos-verdes.module.css'

export const dynamic = 'force-dynamic'

/** Cuántas columnas entran en la tabla. Ocho semanas son dos meses de tendencia. */
const COLUMNAS = { semana: 8, mes: 6 } as const
type Periodo = keyof typeof COLUMNAS

const TIPOS: TipoValorizacion[] = ['reutilizacion', 'venta', 'emprendimiento', 'otro']

const DIA = 86_400_000

// ── Fechas ──────────────────────────────────────────────────────────────

/**
 * La semana y el mes llegan como date y, según el motor, como texto o como
 * Date. Se reducen a 'aaaa-mm-dd' leyendo el día local: pasar por toISOString()
 * corre la fecha un día para atrás si el servidor está al este de Greenwich.
 */
/**
 * Una columna `date` de Postgres es una fecha de calendario, sin hora ni zona,
 * y el driver la entrega como Date a medianoche UTC. Hay que leerla en UTC: con
 * los getters locales, en Argentina (UTC−3) el 1 de septiembre se lee como 31
 * de agosto y todo el tablero queda corrido un mes.
 */
function claveDeFecha(valor: string | Date): string {
  if (valor instanceof Date) {
    const dos = (n: number) => String(n).padStart(2, '0')
    return `${valor.getUTCFullYear()}-${dos(valor.getUTCMonth() + 1)}-${dos(valor.getUTCDate())}`
  }
  return String(valor).slice(0, 10)
}

/** Mediodía de Tucumán: así ninguna conversión de zona corre el día. */
const instanteDeDia = (clave: string) => `${clave}T12:00:00-03:00`
const instanteDeMes = (clave: string) => `${clave}-01T12:00:00-03:00`

function restarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d) - dias * DIA).toISOString().slice(0, 10)
}

/** Lunes de esa semana, que es como date_trunc('week') agrupa en Postgres. */
function lunesDe(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay()
  return restarDias(iso, (dia + 6) % 7)
}

function restarMeses(clave: string, meses: number): string {
  const [anio, mes] = clave.split('-').map(Number)
  const total = anio * 12 + (mes - 1) - meses
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`
}

// ── Acumuladores ────────────────────────────────────────────────────────

/**
 * Las cuatro cuentas de un punto en un período. No se suman entre sí:
 * `contadas` es la parte de `visitas` que viene de un conteo diario, e
 * `identificados` son personas y no visitas.
 */
interface Cuentas { visitas: number; sinDatos: number; identificados: number; contadas: number }
const enCero = (): Cuentas => ({ visitas: 0, sinDatos: 0, identificados: 0, contadas: 0 })

function acumular(destino: Cuentas, origen: Cuentas) {
  destino.visitas += origen.visitas
  destino.sinDatos += origen.sinDatos
  destino.identificados += origen.identificados
  destino.contadas += origen.contadas
}

interface FilaPunto {
  id: string
  codigo: string
  nombre: string
  /** No puede usar el celular en la jornada: solo se espera el conteo diario. */
  soloConteo: boolean
  porPeriodo: Map<string, Cuentas>
  total: Cuentas
}

/** "PV-03", "PV-03 y PV-07", "PV-01, PV-03 y PV-07". */
function enumerar(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? ''
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

interface MaterialValorizado {
  clave: string
  nombre: string
  color: string
  unidad: string
  plural: string
  porTipo: Map<string, number>
  total: number
}

interface TotalDeUnidad { plural: string; cantidad: number }

/** Kilos y unidades son enteros; los m³ no. Se decide por fila para que la
 *  columna no mezcle formatos. */
const decimalesDe = (valores: number[]) => (valores.every((v) => Number.isInteger(v)) ? 0 : 2)

const enUnidad = (valor: number, plural: string, decimales: number) =>
  cantidad(valor, { nombre: plural, nombre_plural: plural, decimales })

// La primera columna queda fija al desplazar de costado: con ocho períodos por
// delante, si el punto se va de pantalla la fila deja de querer decir algo.
// Va en línea y no en el módulo porque tiene que ganarle a table.datos th.
const fija: CSSProperties = {
  position: 'sticky', left: 0, zIndex: 2,
  background: 'var(--panel)', boxShadow: '1px 0 0 var(--linea)',
}
const fijaCabecera: CSSProperties = { ...fija, zIndex: 3, background: 'var(--panel-2)' }
const fijaTotal: CSSProperties = { ...fija, background: 'var(--panel-2)' }
const separa: CSSProperties = { borderLeft: '1px solid var(--linea)' }
const derecha: CSSProperties = { textAlign: 'right' }

// ── Pantalla ────────────────────────────────────────────────────────────

export default async function TableroPuntosVerdes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')
  if (sesion.rol !== 'admin') redirect('/turno')

  const parametros = await searchParams
  const pedido = Array.isArray(parametros.periodo) ? parametros.periodo[0] : parametros.periodo
  const periodo: Periodo = pedido === 'semana' ? 'semana' : 'mes'
  const columnas = COLUMNAS[periodo]

  const hoy = paraInputFechaHora().slice(0, 10)

  const claves: string[] = []
  if (periodo === 'semana') {
    const lunes = lunesDe(hoy)
    for (let i = columnas - 1; i >= 0; i--) claves.push(restarDias(lunes, i * 7))
  } else {
    const mesActual = hoy.slice(0, 7)
    for (let i = columnas - 1; i >= 0; i--) claves.push(restarMeses(mesActual, i))
  }
  const desde = periodo === 'semana' ? claves[0] : `${claves[0]}-01`
  const enCurso = claves[claves.length - 1]
  const anterior = claves[claves.length - 2]

  const rotulo = (clave: string) =>
    periodo === 'semana' ? fecha(instanteDeDia(clave)).slice(0, 5) : mesCorto(instanteDeMes(clave))

  const nombreDe = (clave: string) =>
    periodo === 'semana'
      ? `la semana del ${fecha(instanteDeDia(clave))}`
      : mesLargo(instanteDeMes(clave)).toLowerCase()

  const sitios = await sitiosVisibles(sesion)
  const puntos = sitios.filter((s) => s.tipo === 'punto_verde')
  const { total: registrados } = await buscarMovimientos(sesion, { flujo: 'punto_verde', porPagina: 1 })

  const enlaceExcel =
    `/api/exportar?vista=movimientos&flujo=punto_verde&desde=${desde}&hasta=${hoy}`

  const encabezado = (
    <>
      <SubNavegacion />
      <header className="fila-entre" style={{ flexWrap: 'wrap', rowGap: 12 }}>
        <div>
          <h1>Puntos Verdes</h1>
          <p className="menor gris" style={{ margin: 0 }}>
            {periodo === 'semana' ? `Últimas ${columnas} semanas` : `Últimos ${columnas} meses`}
            {' · desde el '}{fecha(instanteDeDia(desde))}
            {puntos.length > 0 && ` · ${numero(puntos.length)} puntos`}
          </p>
        </div>
        <div className="fila">
          <div className="fila" style={{ gap: 6 }} role="group" aria-label="Período que se muestra">
            {(['semana', 'mes'] as const).map((p) => (
              <Link
                key={p}
                href={`/tablero/puntos-verdes?periodo=${p}`}
                className={`boton chico ${p === periodo ? '' : 'secundario'}`}
                aria-current={p === periodo ? 'page' : undefined}
              >
                Por {p}
              </Link>
            ))}
          </div>
          {registrados > 0 && (
            <a className="boton chico secundario" href={enlaceExcel}>
              <IconoBajar />
              Exportar a Excel
            </a>
          )}
        </div>
      </header>
    </>
  )

  if (registrados === 0) {
    return (
      <div className="pila" style={{ gap: 20 }}>
        {encabezado}
        <div className="tarjeta pila">
          <h2>Todavía no hay movimientos en los Puntos Verdes</h2>
          <p style={{ margin: 0 }}>
            Acá va a aparecer cuánta gente se acerca a cada punto y qué parte deja sus datos, punto
            por punto y período por período, y cuánto material vuelve a circular por reutilización,
            venta, emprendimientos u otros destinos.
          </p>
          <p style={{ margin: 0 }}>
            Se arma solo con lo que se carga en la calle. El primer movimiento lo registra el
            vigilador desde el celular: entra con el usuario de su punto y elige si un vecino deja
            material (ingreso) o si alguien se lo lleva (salida). Si un punto todavía no tiene
            usuario, creáselo en <Link href="/usuarios">Usuarios</Link>; los materiales y los
            destinos que va a ver en las listas se administran en <Link href="/listas">Listas</Link>.
          </p>
          <div className="fila">
            <Link className="boton" href="/usuarios">Crear el usuario de un punto</Link>
            <Link className="boton secundario" href="/listas">Revisar las listas</Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Vecinos por punto ─────────────────────────────────────────────────

  // La modalidad no viene con los sitios, y hace falta también para los puntos
  // que no tienen ni una fila en el período: un punto que solo cuenta y no
  // cargó nada es justo el que no hay que leer como un punto sin gente.
  const [filasVecinos, modalidades] = await Promise.all([
    resumenVecinos(sesion, { periodo, desde }),
    consultarConSesion<{ id: string; carga_detallada: boolean }>(
      sesion,
      "select id, carga_detallada from sitios where tipo = 'punto_verde'",
    ),
  ])
  const soloCuenta = new Map(modalidades.map((s) => [s.id, !s.carga_detallada]))

  const porPunto = new Map<string, FilaPunto>(
    puntos.map((s) => [
      s.id,
      {
        id: s.id, codigo: s.codigo, nombre: s.nombre,
        soloConteo: soloCuenta.get(s.id) ?? false,
        porPeriodo: new Map(), total: enCero(),
      },
    ]),
  )
  const totalPorPeriodo = new Map<string, Cuentas>(claves.map((c) => [c, enCero()]))
  const totalGeneral = enCero()

  for (const f of filasVecinos) {
    // La vista agrupa por semana y por mes a la vez: mirando meses, cada punto
    // trae una fila por semana y hay que juntarlas acá.
    const clave = periodo === 'semana' ? claveDeFecha(f.semana) : claveDeFecha(f.mes).slice(0, 7)
    const acumulado = totalPorPeriodo.get(clave)
    if (!acumulado) continue

    let punto = porPunto.get(f.sitio_id)
    if (!punto) {
      // Un punto dado de baja que igual tiene historia: se muestra, no se esconde.
      punto = {
        id: f.sitio_id, codigo: f.sitio_codigo, nombre: f.sitio_nombre,
        soloConteo: !f.carga_detallada,
        porPeriodo: new Map(), total: enCero(),
      }
      porPunto.set(f.sitio_id, punto)
    }

    const valores: Cuentas = {
      visitas: Number(f.visitas) || 0,
      sinDatos: Number(f.sin_datos) || 0,
      identificados: Number(f.identificados) || 0,
      contadas: Number(f.contadas) || 0,
    }
    const celda = punto.porPeriodo.get(clave) ?? enCero()
    acumular(celda, valores)
    punto.porPeriodo.set(clave, celda)
    acumular(punto.total, valores)
    acumular(acumulado, valores)
    acumular(totalGeneral, valores)
  }

  const filasPuntos = [...porPunto.values()]

  const datosGrafico: PuntoGrafico[] = filasPuntos.map((p) => {
    const t = p.porPeriodo.get(enCurso) ?? enCero()
    return {
      id: p.id, codigo: p.codigo, nombre: p.nombre, soloConteo: p.soloConteo,
      visitas: t.visitas, sinDatos: t.sinDatos, identificados: t.identificados,
      contadas: t.contadas,
    }
  })

  const actual = totalPorPeriodo.get(enCurso) ?? enCero()
  const previo = (anterior && totalPorPeriodo.get(anterior)) || enCero()
  const sinActividad = datosGrafico.filter((p) => p.visitas === 0)
  const conActividad = datosGrafico.length - sinActividad.length
  const rotuloAnterior = periodo === 'semana' ? 'Semana anterior completa' : 'Mes anterior completo'

  // El porcentaje sin datos se mide contra las visitas del modo detallado, que
  // son las únicas donde hubo alguien a quien preguntarle. Si se midiera contra
  // el total, cada conteo diario bajaría el porcentaje como si esa gente sí
  // hubiera dejado sus datos.
  const visitasConDetalle = Math.max(actual.visitas - actual.contadas, 0)
  const porcentajeSinDatos = visitasConDetalle > 0
    ? Math.round((actual.sinDatos / visitasConDetalle) * 100)
    : 0

  const puntosQueCuentan = filasPuntos.filter((p) => (p.porPeriodo.get(enCurso)?.contadas ?? 0) > 0)
  const calladosQueCuentan = sinActividad.filter((p) => p.soloConteo)

  // ── Valorización ──────────────────────────────────────────────────────

  // Con semanas alcanza con cuatro meses: ocho semanas nunca tocan más.
  const filasValorizacion = (
    await resumenValorizacion(sesion, { flujo: 'punto_verde', meses: periodo === 'semana' ? 4 : columnas })
  ).filter((f) => {
    const clave = periodo === 'semana' ? claveDeFecha(f.semana) : claveDeFecha(f.mes).slice(0, 7)
    return clave >= claves[0]
  })

  const porTipo = new Map(
    TIPOS.map((t) => [
      t,
      {
        porUnidad: new Map<string, TotalDeUnidad>(),
        materiales: new Map<string, { nombre: string; color: string; plural: string; cantidad: number }>(),
      },
    ]),
  )
  const totalPorUnidad = new Map<string, TotalDeUnidad>()
  const materialesValorizados = new Map<string, MaterialValorizado>()

  for (const f of filasValorizacion) {
    const grupo = porTipo.get(f.tipo_valorizacion)
    const valor = Number(f.cantidad) || 0
    if (!grupo || !(valor > 0)) continue

    const unidad = grupo.porUnidad.get(f.unidad_codigo) ?? { plural: f.unidad_plural, cantidad: 0 }
    unidad.cantidad += valor
    grupo.porUnidad.set(f.unidad_codigo, unidad)

    const general = totalPorUnidad.get(f.unidad_codigo) ?? { plural: f.unidad_plural, cantidad: 0 }
    general.cantidad += valor
    totalPorUnidad.set(f.unidad_codigo, general)

    // Un mismo material puede venir en dos unidades: se separan, sumarlos no
    // querría decir nada.
    const clave = `${f.material_id}|${f.unidad_codigo}`

    const enTarjeta = grupo.materiales.get(clave)
      ?? { nombre: f.material_nombre, color: f.material_color, plural: f.unidad_plural, cantidad: 0 }
    enTarjeta.cantidad += valor
    grupo.materiales.set(clave, enTarjeta)

    const fila = materialesValorizados.get(clave) ?? {
      clave, nombre: f.material_nombre, color: f.material_color,
      unidad: f.unidad_codigo, plural: f.unidad_plural,
      porTipo: new Map<string, number>(), total: 0,
    }
    fila.porTipo.set(f.tipo_valorizacion, (fila.porTipo.get(f.tipo_valorizacion) ?? 0) + valor)
    fila.total += valor
    materialesValorizados.set(clave, fila)
  }

  const detalleValorizacion = [...materialesValorizados.values()].sort(
    (a, b) => (a.unidad === b.unidad ? b.total - a.total : a.unidad.localeCompare(b.unidad, 'es')),
  )

  const pendientes = await entidadesPendientes(sesion)

  const celda = (valor: number, decimales = 0) =>
    valor > 0 ? numero(valor, decimales) : <span className="gris">—</span>

  return (
    <div className="pila" style={{ gap: 20 }}>
      {encabezado}

      {pendientes.length > 0 && (
        <div className="aviso atencion">
          <p style={{ margin: 0 }}>
            <span className="fuerte">
              {pendientes.length === 1
                ? 'Un alta hecha en la calle espera tu confirmación'
                : `${numero(pendientes.length)} altas hechas en la calle esperan tu confirmación`}
              :
            </span>{' '}
            {pendientes.slice(0, 4).map((e) => e.nombre).join(', ')}
            {pendientes.length > 4 && ` y ${numero(pendientes.length - 4)} más`}. Mientras estén
            pendientes solo pueden figurar como destino: se llevan material, no lo traen.{' '}
            <Link href="/revisiones">Revisarlas ahora</Link>.
          </p>
        </div>
      )}

      <section className="pila-chica">
        <h2 className="sr-solo">Resumen de {nombreDe(enCurso)}</h2>
        <div className={estilos.indicadores}>
          <Indicador
            rotulo={`Visitas · ${rotulo(enCurso)}`}
            valor={numero(actual.visitas)}
            detalle="veces que alguien trajo material"
            nota={anterior ? `${rotuloAnterior} (${rotulo(anterior)}): ${numero(previo.visitas)}` : undefined}
          />
          <Indicador
            rotulo={`Vecinos identificados · ${rotulo(enCurso)}`}
            valor={numero(actual.identificados)}
            detalle="personas distintas que dejaron su teléfono"
            nota={anterior ? `${rotuloAnterior} (${rotulo(anterior)}): ${numero(previo.identificados)}` : undefined}
          />
          <Indicador
            rotulo={`Visitas sin datos · ${rotulo(enCurso)}`}
            valor={visitasConDetalle > 0 ? `${numero(porcentajeSinDatos)}%` : '—'}
            detalle={
              visitasConDetalle > 0
                ? `${numero(actual.sinDatos)} de ${numero(visitasConDetalle)} visitas con detalle no dejaron datos`
                : 'todavía no hubo visitas con detalle en el período'
            }
            nota={
              actual.contadas > 0
                ? 'Las visitas que vienen del conteo diario quedan afuera de esta cuenta: ahí no se le preguntó a nadie.'
                : 'Cuanto más alto, menos se puede seguir a quién vuelve.'
            }
          />
          <Indicador
            rotulo="Puntos con ingresos"
            valor={`${numero(conActividad)} de ${numero(datosGrafico.length)}`}
            detalle={`en ${nombreDe(enCurso)}`}
            nota={
              sinActividad.length > 0
                ? `Sin ingresos: ${sinActividad.map((p) => p.codigo).join(', ')}`
                : 'Todos los puntos registraron ingresos.'
            }
            alerta={sinActividad.length > 0}
          />
        </div>
        {actual.contadas > 0 && (
          <p className="menor gris" style={{ margin: 0 }}>
            De las {numero(actual.visitas)} visitas de {nombreDe(enCurso)},{' '}
            <span className="fuerte">{numero(actual.contadas)} vienen del conteo diario</span> de{' '}
            {enumerar(puntosQueCuentan.map((p) => p.nombre))}: gente que vino y se contó en papel al
            cerrar la jornada, sin detalle de quién. Por eso esas visitas no aparecen en
            identificados.
          </p>
        )}
        {calladosQueCuentan.length > 0 && (
          <p className="menor gris" style={{ margin: 0 }}>
            <span className="fuerte">
              {enumerar(calladosQueCuentan.map((p) => p.codigo))}{' '}
              {calladosQueCuentan.length === 1 ? 'no registró' : 'no registraron'} ni una visita en{' '}
              {nombreDe(enCurso)}
            </span>, y {calladosQueCuentan.length === 1 ? 'lleva' : 'llevan'} el conteo en papel: ese
            cero puede ser que no vino nadie o que nadie lo cargó, y son dos cosas distintas.{' '}
            <Link href="/conteos">Ver quién está cargando</Link>.
          </p>
        )}
        <p className="menor gris" style={{ margin: 0 }}>
          {periodo === 'semana' ? 'La semana' : 'El mes'} en curso todavía no terminó. Por eso
          debajo de las visitas y de los identificados va el {periodo} anterior entero en vez de un
          porcentaje: comparar días contra un {periodo} completo muestra caídas donde solo faltan
          días.
        </p>
      </section>

      <section className="tarjeta pila">
        <div className="fila-entre">
          <h2>Visitas por punto</h2>
          <span className="menor gris">{nombreDe(enCurso)}</span>
        </div>
        <GraficoVecinos puntos={datosGrafico} periodo={nombreDe(enCurso)} />
      </section>

      <section className="pila-chica">
        <h2>Vecinos por punto</h2>
        <div className="desplazable">
          <table className="datos">
            <caption className="sr-solo">
              Visitas, visitas que vienen de un conteo diario, vecinos identificados y visitas sin
              datos, por punto y por {periodo}.
            </caption>
            <thead>
              <tr>
                <th rowSpan={2} style={fijaCabecera}>Punto</th>
                {claves.map((clave) => (
                  <th key={clave} colSpan={4} className="centrado" style={separa}>
                    {rotulo(clave)}
                  </th>
                ))}
                <th colSpan={4} className="centrado" style={separa}>Total</th>
              </tr>
              <tr>
                {[...claves, 'total'].map((clave) => (
                  <Fragment key={clave}>
                    <th style={{ ...separa, ...derecha }}>Visitas</th>
                    <th style={derecha}>De conteo</th>
                    <th style={derecha}>Identificados</th>
                    <th style={derecha}>Sin datos</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {filasPuntos.map((punto) => (
                <tr key={punto.id}>
                  <th scope="row" style={fija}>
                    <span className="fila" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <span className="mono fuerte">{punto.codigo}</span>
                      <span className="gris menor">{punto.nombre}</span>
                      {punto.soloConteo && <span className="chip diferida">solo conteo diario</span>}
                    </span>
                  </th>
                  {claves.map((clave) => {
                    const t = punto.porPeriodo.get(clave) ?? enCero()
                    return (
                      <Fragment key={clave}>
                        <td className="numero" style={separa}>{celda(t.visitas)}</td>
                        <td className="numero">{celda(t.contadas)}</td>
                        <SinDetalle soloConteo={punto.soloConteo}>
                          <td className="numero">{celda(t.identificados)}</td>
                          <td className="numero">{celda(t.sinDatos)}</td>
                        </SinDetalle>
                      </Fragment>
                    )
                  })}
                  <td className="numero fuerte" style={separa}>{celda(punto.total.visitas)}</td>
                  <td className="numero fuerte">{celda(punto.total.contadas)}</td>
                  <SinDetalle soloConteo={punto.soloConteo}>
                    <td className="numero fuerte">{celda(punto.total.identificados)}</td>
                    <td className="numero fuerte">{celda(punto.total.sinDatos)}</td>
                  </SinDetalle>
                </tr>
              ))}
            </tbody>
            <tfoot className={estilos.total}>
              <tr>
                <th scope="row" style={fijaTotal}>Todos los puntos</th>
                {claves.map((clave) => {
                  const t = totalPorPeriodo.get(clave) ?? enCero()
                  return (
                    <Fragment key={clave}>
                      <td className="numero" style={separa}>{celda(t.visitas)}</td>
                      <td className="numero">{celda(t.contadas)}</td>
                      <td className="numero">{celda(t.identificados)}</td>
                      <td className="numero">{celda(t.sinDatos)}</td>
                    </Fragment>
                  )
                })}
                <td className="numero" style={separa}>{celda(totalGeneral.visitas)}</td>
                <td className="numero">{celda(totalGeneral.contadas)}</td>
                <td className="numero">{celda(totalGeneral.identificados)}</td>
                <td className="numero">{celda(totalGeneral.sinDatos)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="menor gris" style={{ margin: 0 }}>
          Las cuatro columnas cuentan cosas distintas y no se suman entre sí:{' '}
          <span className="fuerte">visitas</span> es cada vez que alguien trajo material,{' '}
          <span className="fuerte">de conteo</span> es la parte de esas visitas que viene de un
          conteo diario en papel —se sabe cuántos vinieron, no quiénes—,{' '}
          <span className="fuerte">identificados</span> son las personas distintas que dejaron su
          teléfono y <span className="fuerte">sin datos</span> son las visitas de quien prefirió no
          dejarlos.
        </p>
        <p className="menor gris" style={{ margin: 0 }}>
          Los puntos marcados con <span className="chip diferida">solo conteo diario</span> no
          pueden usar el celular durante la jornada: ahí todas las visitas salen del papel, y por
          eso en identificados y en sin datos no va un cero sino «no se sabe quién vino». Un cero
          ahí se leería como el peor punto de todos, y lo que pasa es que esa modalidad no puede
          registrar a nadie. Que un punto cuente en papel no es un problema; que no cargue, sí:{' '}
          <Link href="/conteos">Conteos</Link> muestra cuál está mandando y cuál no.
        </p>
        <p className="menor gris" style={{ margin: 0 }}>
          En identificados, el total suma cada {periodo}: quien vino en dos{' '}
          {periodo === 'semana' ? 'semanas' : 'meses'} distintos figura en los dos, así que esa suma
          es un techo y no una cuenta de personas. Los nombres y teléfonos están en{' '}
          <Link href="/vecinos">Vecinos</Link>.
        </p>
      </section>

      <section className="pila-chica">
        <div className="fila-entre">
          <h2>Material recirculado</h2>
          <span className="menor gris">
            {periodo === 'semana' ? `últimas ${columnas} semanas` : `últimos ${columnas} meses`}
          </span>
        </div>

        {filasValorizacion.length === 0 ? (
          <div className="aviso">
            Todavía no salió material con un tipo de valorización cargado. El vigilador lo elige al
            registrar una salida: quién se lo lleva y para qué —reutilización, venta,
            emprendimiento u otro—. Los ingresos de vecinos no llevan tipo: solo las salidas.
          </div>
        ) : (
          <>
            <div className={estilos.tarjetas}>
              {TIPOS.map((tipo) => {
                const grupo = porTipo.get(tipo)
                const unidades = [...(grupo?.porUnidad.entries() ?? [])]
                  .sort((a, b) => b[1].cantidad - a[1].cantidad)
                const principal = unidades[0]
                const totalDeLaUnidad = principal ? totalPorUnidad.get(principal[0])?.cantidad ?? 0 : 0
                const parte = principal && totalDeLaUnidad > 0
                  ? Math.round((principal[1].cantidad / totalDeLaUnidad) * 100)
                  : null
                const materiales = [...(grupo?.materiales.entries() ?? [])]
                  .sort((a, b) => b[1].cantidad - a[1].cantidad)
                  .slice(0, 3)

                return (
                  <div key={tipo} className="tarjeta pila-chica">
                    <span className="etiqueta">{ETIQUETA_VALORIZACION[tipo]}</span>
                    {principal ? (
                      <>
                        <strong className={estilos.cifra}>
                          {enUnidad(principal[1].cantidad, principal[1].plural, decimalesDe([principal[1].cantidad]))}
                        </strong>
                        {unidades.slice(1).map(([codigo, u]) => (
                          <span key={codigo} className="menor fuerte">
                            {enUnidad(u.cantidad, u.plural, decimalesDe([u.cantidad]))}
                          </span>
                        ))}
                        {parte !== null && (
                          <span className="menor gris">
                            {numero(parte)}% del total en {principal[1].plural} del período
                          </span>
                        )}
                        <ul className={estilos.materiales}>
                          {materiales.map(([clave, m]) => (
                            <li key={clave}>
                              <span className="punto" style={{ background: m.color }} />
                              <span className="crecer">{m.nombre}</span>
                              <span className="cifras fuerte">
                                {enUnidad(m.cantidad, m.plural, decimalesDe([m.cantidad]))}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="menor gris" style={{ margin: 0 }}>
                        Sin salidas de este tipo en el período.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            <h3 style={{ marginTop: 8 }}>Detalle por material</h3>
            <div className="desplazable">
              <table className="datos">
                <caption className="sr-solo">
                  Cantidad de cada material según para qué se lo llevaron.
                </caption>
                <thead>
                  <tr>
                    <th style={fijaCabecera}>Material</th>
                    <th>Unidad</th>
                    {TIPOS.map((tipo) => (
                      <th key={tipo} style={derecha}>{ETIQUETA_VALORIZACION[tipo]}</th>
                    ))}
                    <th style={derecha}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detalleValorizacion.map((fila) => {
                    const valores = [...TIPOS.map((t) => fila.porTipo.get(t) ?? 0), fila.total]
                    const decimales = decimalesDe(valores)
                    return (
                      <tr key={fila.clave}>
                        <th scope="row" style={fija}>
                          <span className="fila" style={{ gap: 8, flexWrap: 'nowrap' }}>
                            <span className="punto" style={{ background: fila.color }} />
                            <span className="fuerte">{fila.nombre}</span>
                          </span>
                        </th>
                        <td className="gris menor">{fila.plural}</td>
                        {TIPOS.map((tipo) => (
                          <td key={tipo} className="numero">{celda(fila.porTipo.get(tipo) ?? 0, decimales)}</td>
                        ))}
                        <td className="numero fuerte">{celda(fila.total, decimales)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="menor gris" style={{ margin: 0 }}>
              Cada fila se suma dentro de su unidad. Los totales de las tarjetas no mezclan kilos
              con m³ por eso mismo: aparecen en líneas separadas cuando un tipo movió las dos cosas.
            </p>
          </>
        )}
      </section>
    </div>
  )
}

/**
 * Las dos celdas del modo detallado, o el motivo por el que no hay número.
 *
 * En un punto que solo cuenta, identificados y sin datos son cero siempre, y no
 * porque no haya venido nadie: el conteo diario no sabe quién vino. Mostrar el
 * cero lo dejaría último en la única columna que la coordinadora usa para
 * comparar puntos, así que en su lugar va el motivo, ahí mismo, en vez de una
 * nota al pie que nadie lee.
 */
function SinDetalle({ soloConteo, children }: { soloConteo: boolean; children: React.ReactNode }) {
  if (!soloConteo) return <>{children}</>
  return (
    <td
      colSpan={2}
      className="menor gris"
      style={{ whiteSpace: 'nowrap' }}
      title="El conteo diario registra cuánta gente vino, no quién: no es que no hubo vecinos identificados, es que esta modalidad no puede identificarlos."
    >
      no se sabe quién vino
    </td>
  )
}

function Indicador({
  rotulo,
  valor,
  detalle,
  nota,
  alerta,
}: {
  rotulo: string
  valor: string
  detalle: string
  nota?: string
  alerta?: boolean
}) {
  return (
    <div className={`tarjeta pila-chica ${alerta ? estilos.atencion : ''}`}>
      <span className="etiqueta">{rotulo}</span>
      <strong className={estilos.cifra}>{valor}</strong>
      <span className="menor gris">{detalle}</span>
      {nota && <span className={`menor ${alerta ? 'fuerte' : 'gris'}`}>{nota}</span>}
    </div>
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
