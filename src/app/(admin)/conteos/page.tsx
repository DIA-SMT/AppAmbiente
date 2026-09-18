import Link from 'next/link'
import { redirect } from 'next/navigation'
import { conteosRecientes, puntosSinCarga, sitiosVisibles } from '@/lib/datos'
import {
  claveDeCalendario, diaSemana, fecha, fechaDeCalendario, fechaHora, numero, paraInputFechaHora,
} from '@/lib/formato'
import { exigirAdmin } from '@/lib/sesion'
import type { ConteoDiario, PuntoSinCarga } from '@/lib/tipos'
import { registrarConteo } from './acciones'
import estilos from './conteos.module.css'

export const dynamic = 'force-dynamic'

/** Cuántos días de silencio empiezan a ser un problema y no una jornada floja. */
const DIAS_DE_ALERTA = 3

/** Ventana de los conteos que se listan. Más viejo que esto se mira en Auditoría. */
const DIAS = 30

const MS_DIA = 86_400_000
const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** La vista pone esta fecha cuando el punto no cargó nunca nada. */
const NUNCA = '1900-01-01'

type Parametros = Record<string, string | string[] | undefined>

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()

/** Días enteros entre dos fechas de calendario aaaa-mm-dd. */
function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / MS_DIA)
}

/** Mediodía de Tucumán: ninguna conversión de zona corre el día. */
const instanteDeDia = (clave: string) => `${clave}T12:00:00-03:00`

function haceCuantosDias(dias: number | null): string {
  if (dias === null) return 'nunca cargó nada'
  if (dias <= 0) return 'cargó hoy'
  if (dias === 1) return 'ayer'
  return `hace ${numero(dias)} días`
}

/**
 * Se corrigió después de cargarlo.
 *
 * El alta deja creado_en y actualizado_en con el mismo now() de la transacción;
 * el trigger mueve actualizado_en recién en el update. Un segundo de tolerancia
 * para que un redondeo del driver no invente correcciones.
 */
function fueCorregido(c: ConteoDiario): boolean {
  const creado = new Date(c.creado_en).getTime()
  const tocado = new Date(c.actualizado_en).getTime()
  if (!Number.isFinite(creado) || !Number.isFinite(tocado)) return false
  return tocado - creado > 1000
}

