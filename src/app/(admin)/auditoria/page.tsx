import Link from 'next/link'
import { conSesion } from '@db/sesion'
import { fechaHora, numero } from '@/lib/formato'
import { exigirPanel } from '@/lib/sesion'
import estilos from '../gente.module.css'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50

const ACCIONES: Record<string, { rotulo: string; chip: string }> = {
  insert: { rotulo: 'Alta', chip: 'chip ingreso' },
  update: { rotulo: 'Cambio', chip: 'chip diferida' },
  anular: { rotulo: 'Anulación', chip: 'chip anulado' },
  eliminar: { rotulo: 'Eliminación', chip: 'chip anulado' },
}

const TABLAS: Record<string, string> = {
  movimientos: 'Movimiento',
  vecinos: 'Vecino',
  entidades: 'Entidad',
  materiales: 'Material',
  perfiles: 'Usuario',
}

interface FilaAuditoria {
  id: string
  creado_en: string
  tabla: string
  registro_id: string
  accion: string
  actor_rol: string | null
  actor_nombre: string | null
  actor_usuario: string | null
  movimiento_numero: number | null
  etiqueta: string | null
  motivo: string | null
}

type Busqueda = Record<string, string | string[] | undefined>

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? ''
}

export default async function PantallaAuditoria({
  searchParams,
}: {
  searchParams: Promise<Busqueda>
}) {
  const sesion = await exigirPanel()

  const parametros = await searchParams
  const accion = ACCIONES[texto(parametros.accion)] ? texto(parametros.accion) : ''
  const tabla = TABLAS[texto(parametros.tabla)] ? texto(parametros.tabla) : ''
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(texto(parametros.desde)) ? texto(parametros.desde) : ''
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(texto(parametros.hasta)) ? texto(parametros.hasta) : ''
  const pagina = Math.max(Number(texto(parametros.pagina)) || 1, 1)

  const valores: unknown[] = []
  const par = (valor: unknown) => `$${valores.push(valor)}`
  const condiciones: string[] = []
  if (accion) condiciones.push(`a.accion = ${par(accion)}`)
  if (tabla) condiciones.push(`a.tabla = ${par(tabla)}`)
  // Los rangos se leen en hora de Tucumán, que es lo que ve la coordinadora.
  if (desde) condiciones.push(`a.creado_en >= (${par(desde)}::date at time zone 'America/Argentina/Tucuman')`)
  if (hasta) condiciones.push(`a.creado_en < ((${par(hasta)}::date + 1) at time zone 'America/Argentina/Tucuman')`)
  const donde = condiciones.length ? `where ${condiciones.join(' and ')}` : ''

  const { filas, total, actual } = await conSesion(sesion, async (tx) => {
    const [conteo] = await tx.consultar<{ total: number }>(
      `select count(*)::int as total from auditoria a ${donde}`,
      valores,
    )
    const total = conteo?.total ?? 0
    // Si la página pedida se pasó del final, se muestra la última que existe.
    const actual = Math.min(pagina, Math.max(Math.ceil(total / POR_PAGINA), 1))
    const filas = await tx.consultar<FilaAuditoria>(
      `select a.id::text as id, a.creado_en, a.tabla, a.registro_id, a.accion, a.actor_rol,
              p.nombre as actor_nombre, p.usuario as actor_usuario,
              m.numero::int as movimiento_numero,
              -- Una eliminación no tiene "después": el nombre de lo que se fue
              -- está en "antes" y es lo único que la vuelve legible.
              coalesce(a.despues ->> 'nombre', a.despues ->> 'usuario', a.despues ->> 'patente',
                       a.antes ->> 'nombre', a.antes ->> 'usuario') as etiqueta,
              a.despues ->> 'motivo_anulacion' as motivo
         from auditoria a
         left join perfiles p on p.id = a.actor_id
         left join movimientos m on a.tabla = 'movimientos' and m.id = a.registro_id
         ${donde}
        order by a.creado_en desc, a.id desc
        limit ${POR_PAGINA} offset ${(actual - 1) * POR_PAGINA}`,
      valores,
    )
    return { filas, total, actual }
  })

  const paginas = Math.max(Math.ceil(total / POR_PAGINA), 1)
  const primero = total === 0 ? 0 : (actual - 1) * POR_PAGINA + 1
  const ultimo = Math.min(actual * POR_PAGINA, total)

  const enlace = (destino: number) => {
    const p = new URLSearchParams()
    if (accion) p.set('accion', accion)
    if (tabla) p.set('tabla', tabla)
    if (desde) p.set('desde', desde)
    if (hasta) p.set('hasta', hasta)
    if (destino > 1) p.set('pagina', String(destino))
    const cadena = p.toString()
    return cadena ? `/auditoria?${cadena}` : '/auditoria'
  }

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Auditoría</h1>
        <p className="menor gris">
          Qué se cargó, qué se cambió, qué se anuló, qué usuario se eliminó, quién y cuándo.
        </p>
      </header>

      <div className="aviso">
        Nadie puede editar ni borrar una línea de acá: tampoco la coordinación.
      </div>

      <form method="get" className={estilos.filtros}>
        <div className={`campo ${estilos.filtro}`}>
          <label htmlFor="accion">Acción</label>
          <select id="accion" name="accion" className="control" defaultValue={accion}>
            <option value="">Todas</option>
            {Object.entries(ACCIONES).map(([clave, a]) => (
              <option key={clave} value={clave}>{a.rotulo}</option>
            ))}
          </select>
        </div>

        <div className={`campo ${estilos.filtro}`}>
          <label htmlFor="tabla">Sobre qué</label>
          <select id="tabla" name="tabla" className="control" defaultValue={tabla}>
            <option value="">Todo</option>
            {Object.entries(TABLAS).map(([clave, rotulo]) => (
              <option key={clave} value={clave}>{rotulo}s</option>
            ))}
          </select>
        </div>

        <div className={`campo ${estilos.filtro}`}>
          <label htmlFor="desde">Desde</label>
          <input id="desde" name="desde" type="date" className="control" defaultValue={desde} />
        </div>

        <div className={`campo ${estilos.filtro}`}>
          <label htmlFor="hasta">Hasta</label>
          <input id="hasta" name="hasta" type="date" className="control" defaultValue={hasta} />
        </div>

        <div className={estilos.filtroBotones}>
          <button className="boton" type="submit">Filtrar</button>
          <Link className="boton secundario" href="/auditoria">Limpiar</Link>
        </div>
      </form>

      <div className="desplazable">
        <table className="datos">
          <thead>
            <tr>
              <th>Cuándo</th>
              <th>Quién</th>
              <th>Sobre qué</th>
              <th>Acción</th>
              <th>Registro</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const a = ACCIONES[f.accion] ?? { rotulo: f.accion, chip: 'chip' }
              return (
                <tr key={f.id}>
                  <td>{fechaHora(f.creado_en)}</td>
                  <td>
                    {f.actor_nombre
                      ? <>
                          <span className="fuerte">{f.actor_nombre}</span>{' '}
                          <span className="menor gris mono">{f.actor_usuario}</span>
                        </>
                      : <span className="gris">
                          {f.actor_rol === 'admin' ? 'Coordinación' : 'Usuario dado de baja'}
                        </span>}
                  </td>
                  <td>{TABLAS[f.tabla] ?? f.tabla}</td>
                  <td><span className={a.chip}>{a.rotulo}</span></td>
                  <td>
                    {f.tabla === 'movimientos' && f.movimiento_numero !== null ? (
                      <Link href={`/movimientos/${f.registro_id}`} className="mono">
                        N.º {numero(f.movimiento_numero)}
                      </Link>
                    ) : (
                      <span>{f.etiqueta ?? <span className="mono menor gris">{f.registro_id.slice(0, 8)}</span>}</span>
                    )}
                  </td>
                  <td>{f.accion === 'anular' && f.motivo ? f.motivo : <span className="gris">—</span>}</td>
                </tr>
              )
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={6} className="centrado gris">
                  No hay movimientos registrados con esos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={estilos.paginado}>
        <span className="menor gris">
          {total === 0
            ? 'Sin resultados'
            : `${numero(primero)}–${numero(ultimo)} de ${numero(total)}`}
        </span>
        <div className="fila">
          {actual > 1 && (
            <Link className="boton secundario chico" href={enlace(actual - 1)}>Anteriores</Link>
          )}
          <span className="menor gris">Página {numero(actual)} de {numero(paginas)}</span>
          {actual < paginas && (
            <Link className="boton secundario chico" href={enlace(actual + 1)}>Siguientes</Link>
          )}
        </div>
      </div>
    </div>
  )
}
