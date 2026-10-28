import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import { fechaDeCalendario, fechaHora, numero } from '@/lib/formato'
import { exigirPanel } from '@/lib/sesion'
import SubNavegacion from '../../tablero/SubNavegacion'
import { PESTANAS_IMPORTAR } from '../pestanas'
import { revertir } from './acciones'
import HistoricoPlanta from './HistoricoPlanta'
import estilos from '../../gente.module.css'

export const dynamic = 'force-dynamic'

// Leer el R-05 y guardar cinco mil viajes en una transacción lleva más que los
// diez segundos que da Vercel por defecto. Vale para las acciones de la página.
export const maxDuration = 60

type Parametros = { [clave: string]: string | string[] | undefined }

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? ''
}

interface FilaImportacion {
  id: string
  archivo_nombre: string
  periodo_desde: string | null
  periodo_hasta: string | null
  filas_ok: number
  filas_error: number
  vigentes: number
  estado: string
  importado_en: string
  importado_por: string | null
}

/** Como en Importar pesos: el resultado vuelve por la URL porque la fila no tiene estado. */
async function revertirImportacion(datos: FormData) {
  'use server'
  const resultado = await revertir(null, datos)
  if (resultado.ok) redirect(`/importar/historico?aviso=revertida&anulados=${resultado.anulados ?? 0}`)

  const parametros = new URLSearchParams({ aviso: 'error' })
  if (resultado.error) parametros.set('detalle', resultado.error)
  redirect(`/importar/historico?${parametros.toString()}`)
}

export default async function PantallaHistorico({
  searchParams,
}: {
  searchParams: Promise<Parametros>
}) {
  const sesion = await exigirPanel()

  const sp = await searchParams
  const aviso = texto(sp.aviso)
  const detalle = texto(sp.detalle)
  const anulados = Number(texto(sp.anulados)) || 0

  const importaciones = await conSesion(sesion, (tx) =>
    tx.consultar<FilaImportacion>(
      `select i.id, i.archivo_nombre, i.periodo_desde, i.periodo_hasta,
              i.filas_ok, i.filas_error, i.estado, i.importado_en,
              p.nombre as importado_por,
              (select count(*)::int from movimientos m
                where m.importacion_id = i.id and m.estado = 'vigente') as vigentes
         from importaciones i
         left join perfiles p on p.id = i.importado_por_id
        where i.tipo = 'movimientos_historicos'
        order by i.importado_en desc
        limit 20`,
    ),
  )

  return (
    <div className="pila">
      <SubNavegacion pestanas={PESTANAS_IMPORTAR} rotulo="Importaciones" />
      <header className="pila-chica">
        <h1>Histórico de la Planta</h1>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Los ingresos a la Planta que se anotaron en el R-05 antes del celular. Cada fila de la
          planilla entra como un viaje, igual que si lo hubiera cargado el vigilador.
        </p>
      </header>

      {aviso === 'revertida' && (
        <div className="aviso exito" role="status">
          Listo. Se anularon {numero(anulados)} viajes de esa importación: dejan de contar en el
          tablero y en los listados, pero no se borra nada. Cada uno queda anulado con el motivo.
        </div>
      )}
      {aviso === 'error' && (
        <div className="aviso error" role="alert">
          No se pudo revertir.{' '}
          {detalle || 'Probá de nuevo; si sigue fallando, avisale a la Dirección de IA.'}
        </div>
      )}

      <section className="tarjeta pila" data-recorrido="archivo">
        <h2>Cargar el R-05</h2>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Descargá la planilla de Google como Excel y subila sin tocarla. Se puede subir todos los
          meses: las filas que ya entraron no se vuelven a cargar, así que sólo suma lo nuevo.
        </p>
        <HistoricoPlanta />
      </section>

      <section className="pila-chica" data-recorrido="historial">
        <h2>Importaciones hechas</h2>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Revertir anula todos los viajes de esa importación, con el motivo y con tu nombre. No se
          borra nada, y las filas pueden volver a importarse después.
        </p>
        {importaciones.length === 0 ? (
          <p className="menor gris" style={{ margin: 0 }}>
            Ninguna todavía.
          </p>
        ) : (
          <div className="desplazable tabla-ficha">
            <table className="datos">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Período</th>
                  <th style={{ textAlign: 'right' }}>Viajes cargados</th>
                  <th style={{ textAlign: 'right' }}>Quedaron afuera</th>
                  <th>Estado</th>
                  <th>Cuándo</th>
                  <th>Quién</th>
                  <th className={estilos.columnaAcciones}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {importaciones.map((i, n) => {
                  const revertida = i.estado === 'revertida'
                  return (
                    <tr key={i.id} className={revertida ? 'anulado' : undefined}>
                      <td data-rotulo="Archivo" className="fuerte">{i.archivo_nombre}</td>
                      <td data-rotulo="Período">
                        {i.periodo_desde
                          ? `${fechaDeCalendario(i.periodo_desde)} a ${fechaDeCalendario(i.periodo_hasta)}`
                          : <span className="gris">—</span>}
                      </td>
                      <td data-rotulo="Viajes cargados" className="numero">{numero(i.filas_ok)}</td>
                      <td data-rotulo="Quedaron afuera" className="numero">{numero(i.filas_error)}</td>
                      <td data-rotulo="Estado">
                        <span className={revertida ? 'chip anulado' : 'chip ingreso'}>
                          {revertida ? 'Revertida' : 'Confirmada'}
                        </span>
                      </td>
                      <td data-rotulo="Cuándo">{fechaHora(i.importado_en)}</td>
                      <td data-rotulo="Quién">{i.importado_por ?? <span className="gris">—</span>}</td>
                      <td className={estilos.columnaAcciones}>
                        {!revertida ? (
                          <details
                            className={estilos.confirmar}
                            data-recorrido={n === importaciones.findIndex((x) => x.estado !== 'revertida') ? 'revertir' : undefined}
                          >
                            <summary>Revertir</summary>
                            <div className={estilos.confirmarCuerpo}>
                              <span>
                                Se anulan los {numero(i.vigentes)} viajes que siguen vigentes de esta
                                importación. Dejan de contar en el tablero y en los listados, y
                                quedan anulados con el motivo. Si la planilla vino mal, se corrige y
                                se importa de nuevo.
                              </span>
                              <form action={revertirImportacion}>
                                <input type="hidden" name="id" value={i.id} />
                                <button className="boton peligro chico" type="submit">
                                  Sí, anular {numero(i.vigentes)} viajes
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
