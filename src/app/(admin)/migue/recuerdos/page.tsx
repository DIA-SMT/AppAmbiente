import Link from 'next/link'
import { Retrato } from '@/app/_migue/Retrato'
import { numero } from '@/lib/formato'
import {
  pantallaDeCoordinacion,
  type EstadoDeMigue, type EventosRecientes, type Expresion, type GastoDelMes, type Recuerdo,
} from '@/lib/migue/pantallas'
import {
  DIAS_DE_CONVERSACION_DE_COORDINACION, HORAS_DE_CONVERSACION_DEL_PUNTO, RECUERDOS_MAXIMOS,
} from '@/lib/reglas'
import { exigirPanel } from '@/lib/sesion'
import comunes from '../../gente.module.css'
import { olvidar, revisar } from './acciones'
import estilos from './recuerdos.module.css'

export const dynamic = 'force-dynamic'

type Parametros = Record<string, string | string[] | undefined>

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()

const AVISOS: Record<string, string> = {
  olvidado: 'Listo: Migue lo olvidó. Las conversaciones donde lo tenía presente quedaron cerradas y vacías.',
  aprobada:
    'Aprobada. La van a usar las conversaciones que se abran de acá en adelante; las que ya están abiertas siguen con las palabras con que empezaron.',
  descartada: 'Descartada. No va a llegar a ninguna conversación.',
}

/**
 * Dólares como los cobra OpenRouter. Una pregunta cuesta décimas de centavo:
 * con dos decimales, el mes entero de un punto se leería «US$ 0,00» y parecería
 * que no preguntó nada.
 */
function dolares(valor: number, decimales = valor >= 1 ? 2 : 4): string {
  return `US$ ${numero(valor, decimales)}`
}

function porcentaje(valor: number): string {
  return `${numero(valor, valor < 10 ? 1 : 0)} %`
}

// ── Piezas ──────────────────────────────────────────────────────────────

function AvisoDeEstado({ estado }: { estado: EstadoDeMigue }) {
  if (estado.estado === 'encendido') return null
  if (estado.estado === 'tope') {
    return (
      <div className="aviso atencion" role="status">
        Migue llegó al tope de gasto del mes y no contesta preguntas hasta el 1°. Todo lo demás
        del sistema anda igual, y lo que recuerda se sigue viendo y olvidando desde acá.
      </div>
    )
  }
  return (
    <div className="aviso atencion" role="status">
      <p style={{ margin: 0 }}>
        <span className="fuerte">Migue está apagado y no contesta preguntas.</span> Lo que recuerda
        se sigue viendo y olvidando desde acá. Para prenderlo, quien administra el despliegue tiene
        que arreglar esto:
      </p>
      <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
        {estado.motivos.map((m) => <li key={m}>{m}</li>)}
      </ul>
    </div>
  )
}

/**
 * «Olvidar» abre la confirmación en la misma fila, y el aviso va antes del
 * botón que hace algo: olvidar un recuerdo cierra conversaciones, y quien lo
 * toca tiene que saberlo antes y no enterarse cuando le desaparece la charla.
 */
function Olvidar({ recuerdo, delPunto }: { recuerdo: Recuerdo; delPunto: boolean }) {
  return (
    <details className={comunes.confirmar}>
      <summary>Olvidar</summary>
      <div className={comunes.confirmarCuerpo}>
        <span>
          Migue lo olvida, y además cierra y vacía las conversaciones donde lo tenía presente
          {delPunto ? ', también las que estén abiertas en el celular del punto' : ''}. Lo escrito
          en ellas no se puede recuperar.
        </span>
        <form action={olvidar}>
          <input type="hidden" name="id" value={recuerdo.id} />
          <button type="submit" className="boton peligro chico">Sí, que lo olvide</button>
        </form>
      </div>
    </details>
  )
}

function ListaDeRecuerdos({ recuerdos, delPunto }: { recuerdos: Recuerdo[]; delPunto: boolean }) {
  return (
    <ul className="lista">
      {recuerdos.map((r) => (
        <li key={r.id} className={estilos.recuerdo}>
          <div className={estilos.texto}>
            <span className="fuerte">{r.texto}</span>
            <span className="menor gris">Lo recuerda desde el {r.desde}</span>
          </div>
          <Olvidar recuerdo={r} delPunto={delPunto} />
        </li>
      ))}
    </ul>
  )
}

