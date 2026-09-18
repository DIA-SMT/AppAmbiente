import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import { fechaDeCalendario, fechaHora, numero } from '@/lib/formato'
import type { Catalogo, Mapeo } from '@/lib/importacion'
import { exigirAdmin } from '@/lib/sesion'
import { revertir } from './acciones'
import Importador from './Importador'
import estilos from '../gente.module.css'

export const dynamic = 'force-dynamic'

const ESTADOS: Record<string, { rotulo: string; chip: string }> = {
  previsualizada: { rotulo: 'Previsualizada', chip: 'chip pendiente' },
  confirmada: { rotulo: 'Confirmada', chip: 'chip ingreso' },
  revertida: { rotulo: 'Revertida', chip: 'chip anulado' },
}

type Parametros = { [clave: string]: string | string[] | undefined }

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? ''
}

interface FilaMapeo {
  id: string
  nombre: string
  tipo: string
  hoja: string | null
  fila_encabezado: number
  activo: boolean
  actualizado_en: string
  columnas: Mapeo['columnas']
  transformaciones: Mapeo['transformaciones']
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

/**
 * revertir() devuelve el resultado en vez de redirigir, porque el asistente lo
 * muestra en su propio estado. Este botón, en cambio, vive en una fila de la
 * tabla y no tiene estado de React alrededor: el aviso vuelve por la URL, como
 * en Vecinos.
 */
async function revertirImportacion(datos: FormData) {
  'use server'
  const resultado = await revertir(null, datos)
  if (resultado.ok) redirect('/importar?aviso=revertida')

  const parametros = new URLSearchParams({ aviso: 'error' })
  if (resultado.error) parametros.set('detalle', resultado.error)
  redirect(`/importar?${parametros.toString()}`)
}

export default async function PantallaImportar({
  searchParams,
}: {
  searchParams: Promise<Parametros>
}) {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const sp = await searchParams
  const aviso = texto(sp.aviso)
  const detalle = texto(sp.detalle)

  const { mapeos, importaciones, catalogo } = await conSesion(sesion, async (tx) => {
    // Ninguna de las cuatro usa el resultado de otra. Pedidas juntas, la
    // transacción las manda de una vez en lugar de esperar cuatro idas y vueltas.
    const [mapeos, importaciones, sitios, materiales] = await Promise.all([
      tx.consultar<FilaMapeo>(
        `select id, nombre, tipo, hoja, fila_encabezado, activo, actualizado_en,
                columnas, transformaciones
           from mapeos_importacion
          order by nombre`,
      ),
      tx.consultar<FilaImportacion>(
        `select i.id, i.archivo_nombre, i.periodo_desde, i.periodo_hasta,
                i.filas_ok, i.filas_error, i.estado, i.importado_en,
                m.nombre as mapeo_nombre, p.nombre as importado_por
           from importaciones i
           left join mapeos_importacion m on m.id = i.mapeo_id
           left join perfiles p on p.id = i.importado_por_id
          order by i.importado_en desc
          limit 20`,
      ),
      // Ni los puntos ni las corrientes se filtran por activo: un archivo de
      // meses atrás puede traer un punto verde que desde entonces se dio de
      // baja, y esa fila tiene que poder resolverse igual.
      tx.consultar<Catalogo['sitios'][number]>(
        `select codigo, nombre, direccion
           from sitios
          where tipo = 'punto_verde'
          order by orden, codigo`,
      ),
      tx.consultar<Catalogo['materiales'][number]>(
        `select nombre
           from materiales
          where cardinality(flujos) = 0 or 'punto_verde' = any(flujos)
          order by orden, nombre`,
      ),
    ])
    const catalogo: Catalogo = { sitios, materiales }
    return { mapeos, importaciones, catalogo }
  })

  // Con el que ya está guardado, la próxima importación no arranca de cero.
  // Alcanza con el primero: hay un solo formato de archivo de pesos.
  const guardado = mapeos.find((m) => m.activo && m.tipo === 'pesos_contenedores')
  const mapeoActivo = guardado
    ? {
        id: guardado.id,
        nombre: guardado.nombre,
        hoja: guardado.hoja,
        filaEncabezado: guardado.fila_encabezado,
        mapeo: { columnas: guardado.columnas, transformaciones: guardado.transformaciones },
      }
    : null

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Importar pesos</h1>
        <p className="menor gris">
          Los kilos que informa la planta de la 9 de Julio, para cruzarlos contra lo que se
          registró en cada punto verde.
        </p>
      </header>

      <div className="aviso">
        <p style={{ margin: 0 }}>
          <span className="fuerte">Esto no crea movimientos.</span>{' '}
          Los kilos que informa la planta se guardan aparte, para cruzarlos después contra lo que
          registró el punto verde por su cuenta. El movimiento lo carga el vigilador; esto es la
          contramedición.
        </p>
      </div>

      {aviso === 'revertida' && (
        <div className="aviso exito" role="status">
          Listo. Esa importación quedó marcada como revertida: sus kilos dejan de contar en el
          cruce. Las filas siguen guardadas.
        </div>
      )}
      {aviso === 'error' && (
        <div className="aviso error" role="alert">
          No se pudo revertir.{' '}
          {detalle || 'Probá de nuevo; si sigue fallando, avisale a la Dirección de IA.'}
        </div>
      )}

      {/* Los pasos ya no se cuentan por escrito: los muestra el asistente a
          medida que se avanza, y un archivo a mitad de camino no se explica con
          una lista que dice siempre lo mismo. */}
      <section className="tarjeta pila">
        <h2>Importar un archivo</h2>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          El Excel va tal cual lo manda la planta, sin tocarlo. Antes de guardar nada se muestra
          qué se entendió de cada fila y qué quedó afuera, con el número de fila del archivo. Lo
          que se resuelva una vez —qué columna es cuál, qué domicilio es qué punto verde— queda
          guardado como mapeo y la próxima vez ya viene resuelto.
        </p>

        <Importador catalogo={catalogo} mapeoActivo={mapeoActivo} />
      </section>

      <section className="pila-chica">
        <h2>Mapeos guardados</h2>
        {mapeos.length === 0 ? (
          <p className="menor gris" style={{ margin: 0 }}>
            Todavía no hay ninguno. El primero se guarda con el nombre que le pongas al confirmar
            la importación.
          </p>
        ) : (
          <div className="desplazable">
            <table className="datos">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Hoja</th>
                  <th style={{ textAlign: 'right' }}>Fila de encabezado</th>
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
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Revertir no borra nada: la importación queda marcada y sus kilos dejan de contar en el
          cruce. Las filas siguen guardadas, cada una con la fila del archivo de donde salió.
        </p>
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
                  <th style={{ textAlign: 'right' }}>Filas bien</th>
                  <th style={{ textAlign: 'right' }}>Con error</th>
                  <th>Estado</th>
                  <th>Cuándo</th>
                  <th>Quién</th>
                  <th className={estilos.columnaAcciones}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {importaciones.map((i) => {
                  const e = ESTADOS[i.estado] ?? { rotulo: i.estado, chip: 'chip' }
                  return (
                    <tr key={i.id} className={i.estado === 'revertida' ? 'anulado' : undefined}>
                      <td className="fuerte">{i.archivo_nombre}</td>
                      <td>{i.mapeo_nombre ?? <span className="gris">—</span>}</td>
                      <td>
                        {/* periodo_desde y periodo_hasta son columnas `date`: con
                            fecha() el 1 de agosto se lee como 31 de julio. */}
                        {i.periodo_desde
                          ? `${fechaDeCalendario(i.periodo_desde)} a ${fechaDeCalendario(i.periodo_hasta)}`
                          : <span className="gris">—</span>}
                      </td>
                      <td className="numero">{numero(i.filas_ok)}</td>
                      <td className="numero">{numero(i.filas_error)}</td>
                      <td><span className={e.chip}>{e.rotulo}</span></td>
                      <td>{fechaHora(i.importado_en)}</td>
                      <td>{i.importado_por ?? <span className="gris">—</span>}</td>
                      <td className={estilos.columnaAcciones}>
                        {i.estado === 'confirmada' ? (
                          <details className={estilos.confirmar}>
                            <summary>Revertir</summary>
                            <div className={estilos.confirmarCuerpo}>
                              <span>
                                Los kilos de esta importación dejan de contar en el cruce contra lo
                                que registró cada punto verde. No se borra nada: las{' '}
                                {numero(i.filas_ok)} filas quedan guardadas y la importación queda
                                marcada como revertida. Si el archivo vino mal, se corrige y se
                                importa de nuevo.
                              </span>
                              <form action={revertirImportacion}>
                                <input type="hidden" name="id" value={i.id} />
                                <button className="boton peligro chico" type="submit">
                                  Sí, revertir
                                </button>
                              </form>
                            </div>
                          </details>
                        ) : (
                          <span className="gris">—</span>
                        )}
                      </td>
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