function enumerar(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? ''
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

/** Un día del listado, con lo que hace falta para el encabezado del grupo. */
interface Dia {
  clave: string
  /** El valor crudo de la base, que es lo que sabe formatear fechaDeCalendario. */
  fecha: ConteoDiario['fecha']
  filas: ConteoDiario[]
  vecinos: number
}

interface Silencio {
  punto: PuntoSinCarga
  /** Null cuando el punto no cargó nunca nada. */
  dias: number | null
  callado: boolean
}

export default async function PantallaConteos({
  searchParams,
}: {
  searchParams: Promise<Parametros>
}) {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const sp = await searchParams
  const aviso = uno(sp.aviso)
  const detalle = uno(sp.detalle)

  const hoy = paraInputFechaHora().slice(0, 10)

  const [sinCarga, conteos, sitios] = await Promise.all([
    puntosSinCarga(sesion),
    conteosRecientes(sesion, { dias: DIAS }),
    sitiosVisibles(sesion),
  ])

  const puntos = sitios.filter((s) => s.tipo === 'punto_verde')
  const nombreDelPunto = new Map(puntos.map((p) => [p.id, `${p.codigo} · ${p.nombre}`]))
  const codigoDelPunto = new Map(sitios.map((s) => [s.id, s.codigo]))
  // carga_detallada solo llega por esta vista: sitiosVisibles no trae la columna.
  const soloConteo = new Map(sinCarga.map((p) => [p.sitio_id, !p.carga_detallada]))

  // ── Quién está cargando ───────────────────────────────────────────────
  // puntosSinCarga ya viene del más callado al más reciente.
  const silencios: Silencio[] = sinCarga.map((punto) => {
    const clave = claveDeCalendario(punto.ultima_carga)
    const dias = clave && clave > NUNCA ? diasEntre(clave, hoy) : null
    return { punto, dias, callado: dias === null || dias > DIAS_DE_ALERTA }
  })
  const callados = silencios.filter((s) => s.callado)
  const alDia = silencios.length - callados.length

  // ── Conteos cargados, agrupados por día ───────────────────────────────
  //
  // Por fecha y no por punto: arriba ya está la mirada punto por punto —quién
  // carga y quién no—, así que repetirla acá no agrega nada. Agrupado por día,
  // una jornada en la que mandó un solo punto se ve de un vistazo, y cuando el
  // vigilador llama por un día puntual ("el 15 fueron 18") se busca por donde
  // lo dijo. conteosRecientes ya devuelve ordenado por fecha descendente, así
  // que alcanza con cortar cuando cambia la clave.
  const dias: Dia[] = []
  for (const c of conteos) {
    const clave = claveDeCalendario(c.fecha) ?? ''
    let dia = dias[dias.length - 1]
    if (!dia || dia.clave !== clave) {
      dia = { clave, fecha: c.fecha, filas: [], vecinos: 0 }
      dias.push(dia)
    }
    dia.filas.push(c)
    dia.vecinos += Number(c.vecinos) || 0
  }
  const totalVecinos = conteos.reduce((suma, c) => suma + (Number(c.vecinos) || 0), 0)

  // ── Valores del formulario ────────────────────────────────────────────
  // Vuelven de la acción cuando algo falló, o del enlace «Corregir» de una fila.
  const puntoPedido = uno(sp.punto)
  const fechaPedida = uno(sp.fecha)
  const vecinosPedidos = uno(sp.vecinos)
  const valores = {
    punto: nombreDelPunto.has(puntoPedido) ? puntoPedido : '',
    fecha: FECHA.test(fechaPedida) && fechaPedida <= hoy ? fechaPedida : hoy,
    vecinos: /^\d{1,4}$/.test(vecinosPedidos) ? vecinosPedidos : '',
    observaciones: uno(sp.obs).slice(0, 500),
  }

  const puntoDelAviso = nombreDelPunto.get(puntoPedido) ?? 'el punto'
  // Acá la fecha viene de la URL, no de la base: es un día suelto, y se lee al
  // mediodía de Tucumán. fechaDeCalendario es para las columnas `date`.
  const fechaDelAviso = FECHA.test(fechaPedida) ? fecha(instanteDeDia(fechaPedida)) : ''

  const enlaceCorregir = (c: ConteoDiario) => {
    const p = new URLSearchParams({
      punto: c.sitio_id,
      fecha: claveDeCalendario(c.fecha) ?? '',
      vecinos: String(c.vecinos),
    })
    if (c.observaciones) p.set('obs', c.observaciones.slice(0, 200))
    return `/conteos?${p.toString()}#cargar`
  }

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Conteos diarios</h1>
        <p className="gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Donde no se puede usar el celular durante la jornada, el conteo de vecinos se lleva en
          papel y se carga una sola vez al cerrar. Acá se ve qué puntos están cargando, cuáles hace
          días que no mandan nada y qué se cargó en los últimos {numero(DIAS)} días.
        </p>
      </header>

      {aviso === 'guardado' && (
        <div className="aviso exito" role="status">
          Se guardó el conteo de {puntoDelAviso}
          {fechaDelAviso && ` del ${fechaDelAviso}`}: {numero(Number(vecinosPedidos) || 0)} vecinos.
        </div>
      )}
      {aviso === 'corregido' && (
        <div className="aviso exito" role="status">
          Se corrigió el conteo de {puntoDelAviso}
          {fechaDelAviso && ` del ${fechaDelAviso}`}: ahora dice{' '}
          {numero(Number(vecinosPedidos) || 0)} vecinos. El valor anterior queda en la auditoría.
        </div>
      )}
      {aviso === 'error' && (
        <div className="aviso error" role="alert">
          {detalle || 'No se pudo guardar el conteo.'}
        </div>
      )}

      {/* ── Quién está cargando ───────────────────────────────────────── */}

      <section className="pila-chica">
        <div className="fila-entre">
          <h2>Quién está cargando</h2>
          <span className="menor gris">
            {numero(alDia)} de {numero(silencios.length)} puntos mandaron algo en los últimos{' '}
            {numero(DIAS_DE_ALERTA)} días
          </span>
        </div>

        {callados.length > 0 ? (
          <div className="aviso atencion">
            <p style={{ margin: 0 }}>
              <span className="fuerte">
                {callados.length === 1
                  ? 'Un punto hace más de tres días que no manda nada'
                  : `${numero(callados.length)} puntos hace más de tres días que no mandan nada`}
                :{' '}
                <span className="mono">{callados.map((s) => s.punto.codigo).join(' · ')}</span>.
              </span>{' '}
              Un punto callado no es un punto sin gente: mientras nadie cargue, el tablero lo
              muestra en cero y esa caída no existió. Antes de leerlo como una baja de visitas,
              llamá al punto; si te dicen cuántos vinieron, cargalo{' '}
              <Link href="#cargar">acá abajo</Link>.
            </p>
          </div>
        ) : (
          <div className="aviso">
            Todos los puntos mandaron algo en los últimos {numero(DIAS_DE_ALERTA)} días. Mientras
            sea así, un cero en el tablero es gente que no vino, y no carga que falta.
          </div>
        )}

        <ul className="lista">
          {silencios.length === 0 && (
            <li className="vacio">No hay puntos verdes activos para seguir.</li>
          )}
          {silencios.map(({ punto, dias: sinCargar, callado }) => (
            <li key={punto.sitio_id} className={callado ? estilos.callado : undefined}>
              <div className={estilos.filaPunto}>
                <span className={estilos.codigo}>{punto.codigo}</span>
                <span className="fuerte">{punto.nombre}</span>
                {!punto.carga_detallada && (
                  <span className="chip diferida">solo conteo diario</span>
                )}
                <span className={`menor ${callado ? 'fuerte' : 'gris'} ${estilos.silencio}`}>
                  {sinCargar === null
                    ? 'Nunca cargó nada'
                    : <>Última carga: {fechaDeCalendario(punto.ultima_carga)} · {haceCuantosDias(sinCargar)}</>}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          La última carga es la más nueva de las dos vías: un movimiento cargado desde el celular o
          un conteo diario. Los puntos marcados con «solo conteo diario» no pueden usar el teléfono
          durante la jornada, así que de ellos nunca va a venir otra cosa que el total del día.
        </p>
      </section>

      {/* ── Cargar o corregir ─────────────────────────────────────────── */}

      <section className="tarjeta pila" id="cargar">
        <div className="pila-chica">
          <h2>Cargar o corregir un conteo</h2>
          <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
            Para cuando el vigilador avisa por teléfono. Hay un solo total por punto y por día: si
            ese día ya tenía un conteo, este lo corrige en vez de sumarse, y el valor anterior queda
            en la auditoría. A vos no te rige el límite de siete días para atrás que tiene el
            vigilador.
          </p>
        </div>

        <form action={registrarConteo} className={estilos.formulario}>
          <div className="campo">
            <label htmlFor="sitio_id">Punto</label>
            <select
              id="sitio_id"
              name="sitio_id"
              className="control"
              defaultValue={valores.punto}
              required
            >
              <option value="" disabled>Elegí una opción…</option>
              {puntos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} · {p.nombre}
                  {soloConteo.get(p.id) ? ' (solo conteo)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="fecha">Día del conteo</label>
            <input
              id="fecha"
              name="fecha"
              type="date"
              className="control"
              defaultValue={valores.fecha}
              max={hoy}
              required
            />
          </div>

          <div className="campo">
            <label htmlFor="vecinos">Vecinos</label>
            <input
              id="vecinos"
              name="vecinos"
              type="number"
              inputMode="numeric"
              step={1}
              min={0}
              max={5000}
              className="control"
              defaultValue={valores.vecinos}
              placeholder="0"
              required
            />
            <span className="ayuda">Cuántos vinieron en toda la jornada.</span>
          </div>

          <div className={`campo ${estilos.entero}`}>
            <label htmlFor="observaciones">
              Observaciones<span className="gris"> · opcional</span>
            </label>
            <input
              id="observaciones"
              name="observaciones"
              type="text"
              className="control"
              maxLength={500}
              defaultValue={valores.observaciones}
              autoComplete="off"
            />
            <span className="ayuda">
              Se guarda lo que quede en este campo. Si estás corrigiendo un día que ya tenía una
              observación del vigilador, dejala escrita o se pierde.
            </span>
          </div>

          <div className={`${estilos.pieFormulario} ${estilos.entero}`}>
            <button type="submit" className="boton">Guardar el conteo</button>
            <span className="menor gris">
              El conteo entra en las visitas del punto, no en los metros cúbicos: es gente, no
              material.
            </span>
          </div>
        </form>
      </section>

      {/* ── Lo que se cargó ───────────────────────────────────────────── */}

      <section className="pila-chica">
        <div className="fila-entre">
          <h2>Conteos cargados</h2>
          <span className="menor gris">
            últimos {numero(DIAS)} días · {numero(conteos.length)}{' '}
            {conteos.length === 1 ? 'conteo' : 'conteos'} · {numero(totalVecinos)} vecinos
          </span>
        </div>

        {conteos.length === 0 ? (
          <div className="tarjeta centrado pila" style={{ padding: 32 }}>
            <p className="fuerte" style={{ margin: 0 }}>
              Todavía no se cargó ningún conteo diario.
            </p>
            <p className="menor gris" style={{ margin: 0 }}>
              El vigilador lo carga desde el celular al cerrar la jornada, y vos podés cargarlo acá
              cuando te avisen por teléfono. Hasta que alguno entre, los puntos que llevan el
              conteo en papel van a figurar en cero en el tablero.
            </p>
          </div>
        ) : (
          <div className="desplazable">
            <table className="datos">
              <caption className="sr-solo">
                Conteos diarios cargados en los últimos {numero(DIAS)} días, agrupados por día.
              </caption>
              <thead>
                <tr>
                  <th>Punto</th>
                  <th style={{ textAlign: 'right' }}>Vecinos</th>
                  <th>Quién lo cargó</th>
                  <th>Cuándo se cargó</th>
                  <th><span className="sr-solo">Acciones</span></th>
                </tr>
              </thead>
              {dias.map((dia) => (
                <tbody key={dia.clave} className={estilos.grupo}>
                  <tr>
                    <th scope="colgroup" colSpan={5}>
                      {fechaDeCalendario(dia.fecha)}{' '}
                      <span className="gris" style={{ fontWeight: 600 }}>
                        · {diaSemana(instanteDeDia(dia.clave))} ·{' '}
                        {numero(dia.filas.length)} {dia.filas.length === 1 ? 'punto' : 'puntos'} ·{' '}
                        {numero(dia.vecinos)} vecinos
                      </span>
                    </th>
                  </tr>
                  {dia.filas.map((c) => {
                    const corregido = fueCorregido(c)
                    return (
                      <tr key={c.id}>
                        <th scope="row" style={{ fontWeight: 400 }}>
                          <span className="fila" style={{ gap: 8 }}>
                            <span className={estilos.codigo}>
                              {codigoDelPunto.get(c.sitio_id) ?? '—'}
                            </span>
                            <span className="fuerte">{c.sitio_nombre}</span>
                            {soloConteo.get(c.sitio_id) && (
                              <span className="chip diferida">solo conteo diario</span>
                            )}
                          </span>
                          {c.observaciones && (
                            <span className={estilos.observacion}>{c.observaciones}</span>
                          )}
                        </th>
                        <td className="numero fuerte">{numero(c.vecinos)}</td>
                        <td>{c.cargado_por ?? <span className="gris">—</span>}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {fechaHora(c.creado_en)}
                          {corregido && (
                            <>
                              {' '}
                              <span className="chip salida" title={`Corregido el ${fechaHora(c.actualizado_en)}`}>
                                corregido
                              </span>
                            </>
                          )}
                        </td>
                        <td>
                          <Link href={enlaceCorregir(c)} className="boton chico secundario">
                            Corregir
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}

        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          «Corregido» quiere decir que el total del día se cambió después de cargarlo, que es parte
          del trabajo: se anotó 15 y eran 18. Queda un solo total por día y el nombre pasa a ser
          el de quien corrigió último. El cambio entero, con el valor viejo, está en{' '}
          <Link href="/auditoria">Auditoría</Link>.
        </p>
      </section>
    </div>
  )
}
