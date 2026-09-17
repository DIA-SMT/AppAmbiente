import Link from 'next/link'
import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import {
  contenedoresDelSitioEnTx, listasDelFormularioEnTx, movimientosDelTurnoEnTx,
} from '@/lib/datos'
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

/** El conteo en papel: los palitos que se anotan durante la jornada. */
function Palitos() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 5v14" />
      <path d="M11 5v14" />
      <path d="M16 5v14" />
      <path d="M3 18.5 19 5.5" />
    </svg>
  )
}

/** El contenedor del punto: tapa, cuerpo y ruedas. */
function Contenedor() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 6.5h19" />
      <path d="M4.5 6.5 6 18h12l1.5-11.5" />
      <path d="M9.5 4.5h5" />
      <path d="M8 21h.01" />
      <path d="M16 21h.01" />
    </svg>
  )
}

/** Dar vuelta la pila: dos flechas que giran. */
function Voltear() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}

export default async function InicioDeTurno() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  // Una sola transacción para toda la pantalla.
  //
  // Antes cada una de estas cuatro abría la suya, y el Promise.all no
  // paralelizaba nada: el pool en serverless tiene una sola conexión, así que
  // los cuatro conSesion() se hacían fila y cada uno pagaba su peaje de cuatro
  // viajes (BEGIN, identidad, consulta, COMMIT). Pedidas todas sobre el mismo
  // `tx`, el peaje se paga una vez y las consultas viajan encauzadas.
  //
  // La lista de vigiladores sale del mismo lugar que las del formulario: una
  // sola consulta trae todo lo del sitio. El flujo que se pasa acá solo cambia
  // qué materiales y qué entidades vuelven, y esta pantalla no usa ninguno de
  // los dos: el tipo de sitio sale de la misma respuesta.
  const [listas, movimientos, sitios, contenedores] = await conSesion(sesion, (tx) =>
    Promise.all([
      listasDelFormularioEnTx(tx, sesion, 'planta', 'ingreso'),
      movimientosDelTurnoEnTx(tx, 100),
      // `carga_detallada` acá decide el orden de los botones. La fila del sitio
      // que traen las listas ya la incluye en su select, pero el tipo `Sitio`
      // todavía no la declara, así que no se puede leer de ahí sin mentirle a
      // TypeScript. Queda como fila aparte: dentro de esta transacción es una
      // consulta más encauzada con las otras, no un peaje nuevo.
      sesion.sitioId
        ? tx.consultar<{ carga_detallada: boolean }>(
            `select carga_detallada from sitios where id = $1`, [sesion.sitioId],
          )
        : Promise.resolve([]),
      // Cada contenedor trae su pedido abierto si lo tiene: contarlos es lo que
      // hace que el botón diga cuántos están esperando, y ese número es lo que
      // hace que entren.
      contenedoresDelSitioEnTx(tx, sesion),
    ]),
  )

  const esPuntoVerde = listas.sitio?.tipo === 'punto_verde'

  // Donde no se puede usar el celular durante la jornada, el conteo diario no es
  // una opción secundaria: es la forma de cargar, y va primero. Ante la duda
  // manda el modo detallado, que es el de siempre.
  const soloConteo = esPuntoVerde && sitios[0]?.carga_detallada === false
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

  const esperando = contenedores.filter((c) => c.pedido_abierto_id).length

  // Los contenedores son de los puntos verdes: en la Planta no hay ninguno que
  // recambiar. Cuando hay pedidos abiertos el rótulo los cuenta, porque en un
  // punto donde esto es lo único que se hace con el sistema, ese número es la
  // pantalla entera.
  const accesoRecambio = esPuntoVerde && (
    <Link
      href="/contenedores"
      className="boton-accion"
      style={{ borderColor: 'color-mix(in srgb, var(--celeste) 50%, transparent)' }}
    >
      <span className="icono" style={{ background: 'var(--celeste)' }}><Contenedor /></span>
      <span>
        <span className="rotulo">
          {esperando === 0
            ? 'Pedir recambio de contenedor'
            : esperando === 1
              ? '1 contenedor esperando recambio'
              : `${esperando} contenedores esperando recambio`}
        </span>
        <span className="detalle">
          {esperando === 0
            ? 'Cuando uno está lleno o desbordando'
            : 'Mirá cómo va, o pedí el de otra corriente'}
        </span>
      </span>
    </Link>
  )

  // En la Planta no hay vecinos que contar: el conteo no existe.
  const accesoConteo = esPuntoVerde && (
    <Link
      href="/conteo"
      className="boton-accion"
      style={{ borderColor: 'color-mix(in srgb, var(--azul) 40%, transparent)' }}
    >
      <span className="icono" style={{ background: 'var(--azul)' }}><Palitos /></span>
      <span>
        <span className="rotulo">Cargar el conteo del día</span>
        <span className="detalle">
          {soloConteo
            ? 'Cuántos vecinos vinieron, en un solo número'
            : 'Para el día que no se pudo cargar de a uno'}
        </span>
      </span>
    </Link>
  )

  return (
    <div className="pila">
      <div>
        <h1>{listas.sitio?.nombre ?? sesion.nombre}</h1>
        <p className="gris" style={{ margin: 0 }}>
          {dia.charAt(0).toUpperCase() + dia.slice(1)}
        </p>
      </div>

      <AvisoPendientes />

      {soloConteo ? (
        // Este vigilador no registra vecino por vecino: lo suyo es el número del
        // día. Ingreso y salida quedan abajo, para lo que igual llegue a cargar.
        <>
          {accesoConteo}

          {/* Donde no se carga movimiento por movimiento, pedir el recambio es
              lo otro que se hace con el sistema: va arriba, no abajo. */}
          {accesoRecambio}

          <p className="menor gris" style={{ margin: '4px 0 0' }}>
            Si igual llegás a registrar algo en el momento:
          </p>

          <Link href="/cargar/ingreso" className="boton secundario ancho-total">
            {textos.ingreso.rotulo}
          </Link>

          <Link href="/cargar/salida" className="boton secundario ancho-total">
            {textos.salida.rotulo}
          </Link>
        </>
      ) : (
        <>
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

          {/* Tercero y a propósito: acá se carga de a un vecino, y el conteo es
              para el día que no se pudo usar el celular. */}
          {accesoConteo}

          {accesoRecambio}

          {/* Las pilas son de la Planta: un punto verde no tiene ninguna. */}
          {!esPuntoVerde && (
            <Link
              href="/pila"
              className="boton-accion"
              style={{ borderColor: 'color-mix(in srgb, var(--azul) 40%, transparent)' }}
            >
              <span className="icono" style={{ background: 'var(--azul)' }}><Voltear /></span>
              <span>
                <span className="rotulo">Anotar volteo o riego</span>
                <span className="detalle">Control de las pilas</span>
              </span>
            </Link>
          )}
        </>
      )}

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

      {/* Abajo y a propósito: el vigilador entra a esta pantalla a registrar un
          movimiento, y decir quién está de turno es opcional. */}
      <SelectorVigilador sitioId={listas.sitio?.id ?? ''} vigiladores={listas.vigiladores} />
    </div>
  )
}
