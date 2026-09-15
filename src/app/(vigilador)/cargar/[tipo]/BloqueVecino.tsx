'use client'

/**
 * Los datos del vecino, que son opcionales de punta a punta: el movimiento se
 * registra igual si el vecino no dice nada.
 *
 * Por eso "No quiso dar datos" está arriba y es el botón más grande: es lo que
 * pasa la mayoría de las veces y tiene que resolverse con un toque, sin pasar
 * por tres campos que se van a dejar vacíos.
 */

import { useEffect, useState } from 'react'

export interface DatosVecino {
  sinDatos: boolean
  nombre: string
  telefono: string
  barrio: string
}

export const VECINO_VACIO: DatosVecino = { sinDatos: false, nombre: '', telefono: '', barrio: '' }

/**
 * No escribir nada y tocar el botón son la misma cosa para la base: en los dos
 * casos no hay con qué reconocer a esta persona la próxima vez.
 */
export function vecinoSinDatos(v: DatosVecino): boolean {
  return v.sinDatos || !(v.nombre.trim() || v.telefono.trim() || v.barrio.trim())
}

const CLAVE_BARRIOS = 'ambiente.barrios'
const TOPE_BARRIOS = 30

function barriosDelCelular(): string[] {
  try {
    const crudo: unknown = JSON.parse(localStorage.getItem(CLAVE_BARRIOS) ?? '[]')
    return Array.isArray(crudo) ? crudo.filter((b): b is string => typeof b === 'string') : []
  } catch {
    return [] // modo privado o basura guardada: se sigue sin sugerencias
  }
}

/**
 * Guarda el barrio tipeado en este celular. Sin esta lista, el mismo barrio
 * termina escrito de cinco formas distintas y después no se puede agrupar por
 * nada.
 */
export function recordarBarrio(barrio: string) {
  const limpio = barrio.trim()
  if (limpio.length < 2) return
  try {
    const previos = barriosDelCelular().filter((b) => b.toLowerCase() !== limpio.toLowerCase())
    localStorage.setItem(CLAVE_BARRIOS, JSON.stringify([limpio, ...previos].slice(0, TOPE_BARRIOS)))
  } catch {
    /* modo privado: se pierde la lista de barrios, no el movimiento */
  }
}

export default function BloqueVecino({
  valor,
  alCambiar,
}: {
  valor: DatosVecino
  alCambiar: (valor: DatosVecino) => void
}) {
  const [barrios, setBarrios] = useState<string[]>([])

  // localStorage no existe en el servidor: la lista se lee después de montar.
  useEffect(() => { setBarrios(barriosDelCelular()) }, [])

  function cambiar(cambios: Partial<DatosVecino>) {
    alCambiar({ ...valor, ...cambios })
  }

  return (
    <div className="tarjeta-plana pila" style={{ padding: 14 }}>
      <button
        type="button"
        className={`boton grande ancho-total ${valor.sinDatos ? 'exito' : 'secundario'}`}
        aria-pressed={valor.sinDatos}
        onClick={() => cambiar({ sinDatos: !valor.sinDatos, nombre: '', telefono: '', barrio: '' })}
      >
        No quiso dar datos
      </button>

      {valor.sinDatos ? (
        <span className="menor gris">
          Se registra sin datos del vecino. Tocá de nuevo si al final los da.
        </span>
      ) : (
        <>
          <div className="campo">
            <label htmlFor="vecino-nombre">Nombre</label>
            <input
              id="vecino-nombre"
              className="control"
              type="text"
              maxLength={120}
              autoComplete="off"
              placeholder="Opcional"
              value={valor.nombre}
              onChange={(e) => cambiar({ nombre: e.target.value })}
            />
          </div>

          <div className="campo">
            <label htmlFor="vecino-telefono">Teléfono</label>
            <input
              id="vecino-telefono"
              className="control"
              type="tel"
              inputMode="tel"
              maxLength={40}
              autoComplete="off"
              placeholder="Opcional"
              value={valor.telefono}
              onChange={(e) => cambiar({ telefono: e.target.value })}
            />
            <span className="ayuda">
              El teléfono es lo único que permite saber que es el mismo vecino la próxima vez.
              Sin él, cada visita cuenta como una persona distinta.
            </span>
          </div>

          <div className="campo">
            <label htmlFor="vecino-barrio">Barrio</label>
            <input
              id="vecino-barrio"
              className="control"
              type="text"
              list="barrios-del-celular"
              maxLength={120}
              autoComplete="off"
              placeholder="Opcional"
              value={valor.barrio}
              onChange={(e) => cambiar({ barrio: e.target.value })}
            />
            <datalist id="barrios-del-celular">
              {barrios.map((b) => <option key={b} value={b} />)}
            </datalist>
          </div>
        </>
      )}
    </div>
  )
}
