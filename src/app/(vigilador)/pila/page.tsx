import Link from 'next/link'
import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import { pilasEnTx } from '@/lib/datos'
import { fecha, haceCuanto, numero } from '@/lib/formato'
import { sesionActual } from '@/lib/sesion'
import type { EstadoPila, FilaPila } from '@/lib/tipos'
import ControlRapido from './ControlRapido'
import estilos from './pila.module.css'

export const dynamic = 'force-dynamic'

const ETIQUETA_ESTADO: Record<EstadoPila, string> = {
  en_formacion: 'En formación',
  madurando: 'Madurando',
  lista: 'Lista',
  despachada: 'Despachada',
}

/**
 * Primero lo que todavía se trabaja. La consulta ordena por estado alfabético,
 * que pone la despachada arriba de todo: acá el orden es el del trabajo.
 */
const ORDEN_ESTADO: Record<EstadoPila, number> = {
  en_formacion: 0,
  madurando: 1,
  lista: 2,
  despachada: 3,
}

function diasDesde(valor: string | null): number | null {
  if (!valor) return null
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}

function plural(cuantos: number, uno: string, varios: string): string {
  return `${numero(cuantos)} ${cuantos === 1 ? uno : varios}`
}

/** "Sin voltear desde el 12/08/2025 · 34 días". */
function desdeCuando(pila: FilaPila): string {
  const desde = pila.ultimo_volteo ?? pila.fecha_cierre
  const dias = diasDesde(desde)
  const cola = dias === null ? '' : ` · ${plural(dias, 'día', 'días')}`
  return pila.ultimo_volteo
    ? `Sin voltear desde el ${fecha(pila.ultimo_volteo)}${cola}`
    : `Sin voltear desde que se cerró, el ${fecha(pila.fecha_cierre)}${cola}`
}

export default async function Pilas() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  // El tipo de sitio decide si esta pantalla existe, pero preguntarlo primero y
  // esperar la respuesta para recién ahí pedir las pilas son dos transacciones,
  // y cada una cuesta cuatro viajes a la base (BEGIN, poner la identidad, la
  // consulta, COMMIT) porque el pool serverless tiene una conexión sola. Las
  // dos adentro de la misma transacción se encauzan y viajan juntas: pedir las
  // pilas de más no agrega un viaje. Si el punto resulta verde se descartan y
  // se redirige igual, que es lo mismo que veía el vigilador antes.
  const [sitios, lista] = await conSesion(sesion, (tx) => Promise.all([
    sesion.sitioId
      ? tx.consultar<{ tipo: string }>(
          `select tipo from sitios where id = $1`, [sesion.sitioId],
        )
      : Promise.resolve([]),
    pilasEnTx(tx, { sitioId: sesion.sitioId ?? undefined }),
  ]))

  const sitio = sitios[0]

  // Las pilas son de la Planta. En un punto verde esta pantalla no existe, y
  // por eso tampoco aparece el botón que lleva hasta acá.
  if (sitio?.tipo === 'punto_verde') redirect('/turno')

  // La que hace tres semanas que no se voltea va arriba de todo: es el dato por
  // el que existe esta pantalla.
  const ordenadas = [...lista].sort(
    (a, b) =>
      Number(b.volteo_atrasado) - Number(a.volteo_atrasado) ||
      ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] ||
      a.codigo.localeCompare(b.codigo, 'es'),
  )
  const atrasadas = ordenadas.filter((p) => p.volteo_atrasado).length

  return (
    <div className="pila">
      <div className="fila-entre">
        <h1>Control de las pilas</h1>
        <Link href="/turno" className="boton fantasma chico">Volver</Link>
      </div>

      {atrasadas > 0 && (
        <div className="aviso atencion">
          {atrasadas === 1
            ? 'Hay 1 pila que hace más de tres semanas que no se voltea.'
            : `Hay ${atrasadas} pilas que hace más de tres semanas que no se voltean.`}
        </div>
      )}

      {ordenadas.length === 0 ? (
        <div className="aviso">
          Este punto no tiene pilas cargadas. Las abre la coordinadora desde el panel.
        </div>
      ) : (
        <ul className={estilos.tarjetas}>
          {ordenadas.map((p) => {
            const volteos = Number(p.volteos) || 0
            const riegos = Number(p.riegos) || 0
            const dias = p.dias_desde_armado === null ? null : Number(p.dias_desde_armado)

            return (
              <li
                key={p.id}
                className={`tarjeta pila-chica ${p.volteo_atrasado ? estilos.atrasada : ''}`}
              >
                <div className="fila-entre">
                  <h2>{p.codigo}</h2>
                  <span className="chip">{ETIQUETA_ESTADO[p.estado]}</span>
                </div>

                {p.volteo_atrasado && (
                  <div className="fila">
                    <span className={`chip ${estilos.atraso}`}>Falta voltear</span>
                    <span className="menor crecer">{desdeCuando(p)}</span>
                  </div>
                )}

                <p className="menor gris" style={{ margin: 0 }}>
                  {[
                    dias === null ? null : `Lleva ${plural(dias, 'día', 'días')}`,
                    plural(volteos, 'volteo', 'volteos'),
                    plural(riegos, 'riego', 'riegos'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>

                <p className="menor gris" style={{ margin: 0 }}>
                  {p.ultimo_volteo
                    ? `Último volteo: ${haceCuanto(p.ultimo_volteo)}`
                    : 'Todavía no se volteó'}
                </p>

                <ControlRapido pilaId={p.id} />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
