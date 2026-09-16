'use client'

/**
 * El conteo del día: un día, un número.
 *
 * Esto se toca con el papel en la mano, al cerrar el punto y con el turno
 * terminado. Por eso no hay nada que elegir salvo el día, el número se ajusta
 * con el pulgar y todo lo que se escribió queda si el guardado falla.
 */

import { useActionState, useState } from 'react'
import { guardarConteoDelDia, type EstadoConteo } from './acciones'
import estilos from './conteo.module.css'

/** Un día de la ventana que la base deja cargar, ya formateado por el servidor. */
export interface DiaDelConteo {
  /** aaaa-mm-dd: lo que viaja al servidor. */
  clave: string
  /** "Hoy, miércoles 16 de septiembre" — el título de arriba. */
  titulo: string
  /** "Hoy, miércoles 16" — el selector y la lista de abajo. */
  etiqueta: string
  /** "Hoy" o "El lunes 14", para meterlo adentro de una frase. */
  mencion: string
  /** 16/09/2026. */
  fecha: string
  /** Null si ese día todavía no se cargó. */
  vecinos: number | null
  /** "15 vecinos", ya en plural o singular. Null si no se cargó. */
  resumen: string | null
  observaciones: string
}

/** Los números que más se cargan: la mayoría de los días se llega tocando uno. */
const FRECUENTES = [5, 10, 15, 20, 25]

/** El tope de la base. Más que eso no es un conteo, es un error de tipeo. */
const MAXIMO = 5000

function Menos() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  )
}

function Mas() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

export default function FormularioConteo({ dias }: { dias: DiaDelConteo[] }) {
  const [estado, accion, pendiente] = useActionState<EstadoConteo, FormData>(
    guardarConteoDelDia,
    {},
  )

  const porDia = new Map(dias.map((d) => [d.clave, d]))
  const hoy = dias[0]

  const [fecha, setFecha] = useState(hoy?.clave ?? '')
  // Si el día ya tiene conteo, el campo arranca con lo que hay: esto es tanto
  // para cargar como para corregir, y corregir es leer el número de antes.
  const [vecinos, setVecinos] = useState(
    hoy?.vecinos === null || hoy?.vecinos === undefined ? '' : String(hoy.vecinos),
  )
  const [observaciones, setObservaciones] = useState(hoy?.observaciones ?? '')

  const elegido = porDia.get(fecha)
  const yaCargado = elegido?.vecinos ?? null
  const cuantos = vecinos === '' ? null : Number(vecinos)

  /** Cambiar de día trae lo que ese día ya tenía cargado, o lo deja en blanco. */
  function elegirDia(clave: string) {
    const dia = porDia.get(clave)
    setFecha(clave)
    setVecinos(dia?.vecinos === null || dia?.vecinos === undefined ? '' : String(dia.vecinos))
    setObservaciones(dia?.observaciones ?? '')
  }

  function mover(cuanto: number) {
    const desde = cuantos ?? 0
    setVecinos(String(Math.min(MAXIMO, Math.max(0, desde + cuanto))))
  }

  // La respuesta es de un día concreto. Si el vigilador ya pasó a otro, no tiene
  // por qué seguir viendo el aviso del anterior.
  const respondeAlDia = !estado.fecha || estado.fecha === fecha

  return (
    <>
      <form action={accion} className="pila" noValidate>
        <div className="tarjeta fila-entre">
          <p className={`${estilos.cuando} crecer`}>{elegido?.titulo ?? '—'}</p>
          <label className="sr-solo" htmlFor="fecha">Día del conteo</label>
          <select
            id="fecha"
            name="fecha"
            className={`control ${estilos.selectorDia}`}
            value={fecha}
            onChange={(e) => elegirDia(e.target.value)}
          >
            {dias.map((d) => (
              <option key={d.clave} value={d.clave}>{d.etiqueta}</option>
            ))}
          </select>
        </div>

        {yaCargado !== null && (
          <div className="aviso atencion">
            {elegido?.mencion} ya cargaste {elegido?.resumen}. Si el número era otro, corregilo
            y guardá de nuevo.
          </div>
        )}

        <div className="campo">
          <label htmlFor="vecinos">Vecinos que vinieron</label>
          <div className={estilos.contador}>
            <button
              type="button"
              className={`boton secundario ${estilos.paso}`}
              aria-label="Uno menos"
              disabled={cuantos === 0}
              onClick={() => mover(-1)}
            >
              <Menos />
            </button>
            <input
              id="vecinos"
              name="vecinos"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              aria-describedby="ayuda-vecinos"
              className={`control cifras ${estilos.numero}`}
              value={vecinos}
              onChange={(e) => setVecinos(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            <button
              type="button"
              className={`boton secundario ${estilos.paso}`}
              aria-label="Uno más"
              onClick={() => mover(1)}
            >
              <Mas />
            </button>
          </div>

          <div className="sugerencias">
            {FRECUENTES.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={cuantos === v}
                onClick={() => setVecinos(String(v))}
              >
                {v}
              </button>
            ))}
          </div>

          <span className="ayuda" id="ayuda-vecinos">
            Si no vino nadie, cargá 0. Un cero cargado no es lo mismo que un día sin cargar.
          </span>
        </div>

        <div className="campo">
          <label htmlFor="observaciones">
            Observaciones<span className="gris"> · opcional</span>
          </label>
          <input
            id="observaciones"
            name="observaciones"
            type="text"
            className="control"
            autoComplete="off"
            maxLength={200}
            placeholder="Llovió toda la tarde"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
          />
        </div>

        <button type="submit" className="boton exito grande ancho-total" disabled={pendiente}>
          {pendiente
            ? 'Guardando…'
            : yaCargado !== null
              ? 'Corregir el conteo'
              : 'Guardar el conteo del día'}
        </button>

        {respondeAlDia && estado.aviso && (
          <div className="aviso exito" role="status">{estado.aviso}</div>
        )}
        {respondeAlDia && estado.error && (
          <div className="aviso error" role="alert">{estado.error}</div>
        )}
      </form>

      <section className="pila-chica">
        <h2 style={{ fontSize: '1rem' }}>Los últimos días</h2>

        <ul className="lista">
          {dias.map((d) => {
            const marcas = [
              d.vecinos === null ? estilos.sinCargar : '',
              d.clave === fecha ? estilos.elegido : '',
            ].filter(Boolean).join(' ')

            return (
              <li key={d.clave} className={marcas || undefined}>
                <button
                  type="button"
                  className={estilos.dia}
                  aria-current={d.clave === fecha || undefined}
                  onClick={() => elegirDia(d.clave)}
                >
                  <span className={estilos.rotuloDia}>
                    <span className="fuerte">{d.etiqueta}</span>
                    <span className="menor gris cifras">{d.fecha}</span>
                  </span>
                  {d.resumen === null ? (
                    <span className="chip pendiente">Sin cargar</span>
                  ) : (
                    <span className="chip ingreso cifras">{d.resumen}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        <p className="menor gris" style={{ margin: 0 }}>
          Un día sin cargar puede ser un día que el punto estuvo cerrado. Si abrió, tocá el día
          y cargá el conteo.
        </p>
      </section>
    </>
  )
}
