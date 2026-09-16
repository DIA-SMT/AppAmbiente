import type { CSSProperties } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import { contenedoresDelSitio, pedidosDeRecambio } from '@/lib/datos'
import { claveDeCalendario, fechaDeCalendario, paraInputFechaHora } from '@/lib/formato'
import { sesionActual } from '@/lib/sesion'
import type { PedidoRecambio } from '@/lib/tipos'
import BotonPedido, { type PedidoAbierto } from './BotonPedido'
import estilos from './contenedores.module.css'

export const dynamic = 'force-dynamic'

/**
 * Hace cuánto se pidió, escrito como lo diría alguien: "hace 4 horas",
 * "hace 2 días". Sale de las horas que ya calculó la vista y no de restar
 * fechas acá, así el número es el mismo que ve la coordinación en su pantalla.
 */
function esperaEscrita(horas: number): string {
  if (!Number.isFinite(horas) || horas < 0) return 'Pedido'
  if (horas < 1) return 'Pedido recién'
  if (horas < 24) {
    const h = Math.floor(horas)
    return `Pedido hace ${h} ${h === 1 ? 'hora' : 'horas'}`
  }
  const d = Math.floor(horas / 24)
  return `Pedido hace ${d} ${d === 1 ? 'día' : 'días'}`
}

/**
 * Cuántos días pasaron desde una fecha de calendario.
 *
 * `ultima_retirada` es un `date`: no tiene hora ni zona. Las dos puntas se
 * comparan como aaaa-mm-dd —la de hoy, en Tucumán— y recién ahí se restan, que
 * es la única forma de que un retiro de ayer no se lea como de hace dos días.
 */
function diasDesdeCalendario(valor: string | null): number | null {
  const clave = claveDeCalendario(valor)
  if (!clave) return null
  const dia = Date.parse(`${clave}T00:00:00Z`)
  const hoy = Date.parse(`${paraInputFechaHora().slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(dia) || Number.isNaN(hoy)) return null
  return Math.round((hoy - dia) / 86_400_000)
}

/** "Último retiro: 12/09/2026 · hace 4 días". */
function ultimoRetiro(valor: string | null): string {
  if (!valor) return 'Último retiro: sin registro'
  const dias = diasDesdeCalendario(valor)
  const cuando =
    dias === null || dias < 0 ? null
      : dias === 0 ? 'hoy'
        : dias === 1 ? 'ayer'
          : `hace ${dias} días`
  return `Último retiro: ${fechaDeCalendario(valor)}${cuando ? ` · ${cuando}` : ''}`
}

/** Lo que la pantalla necesita saber del pedido abierto de un contenedor. */
function comoAbierto(pedido: PedidoRecambio, perfilId: string): PedidoAbierto {
  const horas = Number(pedido.horas_totales)
  return {
    id: pedido.id,
    espera: pedido.estado === 'avisado'
      ? `${esperaEscrita(horas)} · la coordinación ya avisó`
      : esperaEscrita(horas),
    demorado: Boolean(pedido.demorado),
    // Las tres condiciones de la política que deja cancelar al vigilador. Si no
    // se cumplen, la base lo rechaza: mejor no ofrecer el botón. La tercera
    // importa cuando el pedido lo cargó la coordinación para este punto: ahí el
    // vigilador no puede cancelarlo y ofrecérselo sería mentirle.
    puedeCancelar:
      pedido.estado === 'pedido' &&
      pedido.pedido_por_id === perfilId &&
      Number.isFinite(horas) && horas < 24,
  }
}

export default async function Contenedores() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  const [sitio] = sesion.sitioId
    ? await consultarConSesion<{ nombre: string; tipo: string }>(
        sesion,
        'select nombre, tipo from sitios where id = $1',
        [sesion.sitioId],
      )
    : []

  // Los contenedores son de los puntos verdes. En la Planta esta pantalla no
  // existe, y por eso tampoco aparece el botón que lleva hasta acá.
  if (!sitio || sitio.tipo !== 'punto_verde') redirect('/turno')

  const [contenedores, pedidos] = await Promise.all([
    contenedoresDelSitio(sesion),
    pedidosDeRecambio(sesion, { estado: 'abiertos', sitioId: sesion.sitioId ?? undefined }),
  ])

  // Un contenedor no debería tener dos pedidos abiertos —pedir de nuevo no crea
  // otro—, pero si los tuviera manda el primero de la cola, que es el que la
  // coordinación va a atender.
  const porContenedor = new Map<string, PedidoRecambio>()
  for (const p of pedidos) {
    if (p.contenedor_id && !porContenedor.has(p.contenedor_id)) {
      porContenedor.set(p.contenedor_id, p)
    }
  }

  return (
    <div className="pila">
      <div className="fila-entre">
        <h1>Contenedores</h1>
        <Link href="/turno" className="boton fantasma chico">Volver</Link>
      </div>

      <p className="menor gris" style={{ margin: 0 }}>{sitio.nombre}</p>

      <div className="aviso">
        Lo que pedís acá lo ve la coordinación con la hora, y ella lo pasa a la empresa.
      </div>

      {contenedores.length === 0 ? (
        <div className="aviso atencion">
          Este punto no tiene contenedores cargados. Los carga la coordinadora desde el panel.
        </div>
      ) : (
        <ul className={estilos.tarjetas}>
          {contenedores.map((c) => {
            const pedido = porContenedor.get(c.id) ?? null
            const marca = { '--marca': c.material_color ?? 'var(--linea-fuerte)' } as CSSProperties

            return (
              <li key={c.id} className={`tarjeta pila-chica ${estilos.contenedor}`} style={marca}>
                <div className="fila-entre">
                  <h2 className="crecer">{c.material ?? c.codigo}</h2>
                  {pedido?.urgente && <span className={`chip ${estilos.urgencia}`}>Urgente</span>}
                </div>

                <p className="menor gris" style={{ margin: 0 }}>{ultimoRetiro(c.ultima_retirada)}</p>

                {pedido?.observaciones && (
                  <p className="menor gris" style={{ margin: 0 }}>Nota: {pedido.observaciones}</p>
                )}

                <BotonPedido
                  contenedorId={c.id}
                  corriente={c.material ?? c.codigo}
                  pedido={pedido ? comoAbierto(pedido, sesion.perfilId) : null}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