function Decidir({ expresion, estado, rotulo, clase = '' }: {
  expresion: Expresion
  estado: 'aprobada' | 'descartada'
  rotulo: string
  clase?: string
}) {
  return (
    <form action={revisar}>
      <input type="hidden" name="id" value={expresion.id} />
      <input type="hidden" name="estado" value={estado} />
      <button type="submit" className={`boton chico ${clase}`.trim()}>{rotulo}</button>
    </form>
  )
}

/** Las columnas que comparten las dos tablas de palabras. */
function CeldasDeExpresion({ e }: { e: Expresion }) {
  return (
    <>
      <th scope="row" className={estilos.expresion}>
        <span className="fuerte">«{e.expresion}»</span>
      </th>
      <td data-rotulo="Lo que Migue cree que significa" className={estilos.significado}>{e.significado}</td>
      <td data-rotulo="Se refiere a">
        {e.seRefiereA}
        {!e.llegaAMigue && (
          <>
            {' '}
            <span className="chip anulado" title="Lo que nombra no está en la lista de hoy, así que no llega a ninguna conversación.">
              no está en la lista
            </span>
          </>
        )}
      </td>
      <td data-rotulo="Veces" className="numero">{numero(e.veces)}</td>
      <td data-rotulo="Dónde se escuchó">
        {e.dondeSeEscucho}
        <span className="menor gris" style={{ display: 'block' }}>
          {e.ultimaVez === e.primeraVez
            ? `el ${e.primeraVez}`
            : `la primera vez el ${e.primeraVez}, la última el ${e.ultimaVez}`}
        </span>
      </td>
    </>
  )
}

function EncabezadoDeExpresiones() {
  return (
    <thead>
      <tr>
        <th>Expresión</th>
        <th>Lo que Migue cree que significa</th>
        <th>Se refiere a</th>
        <th style={{ textAlign: 'right' }}>Veces</th>
        <th>Dónde se escuchó</th>
        <th><span className="sr-solo">Acciones</span></th>
      </tr>
    </thead>
  )
}

