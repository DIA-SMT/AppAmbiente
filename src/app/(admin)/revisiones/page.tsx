import Link from 'next/link'
import { redirect } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import { entidadesPendientes } from '@/lib/datos'
import { ETIQUETA_ENTIDAD, ETIQUETA_FLUJO, fechaHora, haceCuanto, numero } from '@/lib/formato'
import { exigirAdmin } from '@/lib/sesion'
import { confirmar, descartar } from './acciones'
import FusionarEntidad, { type Candidata } from './FusionarEntidad'
import estilos from './revisiones.module.css'

export const dynamic = 'force-dynamic'

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

  const [pendientes, activas] = await Promise.all([
    entidadesPendientes(sesion),
    // entidadesPendientes no trae los flujos, y hacen falta para dos cosas: el
    // chip de la ficha y armar la lista de con quién se puede fusionar.
    consultarConSesion<FilaEntidad>(
      sesion,
      `select id, nombre, tipo, flujos, pendiente_revision
         from entidades where activo order by nombre`,
    ),
  ])

  const flujosPorId = new Map(activas.map((e) => [e.id, e.flujos ?? []]))
  const confirmadas = activas.filter((e) => !e.pendiente_revision)

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Revisiones</h1>
        <p className="menor gris">
          Cuando aparece un carrero o un emprendimiento que no está en la lista, el vigilador lo da
          de alta desde el celular para no quedarse trabado, y queda acá. Puede ser alguien nuevo, o
          el mismo de siempre escrito distinto.
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
      {aviso === 'error' && (
        <div className="aviso error" role="alert">
          {detalle || 'No se pudo completar la acción. Probá de nuevo.'}
        </div>
      )}

      {pendientes.length === 0 ? (
        <section className="tarjeta pila-chica centrado" style={{ padding: 32 }}>
          <h2>No hay nada para revisar</h2>
          <p className="menor gris" style={{ margin: 0 }}>
            Es lo normal, no es un error. Acá caen las altas que los vigiladores hacen desde el
            celular: carreros, emprendimientos y organizaciones que se llevan material y todavía no
            estaban en la lista. Mientras nadie dé de alta a nadie en la calle, esta pantalla queda
            vacía.
          </p>
          <p className="menor gris" style={{ margin: 0 }}>
            La lista completa de entidades está en{' '}
            <Link href="/listas/entidades">Listas</Link>.
          </p>
        </section>
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
                    <h2 className={estilos.nombre}>{e.nombre}</h2>
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
                            entidad inactiva, que no aparece más en las listas ni se puede volver a
                            elegir. Si es la misma que una entidad que ya existe, fusionala en vez
                            de descartarla.
                          </p>
                        ) : (
                          <p>
                            Todavía no se usó en ningún movimiento: descartarla no deja nada
                            colgado.
                          </p>
                        )}
                        <p>
                          No se borra nada. La entidad queda desactivada y se puede reactivar desde
                          Listas.
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
    </div>
  )
}
