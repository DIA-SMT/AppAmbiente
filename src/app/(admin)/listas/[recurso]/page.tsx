import Link from 'next/link'
import { notFound } from 'next/navigation'
import { conSesion } from '@db/sesion'
import { numero } from '@/lib/formato'
import {
  RECURSOS, UUID, campoPorNombre, columnasDeLectura, identificador, ordenSql,
  recursoPorClave, valorDeFila,
  type ClaveRecurso, type Opcion, type ValorFormulario,
} from '@/lib/recursos'
import { exigirAdmin } from '@/lib/sesion'
import estilos from '../listas.module.css'
import FormularioRecurso from './FormularioRecurso'
import TablaRecurso from './TablaRecurso'

export const dynamic = 'force-dynamic'

/** Tope de filas del listado. Ninguna lista maestra se acerca ni de lejos. */
const TOPE = 500

type Fila = Record<string, unknown> & { id: string; activo: boolean }
/** Una fila de otra lista maestra, tal como la lee el select por referencia. */
type FilaDeOrigen = { id: string; etiqueta: string; activo: boolean }
type Parametros = { [clave: string]: string | string[] | undefined }

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? ''
}

export default async function PantallaRecurso({
  params,
  searchParams,
}: {
  params: Promise<{ recurso: string }>
  searchParams: Promise<Parametros>
}) {
  const sesion = await exigirAdmin()

  const { recurso: clave } = await params
  const recurso = recursoPorClave(clave)
  if (!recurso) notFound()

  const sp = await searchParams
  const busqueda = texto(sp.q)
  const verInactivos = texto(sp.inactivos) === '1'
  const guardado = texto(sp.guardado)
  const hayProblema = texto(sp.problema) === '1'
  const idEditar = texto(sp.editar)
  const esNuevo = texto(sp.nuevo) === '1'

  const tabla = identificador(recurso.tabla)
  const columnas = columnasDeLectura(recurso)

  // ── Qué se le pide a la base ──────────────────────────────────────────
  const condiciones: string[] = []
  const parametros: unknown[] = []
  if (!verInactivos) condiciones.push('activo')
  if (busqueda) {
    parametros.push(`%${busqueda}%`)
    const marca = `$${parametros.length}`
    condiciones.push(
      `(${recurso.camposBusqueda
        .map((c) => `coalesce(${identificador(c)}, '') ilike ${marca}`)
        .join(' or ')})`,
    )
  }

  // Las listas de las que este recurso toma opciones, sin repetir: dos campos
  // pueden apuntar al mismo origen (personas mira sitios y entidades, y
  // entidades una sola vez aunque la miren dos campos).
  const clavesDeOrigen = [
    ...new Set(recurso.campos.flatMap((c) => (c.origen ? [c.origen] : []))),
  ]

  // Todo en una sola transacción y todo lanzado junto. Abrir una transacción
  // cuesta cuatro viajes a São Paulo (BEGIN, identidad, consulta, COMMIT) y el
  // pool serverless tiene una sola conexión: lo que le costaba a esta pantalla
  // no eran las consultas sino las transacciones, una por cada lista de origen
  // adentro de un for. Adentro de un mismo `tx` las consultas se encauzan y
  // viajan juntas, así que las tres clases de lectura salen por el precio de
  // una. Ninguna se sale de conSesion: la identidad puesta en el BEGIN es lo
  // que hace que las políticas de la base sigan filtrando igual.
  const [filas, enEdicion, listasDeOrigen] = await conSesion(sesion, (tx) => Promise.all([
    tx.consultar<Fila>(
      `select ${columnas} from ${tabla}
        ${condiciones.length ? `where ${condiciones.join(' and ')}` : ''}
        order by ${ordenSql(recurso)}
        limit ${TOPE}`,
      parametros,
    ),
    idEditar && UUID.test(idEditar)
      ? tx.consultar<Fila>(`select ${columnas} from ${tabla} where id = $1`, [idEditar])
      : Promise.resolve<Fila[]>([]),
    Promise.all(clavesDeOrigen.map((clave) => {
      const otro = RECURSOS.find((r) => r.clave === clave)!
      return tx.consultar<FilaDeOrigen>(
        `select id, ${identificador(otro.campoEtiqueta)} as etiqueta, activo
           from ${identificador(otro.tabla)} order by ${ordenSql(otro)}`,
      )
    })),
  ]))

  // ── Fila que se está editando ─────────────────────────────────────────
  const filaEnEdicion: Fila | null = enEdicion[0] ?? null
  const seFueLaFila = Boolean(idEditar) && !filaEnEdicion
  const mostrarFormulario = esNuevo || Boolean(filaEnEdicion)

  // ── Listas de las que este recurso toma opciones ──────────────────────
  const origenes = new Map<ClaveRecurso, { etiquetas: Record<string, string>; opciones: Opcion[] }>()
  clavesDeOrigen.forEach((clave, i) => {
    const suyas = listasDeOrigen[i]
    origenes.set(clave, {
      // Los nombres de las inactivas también, para poder mostrar de qué habla
      // un material que apunta a una unidad dada de baja.
      etiquetas: Object.fromEntries(suyas.map((f) => [f.id, f.etiqueta])),
      opciones: suyas.filter((f) => f.activo).map((f) => ({ valor: f.id, etiqueta: f.etiqueta })),
    })
  })

  const opcionesPorCampo: Record<string, Opcion[]> = {}
  const etiquetasPorCampo: Record<string, Record<string, string>> = {}
  for (const campo of recurso.campos) {
    if (!campo.origen) continue
    const origen = origenes.get(campo.origen)!
    etiquetasPorCampo[campo.nombre] = origen.etiquetas
    let lista = origen.opciones
    const actual = filaEnEdicion ? String(filaEnEdicion[campo.nombre] ?? '') : ''
    if (actual && !lista.some((o) => o.valor === actual)) {
      lista = [...lista, {
        valor: actual,
        etiqueta: `${origen.etiquetas[actual] ?? 'Sin nombre'} (dada de baja)`,
      }]
    }
    opcionesPorCampo[campo.nombre] = lista
  }

  // ── Valores iniciales del formulario ──────────────────────────────────
  const valores: Record<string, ValorFormulario> = {}
  for (const campo of recurso.campos) valores[campo.nombre] = valorDeFila(campo, filaEnEdicion)

  // ── Enlaces que conservan el filtro ───────────────────────────────────
  const filtro = new URLSearchParams()
  if (busqueda) filtro.set('q', busqueda)
  if (verInactivos) filtro.set('inactivos', '1')
  const consulta = filtro.toString()
  const rutaLista = `/listas/${recurso.clave}${consulta ? `?${consulta}` : ''}`

  const conFiltro = (extra: Record<string, string>) => {
    const p = new URLSearchParams(consulta)
    for (const [k, v] of Object.entries(extra)) p.set(k, v)
    return `/listas/${recurso.clave}?${p.toString()}`
  }

  const alternarInactivos = new URLSearchParams()
  if (busqueda) alternarInactivos.set('q', busqueda)
  if (!verInactivos) alternarInactivos.set('inactivos', '1')

  const porDonde = recurso.camposBusqueda.map(
    (n) => (campoPorNombre(recurso, n)?.etiqueta ?? n).toLowerCase(),
  )
  const pista = porDonde.length === 1
    ? porDonde[0]
    : `${porDonde.slice(0, -1).join(', ')} o ${porDonde[porDonde.length - 1]}`

  return (
    <div className="pila">
      <header className="pila-chica">
        <Link href="/listas" className="menor">← Todas las listas</Link>
        <div className="fila-entre">
          <h1>{recurso.plural}</h1>
          {!mostrarFormulario && (
            <Link href={conFiltro({ nuevo: '1' })} className="boton">
              Agregar {recurso.singular.toLowerCase()}
            </Link>
          )}
        </div>
        <p className="gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>{recurso.paraQue}</p>
      </header>

      {guardado && (
        <div className="aviso exito" role="status">Se guardó «{guardado}».</div>
      )}
      {hayProblema && (
        <div className="aviso error" role="alert">
          No se pudo cambiar el estado de esa fila. Probá de nuevo.
        </div>
      )}
      {seFueLaFila && (
        <div className="aviso atencion" role="alert">
          Esa fila ya no está. Puede que la haya cambiado otra persona.
        </div>
      )}

      {mostrarFormulario && (
        <section className="tarjeta pila" id="formulario">
          <h2>
            {filaEnEdicion
              ? `Editar ${recurso.singular.toLowerCase()}`
              : `Agregar ${recurso.singular.toLowerCase()}`}
          </h2>
          <FormularioRecurso
            key={filaEnEdicion ? filaEnEdicion.id : 'nuevo'}
            recurso={recurso}
            id={filaEnEdicion ? filaEnEdicion.id : null}
            valores={valores}
            opciones={opcionesPorCampo}
            rutaCancelar={rutaLista}
          />
        </section>
      )}

      <form method="get" className={`tarjeta ${estilos.barra}`}>
        <div className={`campo ${estilos.buscador}`}>
          <label htmlFor="q">Buscar</label>
          <input
            id="q"
            name="q"
            type="search"
            className="control"
            defaultValue={busqueda}
            placeholder={`${pista.charAt(0).toUpperCase()}${pista.slice(1)}…`}
          />
        </div>
        {verInactivos && <input type="hidden" name="inactivos" value="1" />}
        <button type="submit" className="boton secundario">Buscar</button>
        <Link
          className="boton fantasma"
          href={`/listas/${recurso.clave}${alternarInactivos.toString() ? `?${alternarInactivos}` : ''}`}
        >
          {verInactivos ? 'Mostrar solo lo activo' : 'Mostrar también lo desactivado'}
        </Link>
      </form>

      <p className="menor gris" style={{ margin: 0 }}>
        {filas.length === TOPE
          ? `Se muestran las primeras ${numero(TOPE)} filas. Afiná la búsqueda.`
          : `${numero(filas.length)} ${filas.length === 1 ? 'fila' : 'filas'}${verInactivos ? ', activas e inactivas' : ' activas'}${busqueda ? ` con «${busqueda}»` : ''}.`}
      </p>

      <TablaRecurso
        recurso={recurso}
        filas={filas}
        etiquetas={etiquetasPorCampo}
        consulta={consulta}
      />

      <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
        Acá no se borra nada: desactivar saca la fila de las
        listas del celular, y los movimientos que ya la usaron se siguen leyendo
        igual. Lo que se desactiva se puede volver a activar cuando haga falta.
      </p>
    </div>
  )
}
