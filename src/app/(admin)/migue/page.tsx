import Link from 'next/link'
import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import Conversacion from '@/app/_migue/Conversacion'
import estilos from '@/app/_migue/conversacion.module.css'
import { Retrato } from '@/app/_migue/Retrato'
import { fechaHora, numero } from '@/lib/formato'
import { leerConfiguracion, migueEstaInstalado } from '@/lib/migue/configuracion'
import {
  conversacionGuardadaEnTx, estadoDeLaConversacionEnTx, type ConversacionAnterior, type DuenoDeLaConversacion,
  type MotivoDeCierre,
} from '@/lib/migue/historial'
import { DIAS_DE_CONVERSACION_DE_COORDINACION } from '@/lib/reglas'
import { exigirPanel } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

type Parametros = Record<string, string | string[] | undefined>

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()

/**
 * Preguntas para arrancar. Son de las que el relevamiento encontró que la
 * coordinación hace de verdad, y cada una cae en una pantalla que ya existe:
 * un ejemplo que Migue no puede contestar enseña, de entrada, a no creerle.
 */
const EJEMPLOS = [
  '¿Qué puntos hace días que no cargan nada?',
  '¿Cuánto entró a la Planta el mes pasado?',
  '¿Qué pedidos de recambio están demorados?',
  '¿Cuántas salidas no dicen de qué pila salieron?',
]

/** Lo que dice cada cierre en la lista de las anteriores. Los que no se nombran no llevan marca. */
const CIERRE_EN_LA_LISTA: Partial<Record<MotivoDeCierre, string>> = {
  larga: 'se hizo larga',
  error: 'se cortó por un error',
  maltrato: 'se cortó',
}

const preguntas = (turnos: number) => (turnos === 1 ? '1 pregunta' : `${numero(turnos)} preguntas`)

/** «28/09/2026 · 10:25 · 3 preguntas · se hizo larga»: cuándo fue la última, y cómo terminó si hace falta decirlo. */
function pieDeAnterior(a: Pick<ConversacionAnterior, 'actualizadaEn' | 'turnos' | 'cerradaPor'>): string {
  const cierre = a.cerradaPor ? CIERRE_EN_LA_LISTA[a.cerradaPor] : undefined
  return [fechaHora(a.actualizadaEn), preguntas(a.turnos), cierre].filter(Boolean).join(' · ')
}

