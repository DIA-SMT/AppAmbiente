import Link from 'next/link'
import { redirect } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import { pilas, sitiosVisibles } from '@/lib/datos'
import { claveDeCalendario, fechaDeCalendario, numero, paraInputFechaHora } from '@/lib/formato'
import { UUID } from '@/lib/recursos'
import { exigirAdmin } from '@/lib/sesion'
import type { EstadoPila, FilaPila } from '@/lib/tipos'
import FormularioPila, { type Opcion, type ValoresPila } from './FormularioPila'
import estilos from './pilas.module.css'

export const dynamic = 'force-dynamic'

const MS_DIA = 86_400_000

/** El orden natural del ciclo, que no es el alfabético que devuelve la base. */
const CICLO: Array<{ estado: EstadoPila; titulo: string; explica: string }> = [
  { estado: 'en_formacion', titulo: 'En formación', explica: 'todavía reciben material' },
  { estado: 'madurando', titulo: 'Madurando', explica: 'cerradas, contando los meses' },
  { estado: 'lista', titulo: 'Listas para despachar', explica: 'terminaron la maduración' },
  { estado: 'despachada', titulo: 'Despachadas', explica: 'ya salieron de la Planta' },
]

const ETIQUETA_ESTADO: Record<EstadoPila, string> = {
  en_formacion: 'En formación',
  madurando: 'Madurando',
  lista: 'Lista',
  despachada: 'Despachada',
}

const CHIP_ESTADO: Record<EstadoPila, string> = {
  en_formacion: 'chip diferida',
  madurando: 'chip',
  lista: 'chip ingreso',
  despachada: 'chip pendiente',
}

/** La medida real de las pilas de la Planta: una nueva arranca así. */
const DIMENSIONES = { largo_m: '100', ancho_m: '1', alto_m: '1' }

type Parametros = { [clave: string]: string | string[] | undefined }

function texto(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? ''
}


function enMs(v: string | Date | null | undefined): number | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/** Cuánto lleva madurando y cuánto le falta, para la barra y para el texto. */
function maduracion(p: FilaPila) {
  const cierre = enMs(p.fecha_cierre)
  const fin = enMs(p.madurez)
  if (cierre === null || fin === null) return null

  const total = Math.round((fin - cierre) / MS_DIA)
  if (total <= 0) return null

  const restante = Number(p.dias_para_madurez ?? 0)
  const porcentaje = Math.max(0, Math.min(100, Math.round(((total - restante) * 100) / total)))
  return { total, restante, porcentaje }
}

function textoDeMadurez(p: FilaPila, restante: number): string {
  if (restante > 1) return `Madura el ${fechaDeCalendario(p.madurez)} · faltan ${numero(restante)} días`
  if (restante === 1) return 'Madura mañana'
  if (restante === 0) return 'Madura hoy'
  return `Lista hace ${numero(-restante)} ${restante === -1 ? 'día' : 'días'}`
}

/** Desde el último volteo o, si nunca se volteó, desde que se cerró la pila. */
function diasSinVoltear(p: FilaPila): number | null {
  const desde = enMs(p.ultimo_volteo) ?? enMs(p.fecha_cierre)
  if (desde === null) return null
  return Math.max(0, Math.floor((Date.now() - desde) / MS_DIA))
}

