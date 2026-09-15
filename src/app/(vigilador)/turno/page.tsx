import Link from 'next/link'
import { redirect } from 'next/navigation'
import { listasDelFormulario, movimientosDelTurno } from '@/lib/datos'
import { diaSemana } from '@/lib/formato'
import { sesionActual } from '@/lib/sesion'
import SelectorVigilador, { AvisoPendientes } from './SelectorVigilador'

export const dynamic = 'force-dynamic'

function FlechaAbajo() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v15" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  )
}

function FlechaArriba() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  )
}

export default async function InicioDeTurno() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  // La lista de vigiladores sale del mismo lugar que las del formulario: una
  // sola consulta trae todo lo del sitio. El flujo que se pasa acá solo cambia
  // qué materiales y qué entidades vuelven, y esta pantalla no usa ninguno de
  // los dos: el tipo de sitio sale de la misma respuesta.
  const [listas, movimientos] = await Promise.all([
    listasDelFormulario(sesion, 'planta', 'ingreso'),
    movimientosDelTurno(sesion, 100),
  ])

  const esPuntoVerde = listas.sitio?.tipo === 'punto_verde'
  const textos = esPuntoVerde
    ? {
        ingreso: { rotulo: 'Registrar lo que trae un vecino', detalle: 'Alguien deja material' },
        salida: { rotulo: 'Registrar lo que se lleva alguien', detalle: 'Material que sale del punto' },
      }
    : {
        ingreso: { rotulo: 'Registrar ingreso', detalle: 'Algo que llega al punto' },
        salida: { rotulo: 'Registrar salida', detalle: 'Algo que se lleva alguien' },
      }

  const vigentes = movimientos.filter((m) => m.estado === 'vigente')
  const ingresos = vigentes.filter((m) => m.tipo === 'ingreso').length
  const salidas = vigentes.filter((m) => m.tipo === 'salida').length
  const dia = diaSemana(new Date())

  return (
    <div className="pila">
      <div>
        <h1>{listas.sitio?.nombre ?? sesion.nombre}</h1>
        <p className="gris" style={{ margin: 0 }}>
          {dia.charAt(0).toUpperCase() + dia.slice(1)}
        </p>
      </div>

      <SelectorVigilador sitioId={listas.sitio?.id ?? ''} vigiladores={listas.vigiladores} />
      <AvisoPendientes />

      <Link href="/cargar/ingreso" className="boton-accion ingreso">
        <span className="icono"><FlechaAbajo /></span>
        <span>
          <span className="rotulo">{textos.ingreso.rotulo}</span>
          <span className="detalle">{textos.ingreso.detalle}</span>
        </span>
      </Link>

      <Link href="/cargar/salida" className="boton-accion salida">
        <span className="icono"><FlechaArriba /></span>
        <span>
          <span className="rotulo">{textos.salida.rotulo}</span>
          <span className="detalle">{textos.salida.detalle}</span>
        </span>
      </Link>

      <div className="tarjeta fila-entre">
        <div>
          <p className="fuerte" style={{ margin: 0 }}>
            {vigentes.length === 0
              ? 'Todavía no cargaste nada'
              : vigentes.length === 1
                ? '1 movimiento en el turno'
                : `${vigentes.length} movimientos en el turno`}
          </p>
          {vigentes.length > 0 && (
            <p className="menor gris" style={{ margin: 0 }}>
              {ingresos} {ingresos === 1 ? 'ingreso' : 'ingresos'} · {salidas} {salidas === 1 ? 'salida' : 'salidas'}
            </p>
          )}
        </div>
        <Link href="/hoy" className="boton secundario chico">Ver lo de hoy</Link>
      </div>
    </div>
  )
}
