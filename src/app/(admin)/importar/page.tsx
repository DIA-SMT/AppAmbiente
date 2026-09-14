import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import { fecha, fechaHora, numero } from '@/lib/formato'
import { exigirAdmin } from '@/lib/sesion'
import estilos from '../gente.module.css'

export const dynamic = 'force-dynamic'

const ESTADOS: Record<string, { rotulo: string; chip: string }> = {
  previsualizada: { rotulo: 'Previsualizada', chip: 'chip pendiente' },
  confirmada: { rotulo: 'Confirmada', chip: 'chip ingreso' },
  revertida: { rotulo: 'Revertida', chip: 'chip anulado' },
}

interface FilaMapeo {
  id: string
  nombre: string
  tipo: string
  hoja: string | null
  fila_encabezado: number
  activo: boolean
  actualizado_en: string
}

interface FilaImportacion {
  id: string
  archivo_nombre: string
  periodo_desde: string | null
  periodo_hasta: string | null
  filas_ok: number
  filas_error: number
  estado: string
  importado_en: string
  mapeo_nombre: string | null
  importado_por: string | null
}

export default async function PantallaImportar() {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const { mapeos, importaciones } = await conSesion(sesion, async (tx) => {
    const mapeos = await tx.consultar<FilaMapeo>(
      `select id, nombre, tipo, hoja, fila_encabezado, activo, actualizado_en
         from mapeos_importacion
        order by nombre`,
    )
    const importaciones = await tx.consultar<FilaImportacion>(
      `select i.id, i.archivo_nombre, i.periodo_desde, i.periodo_hasta,
              i.filas_ok, i.filas_error, i.estado, i.importado_en,
              m.nombre as mapeo_nombre, p.nombre as importado_por
         from importaciones i
         left join mapeos_importacion m on m.id = i.mapeo_id
         left join perfiles p on p.id = i.importado_por_id
        order by i.importado_en desc
        limit 20`,
    )
    return { mapeos, importaciones }
  })

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Importar pesos</h1>
        <p className="menor gris">
          Los kilos que informa la planta de la 9 de Julio, para cruzarlos contra lo que se
          registró en cada punto verde.
        </p>
      </header>

      <div className="aviso atencion">
        <p style={{ margin: 0 }}>
          <span className="fuerte">Esta pantalla queda para cuando llegue el primer archivo.</span>{' '}
          No está rota ni a medio hacer: falta el dato que define cómo se lee el Excel, y ese dato
          viene de la planta, no del código.
        </p>
      </div>

      <section className="tarjeta pila">
        <h2>Qué va a hacer</h2>
        <ol className={estilos.pasos}>
          <li>
            <div>
              <span className="fuerte">Subir el archivo.</span>{' '}
              <span className="gris">El Excel tal cual lo manda la planta, sin tocarlo.</span>
            </div>
          </li>
          <li>
            <div>
              <span className="fuerte">Ver las primeras filas.</span>{' '}
              <span className="gris">Para confirmar que se está leyendo la hoja correcta.</span>
            </div>
          </li>
          <li>
            <div>
              <span className="fuerte">Decir qué columna es cuál.</span>{' '}
              <span className="gris">
                Fecha, punto verde, contenedor, kilos. El mapeo queda guardado y la próxima vez ya
                viene resuelto.
              </span>
            </div>
          </li>
          <li>
            <div>
              <span className="fuerte">Revisar los errores.</span>{' '}
              <span className="gris">
                Las filas que no se entendieron se muestran con el motivo, antes de guardar nada.
              </span>
            </div>
          </li>
          <li>
            <div>
              <span className="fuerte">Recién ahí, confirmar.</span>{' '}
              <span className="gris">
                Y si el archivo vino mal, la importación se revierte completa.
              </span>
            </div>
          </li>
        </ol>

        <div className={estilos.zonaInactiva}>
          Acá va a ir el archivo. Todavía no.
        </div>
      </section>

      <section className="tarjeta pila-chica">
        <h2>Por qué todavía no está</h2>
        <p style={{ margin: 0 }}>
          No se conoce el formato del Excel de pesos de contenedores de la planta de la 9 de Julio:
          qué hoja, en qué fila arrancan los encabezados, cómo se llaman las columnas, cómo escriben
          las fechas y si los kilos van con coma o con punto. Escribir un lector a ciegas es
          garantizar que haya que rehacerlo el día que llegue el archivo de verdad.
        </p>
        <p style={{ margin: 0 }}>
          La decisión fue dejar el mapeo de columnas como un dato configurable y no como código
          (tabla <span className="mono menor">mapeos_importacion</span>). Cuando llegue el archivo se
          resuelve desde esta misma pantalla, sin desplegar nada.
        </p>
        <p style={{ margin: 0 }}>
          Es la única pregunta del relevamiento que frena un entregable: el indicador de eficiencia
          por punto verde, que compara los kilos informados contra lo registrado. Todo lo demás del
          sistema avanza igual.
        </p>
      </section>

      <section className="tarjeta pila-chica">
        <h2>Qué se necesita para destrabarla</h2>
        <p style={{ margin: 0 }}>
          Un archivo de muestra, aunque sea viejo o incompleto. Con una sola planilla real alcanza
          para dejar la importación andando.
        </p>
      </section>

      <section className="pila-chica">
        <h2>Mapeos guardados</h2>
        {mapeos.length === 0 ? (
          <p className="menor gris" style={{ margin: 0 }}>
            Todavía no hay ninguno. El primero se va a crear el día que llegue el archivo.
          </p>
        ) : (
          <div className="desplazable">
            <table className="datos">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Hoja</th>
                  <th className="numero">Fila de encabezado</th>
                  <th>Estado</th>
                  <th>Última edición</th>
                </tr>
              </thead>
              <tbody>
                {mapeos.map((m) => (
                  <tr key={m.id}>
                    <td className="fuerte">{m.nombre}</td>
                    <td>{m.tipo === 'pesos_contenedores' ? 'Pesos de contenedores' : 'Movimientos históricos'}</td>
                    <td>{m.hoja ?? <span className="gris">La primera</span>}</td>
                    <td className="numero">{numero(m.fila_encabezado)}</td>
                    <td>
                      <span className={m.activo ? 'chip ingreso' : 'chip anulado'}>
                        {m.activo ? 'Activo' : 'Desactivado'}
                      </span>
                    </td>
                    <td>{fechaHora(m.actualizado_en)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="pila-chica">
        <h2>Importaciones hechas</h2>
        {importaciones.length === 0 ? (
          <p className="menor gris" style={{ margin: 0 }}>
            Ninguna todavía.
          </p>
        ) : (
          <div className="desplazable">
            <table className="datos">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Mapeo</th>
                  <th>Período</th>
                  <th className="numero">Filas bien</th>
                  <th className="numero">Con error</th>
                  <th>Estado</th>
                  <th>Cuándo</th>
                  <th>Quién</th>
                </tr>
              </thead>
              <tbody>
                {importaciones.map((i) => {
                  const e = ESTADOS[i.estado] ?? { rotulo: i.estado, chip: 'chip' }
                  return (
                    <tr key={i.id}>
                      <td className="fuerte">{i.archivo_nombre}</td>
                      <td>{i.mapeo_nombre ?? <span className="gris">—</span>}</td>
                      <td>
                        {i.periodo_desde
                          ? `${fecha(i.periodo_desde)} a ${fecha(i.periodo_hasta)}`
                          : <span className="gris">—</span>}
                      </td>
                      <td className="numero">{numero(i.filas_ok)}</td>
                      <td className="numero">{numero(i.filas_error)}</td>
                      <td><span className={e.chip}>{e.rotulo}</span></td>
                      <td>{fechaHora(i.importado_en)}</td>
                      <td>{i.importado_por ?? <span className="gris">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