export default async function PantallaPilas({
  searchParams,
}: {
  searchParams: Promise<Parametros>
}) {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const sp = await searchParams
  const ver = texto(sp.ver)
  const verBajas = texto(sp.bajas) === '1'
  const guardado = texto(sp.guardado)
  const idEditar = texto(sp.editar)
  const esNueva = texto(sp.nueva) === '1'

  // Diecisiete filas: se piden todas una vez y se agrupa y se cuenta acá, en
  // vez de ir cuatro veces a la base por los mismos datos.
  const todas = await pilas(sesion, { incluirBajas: true })
  const activas = todas.filter((p) => p.activo)

  const cuantas = (estado: EstadoPila) => activas.filter((p) => p.estado === estado).length
  const atrasadas = activas.filter((p) => p.volteo_atrasado).length

  const visibles = todas
    .filter((p) => verBajas || p.activo)
    .filter((p) => {
      if (ver === 'atrasadas') return p.volteo_atrasado
      if (CICLO.some((c) => c.estado === ver)) return p.estado === ver
      return true
    })

  // ── Pila que se está editando ─────────────────────────────────────────
  // v_pilas trae el nombre del responsable, no su id, y el formulario necesita
  // el id: la fila de edición sale de la tabla.
  interface FilaEdicion {
    id: string
    codigo: string
    sitio_id: string
    fecha_armado: string | Date | null
    largo_m: string | number | null
    ancho_m: string | number | null
    alto_m: string | number | null
    responsable_id: string | null
    composicion: string | null
    notas: string | null
    activo: boolean
  }

  let enEdicion: FilaEdicion | null = null
  if (idEditar && UUID.test(idEditar)) {
    const [fila] = await consultarConSesion<FilaEdicion>(
      sesion,
      `select id, codigo, sitio_id, fecha_armado, largo_m, ancho_m, alto_m,
              responsable_id, composicion, notas, activo
         from pilas where id = $1`,
      [idEditar],
    )
    enEdicion = fila ?? null
  }
  const seFueLaPila = Boolean(idEditar) && !enEdicion
  const mostrarFormulario = esNueva || Boolean(enEdicion)

  // ── Listas del formulario ─────────────────────────────────────────────
  let sitios: Opcion[] = []
  let personas: Opcion[] = []
  if (mostrarFormulario) {
    const [filasSitios, filasPersonas] = await Promise.all([
      sitiosVisibles(sesion),
      consultarConSesion<{ id: string; nombre: string; rol: string }>(
        sesion,
        'select id, nombre, rol from personas_publicas where activo order by nombre',
      ),
    ])
    sitios = filasSitios.map((s) => ({ valor: s.id, etiqueta: s.nombre }))
    personas = filasPersonas.map((p) => ({ valor: p.id, etiqueta: `${p.nombre} · ${p.rol}` }))
  }

  const planta = sitios.find((s) => s.etiqueta.toLowerCase().includes('planta'))

  const valores: ValoresPila = enEdicion
    ? {
        codigo: enEdicion.codigo,
        sitio_id: enEdicion.sitio_id,
        fecha_armado: claveDeCalendario(enEdicion.fecha_armado) ?? '',
        largo_m: String(enEdicion.largo_m ?? DIMENSIONES.largo_m),
        ancho_m: String(enEdicion.ancho_m ?? DIMENSIONES.ancho_m),
        alto_m: String(enEdicion.alto_m ?? DIMENSIONES.alto_m),
        responsable_id: enEdicion.responsable_id ?? '',
        composicion: enEdicion.composicion ?? '',
        notas: enEdicion.notas ?? '',
        activo: enEdicion.activo,
      }
    : {
        codigo: '',
        sitio_id: planta?.valor ?? sitios[0]?.valor ?? '',
        // Hoy en Tucumán: el día UTC se adelanta después de las nueve de la noche.
        fecha_armado: paraInputFechaHora().slice(0, 10),
        ...DIMENSIONES,
        responsable_id: '',
        composicion: '',
        notas: '',
        activo: true,
      }

  // ── Enlaces que conservan el filtro ───────────────────────────────────
  const base = new URLSearchParams()
  if (ver) base.set('ver', ver)
  if (verBajas) base.set('bajas', '1')
  const rutaLista = `/pilas${base.toString() ? `?${base}` : ''}`

  const con = (extra: Record<string, string>) => {
    const p = new URLSearchParams(base)
    for (const [clave, valor] of Object.entries(extra)) p.set(clave, valor)
    return `/pilas?${p.toString()}`
  }

  const filtrada = (destino: string) => {
    const p = new URLSearchParams()
    if (verBajas) p.set('bajas', '1')
    if (destino) p.set('ver', destino)
    return `/pilas${p.toString() ? `?${p}` : ''}`
  }

  const conBajas = new URLSearchParams()
  if (ver) conBajas.set('ver', ver)
  if (!verBajas) conBajas.set('bajas', '1')

  const tarjetas: Array<{ clave: string; cifra: number; rotulo: string; marcada?: boolean }> = [
    { clave: 'en_formacion', cifra: cuantas('en_formacion'), rotulo: 'en formación' },
    { clave: 'madurando', cifra: cuantas('madurando'), rotulo: 'madurando' },
    { clave: 'lista', cifra: cuantas('lista'), rotulo: 'listas para despachar' },
    { clave: 'atrasadas', cifra: atrasadas, rotulo: 'con el volteo atrasado', marcada: atrasadas > 0 },
  ]

  return (
    <div className="pila">
      <header className="pila-chica">
        <div className="fila-entre">
          <h1>Pilas de compost</h1>
          {!mostrarFormulario && (
            <Link href={con({ nueva: '1' })} className="boton">Abrir una pila nueva</Link>
          )}
        </div>
        <p className="gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Las pilas de la Planta maduran entre cuatro y cinco meses desde que se cierran. Acá está
          en cuál anda cada una, cuándo va a estar lista y cuáles se están quedando sin voltear.
        </p>
      </header>

      {guardado && (
        <div className="aviso exito" role="status">Se guardó la pila «{guardado}».</div>
      )}
      {seFueLaPila && (
        <div className="aviso atencion" role="alert">
          Esa pila ya no está. Puede que la haya cambiado otra persona.
        </div>
      )}

      <section className={estilos.resumen}>
        {tarjetas.map((t) => {
          const clases = `tarjeta ${estilos.dato}${t.marcada ? ` ${estilos.marcada}` : ''}`
          const contenido = (
            <>
              <span className={estilos.cifra}>{numero(t.cifra)}</span>
              <span className={estilos.rotulo}>{t.rotulo}</span>
            </>
          )
          return t.cifra > 0 ? (
            <Link
              key={t.clave}
              href={filtrada(t.clave)}
              className={clases}
              aria-current={ver === t.clave ? 'page' : undefined}
            >
              {contenido}
            </Link>
          ) : (
            <div key={t.clave} className={clases}>{contenido}</div>
          )
        })}
      </section>

      {atrasadas > 0 && (
        <div className="aviso atencion">
          <span className="fuerte">
            Sin voltear hace más de tres semanas:{' '}
            <span className="mono">
              {activas.filter((p) => p.volteo_atrasado).map((p) => p.codigo).join(' · ')}
            </span>.
          </span>{' '}
          Una pila que madura sin volteo se compacta, se apaga y termina perdida.{' '}
          <Link href={filtrada('atrasadas')}>Ver solo esas</Link>.
        </div>
      )}

      {mostrarFormulario && (
        <section className="tarjeta pila" id="formulario">
          <h2>{enEdicion ? `Editar la pila ${enEdicion.codigo}` : 'Abrir una pila nueva'}</h2>
          <FormularioPila
            key={enEdicion ? enEdicion.id : 'nueva'}
            id={enEdicion ? enEdicion.id : null}
            valores={valores}
            sitios={sitios}
            personas={personas}
            rutaCancelar={rutaLista}
          />
        </section>
      )}

      <div className="fila" style={{ gap: 10 }}>
        <span className="menor gris crecer">
          {ver
            ? `${numero(visibles.length)} ${visibles.length === 1 ? 'pila' : 'pilas'} en el filtro`
            : `${numero(visibles.length)} ${visibles.length === 1 ? 'pila' : 'pilas'}${verBajas ? ', de baja incluidas' : ''}`}
        </span>
        {ver && <Link className="boton fantasma" href={filtrada('')}>Ver todas</Link>}
        <Link className="boton fantasma" href={`/pilas${conBajas.toString() ? `?${conBajas}` : ''}`}>
          {verBajas ? 'Ocultar las dadas de baja' : 'Mostrar también las dadas de baja'}
        </Link>
      </div>

      {visibles.length === 0 ? (
        <div className="tarjeta pila-chica centrado" style={{ padding: 32 }}>
          <h3>No hay pilas para mostrar</h3>
          <p className="menor gris" style={{ margin: 0 }}>
            {ver
              ? 'Con este filtro no queda ninguna. Probá con «Ver todas».'
              : 'Todavía no se abrió ninguna pila. La primera se abre con el botón de arriba.'}
          </p>
        </div>
      ) : (
        CICLO.map((grupo) => {
          const delGrupo = visibles.filter((p) => p.estado === grupo.estado)
          if (!delGrupo.length) return null

          return (
            <section key={grupo.estado} className={estilos.grupo}>
              <div className={estilos.tituloGrupo}>
                <h2>{grupo.titulo}</h2>
                <span className="menor gris">
                  {numero(delGrupo.length)} · {grupo.explica}
                </span>
              </div>

              <ul className="lista">
                {delGrupo.map((p) => {
                  const m = maduracion(p)
                  const sinVoltear = p.volteo_atrasado ? diasSinVoltear(p) : null
                  const clasesBarra = [
                    estilos.barra,
                    m && m.restante <= 0 ? estilos.completa : '',
                    p.volteo_atrasado ? estilos.atrasada : '',
                  ].filter(Boolean).join(' ')

                  return (
                    <li key={p.id}>
                      <Link href={`/pilas/${p.id}`} className={estilos.filaPila}>
                        <div className="fila" style={{ gap: 8 }}>
                          <span className={estilos.codigo}>{p.codigo}</span>
                          <span className={CHIP_ESTADO[p.estado]}>
                            {ETIQUETA_ESTADO[p.estado]}
                          </span>
                          {p.volteo_atrasado && <span className="chip salida">Volteo atrasado</span>}
                          {!p.activo && <span className="chip anulado">Dada de baja</span>}
                        </div>

                        {m ? (
                          <div className={estilos.maduracion}>
                            <div className={clasesBarra} aria-hidden="true">
                              <div className={estilos.avance} style={{ width: `${m.porcentaje}%` }} />
                            </div>
                            <div className={estilos.extremos}>
                              <span>Cerrada el {fechaDeCalendario(p.fecha_cierre)}</span>
                              <span>{textoDeMadurez(p, m.restante)}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="menor gris" style={{ margin: 0 }}>
                            Todavía sin cerrar: la maduración se cuenta desde el día que se cierra.
                          </p>
                        )}

                        <div className={estilos.marcas}>
                          <span>
                            {p.dias_desde_armado === null
                              ? 'Sin fecha de armado'
                              : <>Armada hace <b>{numero(Number(p.dias_desde_armado))} días</b></>}
                          </span>
                          <span>
                            <b>{numero(Number(p.volteos))}</b> volteos ·{' '}
                            <b>{numero(Number(p.riegos))}</b> riegos
                          </span>
                          <span>Entraron <b>{numero(p.m3_ingresados, 1)} m³</b></span>
                          <span>Salieron <b>{numero(p.m3_despachados, 1)} m³</b></span>
                        </div>

                        {p.volteo_atrasado && (
                          <p className="aviso atencion menor" style={{ margin: 0 }}>
                            {Number(p.volteos) === 0
                              ? 'Nunca se volteó desde que se cerró'
                              : `Hace ${numero(sinVoltear ?? 0)} días que no se voltea`}
                            : más de tres semanas sin volteo y la pila se compacta, se apaga y se
                            pierde.
                          </p>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })
      )}

      <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
        Los m³ que entraron y los que salieron no se declaran: salen de los ingresos y las salidas
        que se cargaron con esa pila. Cada pila abre su ficha con de qué está hecha, cómo se la
        trató y adónde fue lo que salió.
      </p>
    </div>
  )
}
