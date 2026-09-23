import Link from 'next/link'
import { numero } from '@/lib/formato'
import { campoPorNombre, type Columna, type Recurso } from '@/lib/recursos'
import estilos from '../listas.module.css'
import { cambiarEstado } from './acciones'

type Fila = Record<string, unknown> & { id: string; activo: boolean }

/** Sin decimales cuando el número es entero: "12" y no "12,000". */
function numeroCorto(valor: unknown): string {
  const n = Number(valor)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? numero(n, 0) : numero(n, 2)
}

function Vacio({ texto }: { texto: string }) {
  return <span className="gris">{texto}</span>
}

function celda(recurso: Recurso, columna: Columna, fila: Fila) {
  const valor = fila[columna.nombre]
  const vacio = columna.vacio ?? '—'
  const etiquetasDeOpcion = campoPorNombre(recurso, columna.nombre)?.opciones ?? []
  const nombrar = (v: string) => etiquetasDeOpcion.find((o) => o.valor === v)?.etiqueta ?? v

  switch (columna.tipo) {
    case 'booleano':
      return valor ? <span className="fuerte">Sí</span> : <Vacio texto="No" />

    case 'opcion':
      return valor ? nombrar(String(valor)) : <Vacio texto={vacio} />

    case 'multi': {
      const lista = Array.isArray(valor) ? valor.map(String) : []
      return lista.length ? lista.map(nombrar).join(' · ') : <Vacio texto={vacio} />
    }

    case 'numeros': {
      const lista = Array.isArray(valor) ? valor : []
      return lista.length
        ? <span className="cifras">{lista.map(numeroCorto).join(' · ')}</span>
        : <Vacio texto={vacio} />
    }

    case 'numero':
      return valor === null || valor === undefined || valor === ''
        ? <Vacio texto={vacio} />
        : numeroCorto(valor)

    case 'color': {
      const color = String(valor ?? '')
      return (
        <span className={estilos.celdaColor}>
          <span className={estilos.muestra} style={{ background: color || 'transparent' }} />
          <span className="mono menor">{color || vacio}</span>
        </span>
      )
    }

    default:
      return valor ? String(valor) : <Vacio texto={vacio} />
  }
}

export default function TablaRecurso({
  recurso,
  filas,
  etiquetas,
  consulta,
}: {
  recurso: Recurso
  filas: Fila[]
  /** Campo con origen → id de la fila referida → cómo se llama. */
  etiquetas: Record<string, Record<string, string>>
  /** Filtro vigente, para no perderlo al editar o al cambiar el estado. */
  consulta: string
}) {
  if (!filas.length) {
    return (
      <ul className="lista">
        <li className="vacio">No hay nada que mostrar con este filtro.</li>
      </ul>
    )
  }

  // Diez columnas no entran en 390 px: en Materiales quedaban 710 px afuera y
  // los botones «Editar» y «Desactivar» no se veían nunca. Abajo de 720 px cada
  // fila pasa a ser una ficha; de 720 para arriba la tabla queda igual.
  return (
    <div className="desplazable tabla-ficha">
      <table className="datos">
        <thead>
          <tr>
            {recurso.columnas.map((columna) => (
              <th
                key={columna.nombre}
                className={
                  columna.tipo === 'numero' ? estilos.thNumero
                    : columna.tipo === 'mono' ? 'mono' : undefined
                }
              >
                {columna.etiqueta}
              </th>
            ))}
            <th>Estado</th>
            <th className={estilos.celdaAcciones}><span className="sr-solo">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => {
            const parametros = new URLSearchParams(consulta)
            parametros.set('editar', fila.id)

            return (
              <tr key={fila.id} className={fila.activo ? undefined : 'anulado'}>
                {recurso.columnas.map((columna) => {
                  const referidas = etiquetas[columna.nombre]
                  const contenido = columna.tipo === 'referencia'
                    ? (fila[columna.nombre]
                        ? referidas?.[String(fila[columna.nombre])] ?? 'Sin nombre'
                        : <Vacio texto={columna.vacio ?? '—'} />)
                    : celda(recurso, columna, fila)

                  return (
                    <td
                      key={columna.nombre}
                      data-rotulo={columna.etiqueta}
                      className={
                        columna.tipo === 'numero' ? 'numero'
                          : columna.tipo === 'mono' ? 'mono' : undefined
                      }
                    >
                      {contenido}
                    </td>
                  )
                })}

                <td data-rotulo="Estado">
                  {fila.activo
                    ? <span className="chip ingreso">Activo</span>
                    : <span className="chip pendiente">Desactivado</span>}
                </td>

                {/* Sin data-rotulo a propósito: en la ficha esta celda sale al
                    pie y a todo el ancho, que es donde se buscan los botones. */}
                <td className={estilos.celdaAcciones}>
                  <div className={estilos.acciones}>
                    <Link
                      className="boton chico secundario"
                      href={`/listas/${recurso.clave}?${parametros.toString()}#formulario`}
                    >
                      Editar
                    </Link>
                    <form action={cambiarEstado}>
                      <input type="hidden" name="recurso" value={recurso.clave} />
                      <input type="hidden" name="id" value={fila.id} />
                      <input type="hidden" name="activo" value={fila.activo ? 'no' : 'si'} />
                      <button
                        type="submit"
                        className={`boton chico ${fila.activo ? 'fantasma' : ''}`}
                      >
                        {fila.activo ? 'Desactivar' : 'Reactivar'}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
