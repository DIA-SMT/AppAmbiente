import Link from 'next/link'
import { redirect } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import { destinosAFormalizar, entidadesPendientes } from '@/lib/datos'
import { ETIQUETA_ENTIDAD, ETIQUETA_FLUJO, fecha, fechaHora, haceCuanto, numero } from '@/lib/formato'
import { exigirAdmin } from '@/lib/sesion'
import { confirmar, descartar } from './acciones'
import FormalizarDestino from './FormalizarDestino'
import FusionarEntidad, { type Candidata } from './FusionarEntidad'
import estilos from './revisiones.module.css'

export const dynamic = 'force-dynamic'

/** A partir de acá el destino dejó de ser una excepción y merece ser opción fija. */
const SE_REPITE = 5

interface FilaEntidad {
  id: string
  nombre: string
  tipo: string
  flujos: string[]
  pendiente_revision: boolean
}

type Busqueda = Record<string, string | string[] | undefined>

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? ''
}

/** Flujos vacíos significa "en todos": ahí cualquier entidad sirve. */
function mismoFlujo(unos: string[], otros: string[]): boolean {
  if (!unos.length || !otros.length) return true
  return unos.some((f) => otros.includes(f))
}

export default async function PantallaRevisiones({
  searchParams,
}: {
  searchParams: Promise<Busqueda>
}) {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const parametros = await searchParams
  const aviso = texto(parametros.aviso)
  const detalle = texto(parametros.detalle)

  const [pendientes, activas, destinos] = await Promise.all([
    entidadesPendientes(sesion),
    // entidadesPendientes no trae los flujos, y hacen falta para dos cosas: el
    // chip de la ficha y armar la lista de con quién se puede fusionar.
    consultarConSesion<FilaEntidad>(
      sesion,
      `select id, nombre, tipo, flujos, pendiente_revision
         from entidades where activo order by nombre`,
    ),
    // Ya vienen ordenados por frecuencia descendente.
    destinosAFormalizar(sesion),
  ])

  const flujosPorId = new Map(activas.map((e) => [e.id, e.flujos ?? []]))
  const confirmadas = activas.filter((e) => !e.pendiente_revision)
  const repetidos = destinos.filter((d) => Number(d.veces) >= SE_REPITE).length

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Revisiones</h1>
        <p className="menor gris">
          Lo que los vigiladores tienen que resolver en la calle para no quedarse trabados, y acá se
          termina de ordenar: las altas que hacen desde el celular, y los destinos que escriben a
          mano porque no están en la lista.
        </p>
      </header>

      {aviso === 'confirmada' && (
        <div className="aviso exito" role="status">
          <span className="fuerte">{detalle}</span> quedó confirmada. Desde ahora se usa como
          cualquier otra entidad de la lista.
        </div>
      )}
      {aviso === 'fusionada' && (
        <div className="aviso exito" role="status">
          Listo: <span className="fuerte">{detalle}</span>. Los movimientos quedaron apuntando a la
          entidad que se conserva, y la duplicada quedó desactivada.
        </div>
      )}
      {aviso === 'descartada' && (
        <div className="aviso exito" role="status">
          <span className="fuerte">{detalle}</span> quedó descartada. No se borró: está desactivada
          y se puede reactivar desde Listas.
        </div>
      )}
      {aviso === 'formalizado' && (
        <div className="aviso exito" role="status">
          Listo: <span className="fuerte">{detalle}</span>. Ya se puede elegir de la lista en el
          celular, y los movimientos que lo tenían escrito a mano ahora apuntan a esa entidad.
        </div>
      )}
      {aviso === 'error' && (
        <div className="aviso error" role="alert">
          {detalle || 'No se pudo completar la acción. Probá de nuevo.'}
        </div>
      )}

      {/* ── Altas hechas en la calle ─────────────────────────────────── */}

      <section className={estilos.seccion}>
        <header className="pila-chica">
          <h2>Altas hechas en la calle</h2>
          <p className="menor gris" style={{ margin: 0 }}>
            Puede ser alguien nuevo, o el mismo de siempre escrito distinto.
          </p>
        </header>

        {pendientes.length === 0 ? (
          <div className="tarjeta pila-chica centrado" style={{ padding: 32 }}>
            <h3>No hay altas para revisar</h3>
            <p className="menor gris" style={{ margin: 0 }}>
              Es lo normal, no es un error. Mientras nadie dé de alta a nadie en la calle, esta
              parte queda vacía. La lista completa de entidades está en{' '}
              <Link href="/listas/entidades">Listas</Link>.
            </p>
          </div>
        ) : (
          <>
            <p className="menor gris" style={{ margin: 0 }}>
              {numero(pendientes.length)}{' '}
              {pendientes.length === 1 ? 'alta esperando revisión' : 'altas esperando revisión'}
            </p>

            <ul className={estilos.fichas}>
              {pendientes.map((e) => {
                const flujos = flujosPorId.get(e.id) ?? []
                const candidatas: Candidata[] = confirmadas
                  .filter((c) => mismoFlujo(flujos, c.flujos ?? []))
                  .map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo }))

                return (
                  <li key={e.id} className={`tarjeta ${estilos.ficha}`}>
                    <div className="pila-chica">
                      <div className="fila" style={{ gap: 6 }}>
                        <span className="chip pendiente">Pendiente</span>
                        <span className="chip">{ETIQUETA_ENTIDAD[e.tipo] ?? e.tipo}</span>
                        {flujos.map((f) => (
                          <span key={f} className="chip">{ETIQUETA_FLUJO[f] ?? f}</span>
                        ))}
                      </div>
                      <h3 className={estilos.nombre}>{e.nombre}</h3>
                    </div>

                    <div className={estilos.datos}>
                      <span>
                        La dio de alta{' '}
                        <span className="fuerte">{e.creado_por ?? 'un usuario que ya no está'}</span>
                      </span>
                      <span>
                        {fechaHora(e.creado_en)} · {haceCuanto(e.creado_en)}
                      </span>
                      <span className={e.usos > 0 ? 'fuerte' : undefined}>
                        {e.usos > 0
                          ? `Ya se usó en ${numero(e.usos)} ${e.usos === 1 ? 'movimiento' : 'movimientos'}`
                          : 'Todavía no se usó en ningún movimiento'}
                      </span>
                      <span>
                        <Link className="menor" href={`/listas/entidades?editar=${e.id}#formulario`}>
                          Corregir el nombre o los datos en Listas
                        </Link>
                      </span>
                    </div>

                    <div className={estilos.acciones}>
                      <form action={confirmar.bind(null, e.id)}>
                        <button type="submit" className="boton ancho-total">
                          Confirmar
                        </button>
                      </form>

                      <FusionarEntidad
                        pendiente={{ id: e.id, nombre: e.nombre }}
                        candidatas={candidatas}
                      />

                      <details className={`${estilos.desplegable} ${estilos.peligroso}`}>
                        <summary>Descartar</summary>
                        <div className={estilos.cuerpo}>
                          {e.usos > 0 ? (
                            <p>
                              Ojo: <span className="fuerte">{e.nombre}</span> ya figura en{' '}
                              {numero(e.usos)} {e.usos === 1 ? 'movimiento' : 'movimientos'}. Esos
                              movimientos no se borran ni cambian, pero van a quedar apuntando a una
                              entidad inactiva, que no aparece más en las listas ni se puede volver
                              a elegir. Si es la misma que una entidad que ya existe, fusionala en
                              vez de descartarla.
                            </p>
                          ) : (
                            <p>
                              Todavía no se usó en ningún movimiento: descartarla no deja nada
                              colgado.
                            </p>
                          )}
                          <p>
                            No se borra nada. La entidad queda desactivada y se puede reactivar
                            desde Listas.
                          </p>
                          <form action={descartar.bind(null, e.id)}>
                            <button type="submit" className="boton peligro ancho-total">
                              Sí, descartar «{e.nombre}»
                            </button>
                          </form>
                        </div>
                      </details>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      {/* ── Destinos escritos a mano ─────────────────────────────────── */}

      <section className={estilos.seccion}>
        <header className="pila-chica">
          <h2>Destinos escritos a mano</h2>
          <p className="menor gris" style={{ margin: 0 }}>
            No hay una lista formal de destinos habilitados: el chofer le dice al portero adónde
            lleva el material y el vigilador lo escribe. Acá está lo que escribieron y cuántas
            veces, para ir formalizándolo de a poco. Al convertir uno, los movimientos que lo tenían
            escrito pasan a apuntar a la entidad nueva, así que lo que ya salió no pierde la
            trazabilidad.
          </p>
        </header>

        {destinos.length === 0 ? (
          <div className="tarjeta pila-chica centrado" style={{ padding: 32 }}>
            <h3>Ningún destino escrito a mano</h3>
            <p className="menor gris" style={{ margin: 0 }}>
              Es lo normal, no es un error. Aparecen acá cuando un vigilador escribe un destino que
              no estaba en la lista: un barrio, un productor, el Ex Matadero. Mientras todas las
              salidas vayan a destinos ya cargados, esta parte queda vacía.
            </p>
          </div>
        ) : (
          <>
            <p className="menor gris" style={{ margin: 0 }}>
              {numero(destinos.length)}{' '}
              {destinos.length === 1 ? 'destino distinto' : 'destinos distintos'} sin formalizar
              {repetidos > 0 && (
                <>
                  {' · '}
                  <span className="fuerte">
                    {numero(repetidos)} {repetidos === 1 ? 'aparece' : 'aparecen'} {SE_REPITE} veces
                    o más
                  </span>
                </>
              )}
            </p>

            <ul className="lista">
              {destinos.map((d) => {
                const veces = Number(d.veces)
                const seRepite = veces >= SE_REPITE
                const flujos = d.flujos ?? []
                const sitios = d.sitios ?? []
                const desde = fecha(d.primera_vez)
                const hasta = fecha(d.ultima_vez)

                return (
                  <li key={d.destino} className={estilos.destino}>
                    <div className="pila-chica">
                      <div className="fila" style={{ gap: 6 }}>
                        <span className={seRepite ? 'chip salida cifras' : 'chip cifras'}>
                          {numero(veces)} {veces === 1 ? 'vez' : 'veces'}
                        </span>
                        {flujos.map((f) => (
                          <span key={f} className="chip">{ETIQUETA_FLUJO[f] ?? f}</span>
                        ))}
                      </div>
                      <h3 className={estilos.escrito}>«{d.destino}»</h3>
                    </div>

                    <div className={estilos.datos}>
                      <span>{desde === hasta ? `Solo el ${desde}` : `Del ${desde} al ${hasta}`}</span>
                      {sitios.length > 0 && <span>En {sitios.join(' · ')}</span>}
                      {seRepite && (
                        <span className="fuerte">
                          Ya no es una excepción: conviene que sea opción fija.
                        </span>
                      )}
                    </div>

                    <div className={estilos.formalizar}>
                      <FormalizarDestino escrito={d.destino} veces={veces} flujos={flujos} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