export default async function PantallaMigue({
  searchParams,
}: {
  searchParams: Promise<Parametros>
}) {
  const sesion = await exigirPanel()
  const dueno: DuenoDeLaConversacion = { rol: 'admin', perfilId: sesion.perfilId }

  const sp = await searchParams
  const ver = uno(sp.ver)
  const olvidada = uno(sp.olvidada) === '1'

  // Primero si la 0025 está: el build puede llegar a Vercel antes de que
  // alguien pegue el SQL en Supabase, y nombrar migue_conversaciones sin ella
  // rompería la pantalla en vez de esconderla. Lo demás va encauzado sobre el
  // mismo `tx`, en una sola transacción.
  const datos = await conSesion(sesion, async (tx) => {
    if (!(await migueEstaInstalado(tx))) return null
    const [estado, guardada, [propuestas]] = await Promise.all([
      estadoDeLaConversacionEnTx(tx, dueno),
      ver ? conversacionGuardadaEnTx(tx, dueno, ver) : Promise.resolve(null),
      // Las palabras que esperan revisión. El número de la barra está en
      // «Migue», que es esta pantalla, pero la revisión es en la de al lado: sin
      // esto, quien entra por el número no encuentra qué revisar.
      tx.consultar<{ total: number }>(
        `select count(*)::int as total from migue_expresiones where estado = 'propuesta'`,
      ),
    ])
    return { estado, guardada, propuestas: propuestas?.total ?? 0 }
  })
  if (!datos) redirect('/tablero')

  const { estado, guardada, propuestas } = datos
  const config = leerConfiguracion()

  // Apagado no es escondido: sin clave o con el tope de gasto mal puesto,
  // Migue no contesta, pero lo que ya se habló se sigue viendo y se puede
  // olvidar. La coordinación es quien lo puede arreglar, así que acá sí se
  // dice qué falta con el nombre de la variable.
  const apagado = config.problemas.length > 0
    ? { titulo: 'Migue no está contestando. Falta arreglar esto en la configuración:', detalle: config.problemas }
    : null

  const privacidad =
    `Tus conversaciones son sólo tuyas y se borran solas a los ${numero(DIAS_DE_CONVERSACION_DE_COORDINACION)} días.`

  return (
    <div className="pila">
      <header className="pila-chica">
        <div className="fila-entre">
          <div className="fila">
            <Retrato tamano="titulo" />
            <h1>Preguntale a Migue</h1>
          </div>
          <Link href="/migue/recuerdos" className="boton secundario chico">
            Lo que recuerda y el vocabulario
            {propuestas > 0 && (
              <span className="chip pendiente">
                {numero(propuestas)} {propuestas === 1 ? 'palabra para revisar' : 'palabras para revisar'}
              </span>
            )}
          </Link>
        </div>
        <p className="gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Migue contesta con los mismos datos y las mismas cuentas que las pantallas del panel. Cada
          número viene con el botón a la pantalla que lo calcula, para que lo mires ahí antes de
          usarlo. Sólo lee: no carga, no anula ni cambia nada.
        </p>
      </header>

      {olvidada && !ver && (
        <div className="aviso exito" role="status">Listo: esa conversación se olvidó.</div>
      )}

      {ver && !guardada && (
        <div className="aviso atencion">
          Esa conversación ya no está: se olvidó, venció o no es tuya. Abajo está la de ahora.
        </div>
      )}

      <div className={estilos.disposicion}>
        <section className="pila">
          {guardada ? (
            <>
              <div className="fila-entre">
                <div>
                  <h2>Conversación del {fechaHora(guardada.creadaEn)}</h2>
                  <p className="menor gris" style={{ margin: 0 }}>
                    {[
                      preguntas(guardada.turnos),
                      `la última el ${fechaHora(guardada.actualizadaEn)}`,
                      guardada.cerradaPor ? CIERRE_EN_LA_LISTA[guardada.cerradaPor] : undefined,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Link href="/migue" className="boton secundario chico">Volver a la de ahora</Link>
              </div>
              {/* La key obliga a montarla de nuevo al pasar de una a otra: el
                  chat toma lo que trae el servidor sólo al montar. */}
              <Conversacion
                key={guardada.id}
                rol="admin"
                dueno={sesion.perfilId}
                inicial={{ conversacionId: guardada.id, cerrada: null, mensajes: guardada.mensajes, anteriores: [] }}
                privacidad={privacidad}
                apagado={apagado}
                ejemplos={[]}
                soloLectura
              />
            </>
          ) : (
            <Conversacion
              key="la-de-ahora"
              rol="admin"
              dueno={sesion.perfilId}
              inicial={estado}
              privacidad={privacidad}
              apagado={apagado}
              ejemplos={EJEMPLOS}
            />
          )}
        </section>

        <aside className={`pila-chica ${estilos.lateral}`} aria-label="Conversaciones anteriores">
          <h2>Conversaciones anteriores</h2>
          {estado.anteriores.length === 0 ? (
            <p className="menor gris" style={{ margin: 0 }}>
              Todavía no hay ninguna. Cuando empieces de nuevo, la de ahora queda acá.
            </p>
          ) : (
            <ul className="lista">
              {estado.anteriores.map((a) => {
                const elegida = guardada?.id === a.id
                return (
                  <li key={a.id} className={elegida ? estilos.elegida : undefined}>
                    <Link
                      href={`/migue?ver=${a.id}`}
                      className={estilos.enlaceAnterior}
                      aria-current={elegida ? 'page' : undefined}
                    >
                      <span className={estilos.tituloAnterior}>{a.titulo}</span>
                      <span className="menor gris">{pieDeAnterior(a)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="menor gris" style={{ margin: 0 }}>
            Cada una se borra sola a los {numero(DIAS_DE_CONVERSACION_DE_COORDINACION)} días de su
            última pregunta. No las lee nadie más, tampoco otra cuenta de coordinación; y las de los
            puntos no se ven desde acá.
          </p>
        </aside>
      </div>
    </div>
  )
}
