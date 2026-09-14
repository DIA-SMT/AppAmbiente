import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import { anularMovimiento, movimientoPorId } from '@/lib/datos'
import { ETIQUETA_TIPO, cantidad, fechaHora } from '@/lib/formato'
import { sesionActual } from '@/lib/sesion'
import type { ItemListado } from '@/lib/tipos'

export const dynamic = 'force-dynamic'

/** Diez minutos: lo mismo que permite la política de la base. */
const MINUTOS_PARA_DESHACER = 10

async function deshacer(datos: FormData) {
  'use server'
  const id = String(datos.get('id') ?? '')
  const numero = String(datos.get('numero') ?? '')

  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  const r = await anularMovimiento(sesion, id, 'Deshecho por el vigilador')
  redirect(r.ok ? '/turno' : `/listo/${numero}?tarde=1`)
}

function Tilde() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  )
}

function Antena() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5a9 9 0 0 1 4-2.3" />
      <path d="M8.5 16a4.5 4.5 0 0 1 2-1.2" />
      <path d="M12 19.5h.01" />
      <path d="m3 3 18 18" />
      <path d="M19 12.5a9 9 0 0 0-5.5-2.5" />
    </svg>
  )
}

function textoDelItem(i: ItemListado) {
  const n = Number(i.cantidad)
  return `${i.material_nombre}: ${cantidad(n, {
    nombre: i.unidad_nombre,
    nombre_plural: i.unidad_plural,
    decimales: Number.isInteger(n) ? 0 : 2,
  })}`
}

export default async function Listo({
  params,
  searchParams,
}: {
  params: Promise<{ numero: string }>
  searchParams: Promise<{ tarde?: string }>
}) {
  const { numero: etiqueta } = await params

  if (etiqueta === 'pendiente') {
    return (
      <div className="pila">
        <div className="tarjeta pila centrado">
          <span className="gris" style={{ display: 'block' }}><Antena /></span>
          <h1>Guardado en el celular</h1>
          <p className="gris" style={{ margin: 0 }}>
            Se va a subir cuando vuelva la señal. No hace falta que hagas nada.
          </p>
        </div>

        <Link href="/turno" className="boton grande ancho-total">Cargar otro</Link>
        <Link href="/hoy" className="boton fantasma ancho-total">Ver lo de hoy</Link>
      </div>
    )
  }

  const n = Number(etiqueta)
  if (!Number.isInteger(n) || n <= 0) notFound()

  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  const { tarde } = await searchParams

  const [fila] = await consultarConSesion<{ id: string }>(
    sesion,
    `select id from v_movimientos where numero = $1`,
    [n],
  )
  if (!fila) notFound()

  const detalle = await movimientoPorId(sesion, fila.id)
  if (!detalle) notFound()

  const { movimiento, items } = detalle
  const anulado = movimiento.estado === 'anulado'
  const minutos = (Date.now() - new Date(movimiento.creado_en).getTime()) / 60000
  const sePuedeDeshacer =
    !anulado &&
    movimiento.cargado_por_id === sesion.perfilId &&
    minutos < MINUTOS_PARA_DESHACER

  const lugar = movimiento.tipo === 'ingreso'
    ? `Vino de ${movimiento.origen_nombre ?? '—'}`
    : `Se lo llevó ${movimiento.destino_nombre ?? '—'}`

  return (
    <div className="pila">
      {tarde && (
        <div className="aviso error" role="alert">
          Pasaron más de {MINUTOS_PARA_DESHACER} minutos. Pedile la anulación a la coordinadora.
        </div>
      )}

      <div className="tarjeta pila centrado">
        <span style={{ display: 'block', color: anulado ? 'var(--peligro)' : 'var(--ingreso)' }}>
          <Tilde />
        </span>
        <p className="etiqueta" style={{ margin: 0 }}>
          {anulado ? `${ETIQUETA_TIPO[movimiento.tipo]} anulado` : `${ETIQUETA_TIPO[movimiento.tipo]} registrado`}
        </p>
        <p
          className="cifras"
          style={{ margin: 0, fontSize: '3.4rem', fontWeight: 800, lineHeight: 1, color: 'var(--tinta)' }}
        >
          {movimiento.numero}
        </p>
        <p className="menor gris" style={{ margin: 0 }}>
          Número de movimiento
        </p>
      </div>

      <div className="tarjeta-plana pila-chica" style={{ padding: 14 }}>
        <p className="fuerte" style={{ margin: 0 }}>{items.map(textoDelItem).join(' + ')}</p>
        <p className="menor gris" style={{ margin: 0 }}>
          {lugar} · {fechaHora(movimiento.ocurrido_en)}
        </p>
      </div>

      <Link href={`/cargar/${movimiento.tipo}`} className="boton grande ancho-total">
        Cargar otro
      </Link>
      <Link href="/hoy" className="boton fantasma ancho-total">Ver lo de hoy</Link>

      {sePuedeDeshacer && (
        <form action={deshacer} className="centrado">
          <input type="hidden" name="id" value={movimiento.id} />
          <input type="hidden" name="numero" value={movimiento.numero} />
          <button type="submit" className="boton fantasma chico" style={{ color: 'var(--peligro)' }}>
            Deshacer
          </button>
        </form>
      )}
    </div>
  )
}