function Gasto({ gasto }: { gasto: GastoDelMes }) {
  const nivel = gasto.porcentaje === null ? undefined
    : gasto.porcentaje >= 100 ? 'tope'
      : gasto.porcentaje >= 80 ? 'alto'
        : undefined
  const filas = [...(gasto.coordinacion.preguntas ? [gasto.coordinacion] : []), ...gasto.puntos]

  return (
    <section className="tarjeta pila">
      <div className="pila-chica">
        <h2>Lo que gastó Migue en {gasto.mes.toLowerCase()}</h2>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Cada pregunta le cuesta a la Municipalidad lo que cobra el proveedor por leerla y
          contestarla. Llegado el tope del mes, Migue deja de contestar hasta el 1° y todo lo demás
          del sistema sigue igual.
        </p>
      </div>

      <div className="pila-chica">
        <p className="cifras" style={{ margin: 0 }}>
          <span className={estilos.cifra}>{dolares(gasto.gastadoUsd)}</span>
          {gasto.topeUsd !== null && gasto.porcentaje !== null ? (
            <span className="gris">
              {' '}de {dolares(gasto.topeUsd, 2)} · {porcentaje(gasto.porcentaje)} del tope
            </span>
          ) : (
            <span className="gris"> · sin tope cargado</span>
          )}
        </p>
        {gasto.porcentaje !== null && (
          <div className={estilos.medidor} aria-hidden="true">
            <div
              className={estilos.relleno}
              data-nivel={nivel}
              style={{ width: `${Math.min(gasto.porcentaje, 100)}%` }}
            />
          </div>
        )}
        <p className="menor" style={{ margin: 0 }}>
          {gasto.preguntas === 0
            ? 'Todavía nadie le preguntó nada este mes.'
            : <>
                {numero(gasto.preguntas)} {gasto.preguntas === 1 ? 'pregunta' : 'preguntas'} ·{' '}
                {dolares(gasto.promedioUsd ?? 0, 4)} por pregunta, en promedio
              </>}
        </p>
      </div>

      {gasto.topeDiarioDeUnPuntoUsd !== null && gasto.topeDiarioDeCoordinacionUsd !== null && (
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Para que nadie se coma el mes de los demás, en un mismo día cada punto puede gastar hasta{' '}
          {dolares(gasto.topeDiarioDeUnPuntoUsd, 2)} y cada coordinadora hasta{' '}
          {dolares(gasto.topeDiarioDeCoordinacionUsd, 2)}.
        </p>
      )}

      {filas.length > 0 && (
        <div className="desplazable tabla-ficha">
          <table className="datos">
            <caption className="sr-solo">Lo gastado este mes por la coordinación y por cada punto.</caption>
            <thead>
              <tr>
                <th>Quién preguntó</th>
                <th style={{ textAlign: 'right' }}>Preguntas</th>
                <th style={{ textAlign: 'right' }}>Gastado</th>
                <th style={{ textAlign: 'right' }}>Por pregunta</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.codigo ?? 'coordinacion'}>
                  <th scope="row" style={{ fontWeight: 400 }}>
                    <span className={estilos.grupo}>
                      {f.codigo && <span className={estilos.codigo}>{f.codigo}</span>}
                      <span className="fuerte">{f.rotulo}</span>
                    </span>
                  </th>
                  <td data-rotulo="Preguntas" className="numero">{numero(f.preguntas)}</td>
                  <td data-rotulo="Gastado" className="numero">{dolares(f.gastadoUsd, 4)}</td>
                  <td data-rotulo="Por pregunta" className="numero">
                    {f.promedioUsd === null ? '—' : dolares(f.promedioUsd, 4)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Todo el mes</th>
                <td data-rotulo="Preguntas" className="numero">{numero(gasto.preguntas)}</td>
                <td data-rotulo="Gastado" className="numero">{dolares(gasto.gastadoUsd, 4)}</td>
                <td data-rotulo="Por pregunta" className="numero">
                  {gasto.promedioUsd === null ? '—' : dolares(gasto.promedioUsd, 4)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

/** Una tabla por clase de evento: punto por fila, semana por columna. */
function TablaDeSemanas({ eventos, titulo, cuantos }: {
  eventos: EventosRecientes
  titulo: string
  cuantos: (f: EventosRecientes['filas'][number]) => number[]
}) {
  const filas = eventos.filas.filter((f) => cuantos(f).some((n) => n > 0))
  if (!filas.length) return null

  return (
    <div className="desplazable tabla-ficha">
      <table className="datos">
        <caption className="sr-solo">{titulo}, por semana, en las últimas cuatro semanas.</caption>
        <thead>
          <tr>
            <th>{titulo}</th>
            {eventos.semanas.map((s) => (
              <th key={s.lunes} style={{ textAlign: 'right' }}>
                Semana del {s.rotulo}
                {s.enCurso && <span className={estilos.enCurso}> · en curso</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.codigo ?? 'coordinacion'}>
              <th scope="row" style={{ fontWeight: 400 }}>
                <span className={estilos.grupo}>
                  {f.codigo && <span className={estilos.codigo}>{f.codigo}</span>}
                  <span className="fuerte">{f.nombre}</span>
                </span>
              </th>
              {cuantos(f).map((n, i) => (
                <td
                  key={eventos.semanas[i].lunes}
                  data-rotulo={`Semana del ${eventos.semanas[i].rotulo}${eventos.semanas[i].enCurso ? ' · en curso' : ''}`}
                  className={`numero ${n > 0 ? 'fuerte' : 'gris'}`}
                >
                  {numero(n)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── La pantalla ─────────────────────────────────────────────────────────

export default async function LoQueMigueRecuerda({
  searchParams,
}: {
  searchParams: Promise<Parametros>
}) {
  const sesion = await exigirPanel()

  const sp = await searchParams
  const aviso = uno(sp.aviso)
  const detalle = uno(sp.detalle)

  const pantalla = await pantallaDeCoordinacion(sesion)

  if (!pantalla) {
    return (
      <div className="pila">
        <h1>Lo que Migue recuerda</h1>
        <div className="aviso atencion">
          Esta base todavía no tiene lo de Migue: falta aplicar la migración 0025. Hasta entonces
          Migue no existe, y no recuerda nada de nadie.
        </div>
      </div>
    )
  }

  const { estado, propios, puntos, propuestas, aprobadas, gasto, eventos } = pantalla
  const huboCortes = eventos.filas.some((f) => f.cortes.some((n) => n > 0))
  const huboSinRespaldo = eventos.filas.some((f) => f.sinRespaldo.some((n) => n > 0))

  return (
    <div className="pila">
      <header className="pila-chica">
        <div className="fila-entre">
          <div className="fila">
            <Retrato tamano="titulo" />
            <h1>Lo que Migue recuerda</h1>
          </div>
          <Link href="/migue" className="boton secundario chico">Volver a Migue</Link>
        </div>
        <p className="gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Lo que le pidieron que recuerde, vos y cada punto, y las palabras que va aprendiendo.
          Todo lo que Migue recuerda se ve acá y se olvida acá. Las conversaciones, en cambio, no
          están en esta pantalla: son de quien las tuvo, y tampoco la coordinación las lee.
        </p>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Lo que se conversa no queda: las charlas de coordinación se vacían solas a los{' '}
          {numero(DIAS_DE_CONVERSACION_DE_COORDINACION)} días y las de los puntos a las{' '}
          {numero(HORAS_DE_CONVERSACION_DEL_PUNTO)} horas. Lo de abajo queda hasta que alguien lo
          olvide.
        </p>
      </header>

      <AvisoDeEstado estado={estado} />

      {AVISOS[aviso] && <div className="aviso exito" role="status">{AVISOS[aviso]}</div>}
      {aviso === 'error' && (
        <div className="aviso error" role="alert">{detalle || 'No se pudo. Probá de nuevo.'}</div>
      )}

      {/* ── Palabras para revisar ─────────────────────────────────────── */}

      {propuestas.length > 0 && (
        <section className="pila-chica" id="vocabulario">
          <div className="fila-entre">
            <h2>Palabras para revisar</h2>
            <span className="menor gris">
              {numero(propuestas.length)} {propuestas.length === 1 ? 'propuesta' : 'propuestas'}
            </span>
          </div>
          <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
            Cuando alguien nombra algo de una forma que Migue no tenía anotada y la entiende por el
            contexto, la propone acá. No entra sola: si la aprobás, la van a usar todas las
            conversaciones nuevas, de coordinación y de cada punto. Aprobá sólo lo que esté bien
            entendido, y descartá cualquier cosa que no sea una forma de nombrar algo: una palabra
            aprobada es una regla para todos.
          </p>
          <div className="desplazable tabla-ficha">
            <table className="datos">
              <caption className="sr-solo">Palabras que Migue propone y esperan que alguien las revise.</caption>
              <EncabezadoDeExpresiones />
              <tbody>
                {propuestas.map((e) => (
                  <tr key={e.id}>
                    <CeldasDeExpresion e={e} />
                    <td className={comunes.columnaAcciones}>
                      <div className={comunes.acciones}>
                        {/* Aprobar algo que no está en la lista no haría nada: al
                            abrir una conversación, leerCatalogo() la deja afuera. */}
                        {e.llegaAMigue && (
                          <Decidir expresion={e} estado="aprobada" rotulo="Aprobar" />
                        )}
                        <Decidir expresion={e} estado="descartada" rotulo="Descartar" clase="secundario" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Lo que recuerda ───────────────────────────────────────────── */}

      <section className="pila-chica">
        <div className="fila-entre">
          <h2>De vos</h2>
          <span className="menor gris">
            {numero(propios.length)} de {numero(RECUERDOS_MAXIMOS)}
          </span>
        </div>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Lo que le pediste que recuerde. Entra en cada conversación nueva tuya, y nadie más lo ve.
          Olvidar algo también cierra y vacía las conversaciones donde Migue lo tenía presente: la
          que lo guardó y las que se abrieron mientras lo recordaba.
        </p>
        {propios.length === 0 ? (
          <ul className="lista">
            <li className="vacio">
              No te recuerda nada. Si querés que tenga algo presente cada vez, pedíselo en la
              conversación: «acordate de que…».
            </li>
          </ul>
        ) : (
          <ListaDeRecuerdos recuerdos={propios} delPunto={false} />
        )}
      </section>

      <section className="pila-chica">
        <h2>De cada punto</h2>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Lo que pidió recordar cada punto: cómo se nombran las cosas ahí, qué pasa qué día. Es del
          punto y no de una persona —la cuenta la comparten los que rotan— y entra en cada
          conversación nueva de ese punto. Si lo olvidás desde acá, el punto deja de verlo en el
          celular, y se cierran y vacían las conversaciones donde Migue lo tenía presente.
        </p>
        {puntos.length === 0 ? (
          <ul className="lista">
            <li className="vacio">Ningún punto le pidió a Migue que recuerde nada.</li>
          </ul>
        ) : (
          puntos.map((g) => (
            <div key={g.codigo} className="pila-chica" style={{ marginTop: 8 }}>
              <div className="fila-entre">
                <h3 className={estilos.grupo}>
                  <span className={estilos.codigo}>{g.codigo}</span>
                  <span>{g.nombre}</span>
                </h3>
                <span className="menor gris">
                  {numero(g.recuerdos.length)} de {numero(RECUERDOS_MAXIMOS)}
                </span>
              </div>
              <ListaDeRecuerdos recuerdos={g.recuerdos} delPunto />
            </div>
          ))
        )}
      </section>

      {/* ── Palabras aprobadas ────────────────────────────────────────── */}

      <section className="pila-chica" id={propuestas.length ? undefined : 'vocabulario'}>
        <div className="fila-entre">
          <h2>Palabras que ya usa</h2>
          <span className="menor gris">
            {numero(aprobadas.length)} {aprobadas.length === 1 ? 'aprobada' : 'aprobadas'}
          </span>
        </div>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Las que aprobó la coordinación. Entran en cada conversación nueva, así que Migue entiende
          «la del Inca» en cualquier punto aunque se haya escuchado en uno solo.
        </p>
        {aprobadas.length === 0 ? (
          <ul className="lista">
            <li className="vacio">
              Todavía no hay ninguna. Las que Migue proponga van a aparecer arriba para revisar.
            </li>
          </ul>
        ) : (
          <div className="desplazable tabla-ficha">
            <table className="datos">
              <caption className="sr-solo">Palabras aprobadas que Migue usa en las conversaciones nuevas.</caption>
              <EncabezadoDeExpresiones />
              <tbody>
                {aprobadas.map((e) => (
                  <tr key={e.id}>
                    <CeldasDeExpresion e={e} />
                    <td className={comunes.columnaAcciones}>
                      {/* Con confirmación, a diferencia de descartar una propuesta:
                          desde acá no se puede volver a aprobarla, y si Migue la
                          escucha de nuevo suma una vez pero sigue descartada. */}
                      <details className={comunes.confirmar}>
                        <summary>Dejar de usarla</summary>
                        <div className={comunes.confirmarCuerpo}>
                          <span>
                            Las conversaciones nuevas ya no la van a recibir. Después no se puede
                            volver a aprobar desde esta pantalla.
                          </span>
                          <Decidir expresion={e} estado="descartada" rotulo="Sí, que no la use" clase="peligro" />
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Lo que gasta ──────────────────────────────────────────────── */}

      <Gasto gasto={gasto} />

      {/* ── Cortes por punto ──────────────────────────────────────────── */}

      <section className="pila-chica">
        <h2>Conversaciones cortadas, por punto</h2>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Si alguien trata mal a Migue, él pide una vez, con calma, que no lo traten así; si sigue,
          corta la conversación, y se puede empezar otra enseguida. Acá se cuenta cuántas veces pasó en cada
          punto, por semana y nada más: ni la hora, ni quién, ni qué se dijo. Un punto que acumula
          cortes casi nunca es un problema de conducta: suele ser que la app le está haciendo perder
          tiempo, y eso es lo que hay que ir a mirar.
        </p>
        {huboCortes ? (
          <TablaDeSemanas eventos={eventos} titulo="Cortes" cuantos={(f) => f.cortes} />
        ) : (
          <ul className="lista">
            <li className="vacio">En las últimas cuatro semanas no se cortó ninguna conversación.</li>
          </ul>
        )}

        {huboSinRespaldo && (
          <>
            <p className="menor gris" style={{ margin: '8px 0 0', maxWidth: 'var(--ancho-lectura)' }}>
              Números sin respaldo: veces que Migue escribió un número que no salía de ninguna
              consulta y el control lo atajó. Si se repite en un mismo lugar, hay una pregunta que
              Migue todavía no sabe contestar bien.
            </p>
            <TablaDeSemanas eventos={eventos} titulo="Números sin respaldo" cuantos={(f) => f.sinRespaldo} />
          </>
        )}
      </section>
    </div>
  )
}
