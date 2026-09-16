'use client'

/**
 * Los controles de una pila, abajo de la pila misma.
 *
 * Volteo y riego son un toque y nada más: no hay formulario que llenar ni
 * confirmación que aceptar, porque esto se toca parado al lado de la pila. La
 * temperatura es la excepción y por eso se pide aparte: sin el número no hay
 * nada que anotar.
 */

import { useState, useTransition } from 'react'
import { anotarControl, type EstadoControl } from './acciones'
import estilos from './pila.module.css'

/** Acepta coma decimal, que es lo que muestra el teclado del celular. */
function aNumero(texto: string): number | null {
  const limpio = texto.replace(',', '.').trim()
  if (!limpio) return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

/** Un redirect de la server action no es un error de red: hay que dejarlo pasar. */
function esRedireccion(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}

export default function ControlRapido({ pilaId }: { pilaId: string }) {
  const [estado, setEstado] = useState<EstadoControl>({})
  const [pidiendoGrados, setPidiendoGrados] = useState(false)
  const [grados, setGrados] = useState('')
  const [anotando, iniciar] = useTransition()

  function anotar(tipo: 'volteo' | 'riego' | 'temperatura', valor: number | null = null) {
    setEstado({})
    iniciar(async () => {
      try {
        const respuesta = await anotarControl(pilaId, tipo, valor)
        setEstado(respuesta)
        if (respuesta.ok) {
          setGrados('')
          setPidiendoGrados(false)
        }
      } catch (e) {
        if (esRedireccion(e)) throw e

        // Acá no hay cola sin señal como en el formulario: un control que no
        // llegó tiene que decirlo, o el operario se va creyendo que lo anotó.
        setEstado({ error: 'No se pudo anotar: no hay señal. Probá de nuevo.' })
      }
    })
  }

  function anotarTemperatura() {
    const valor = aNumero(grados)
    if (valor === null) {
      setEstado({ error: 'Escribí la temperatura para poder anotarla.' })
      return
    }
    anotar('temperatura', valor)
  }

  return (
    <div className="pila-chica">
      <div className={estilos.acciones}>
        <button
          type="button"
          className="boton grande"
          disabled={anotando}
          onClick={() => anotar('volteo')}
        >
          Volteo
        </button>
        <button
          type="button"
          className="boton secundario grande"
          disabled={anotando}
          onClick={() => anotar('riego')}
        >
          Riego
        </button>
      </div>

      {pidiendoGrados ? (
        <div className="campo">
          <label htmlFor={`grados-${pilaId}`}>Temperatura en grados</label>
          <div className={estilos.temperatura}>
            <input
              id={`grados-${pilaId}`}
              className="control"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Ej.: 55"
              value={grados}
              onChange={(e) => setGrados(e.target.value)}
            />
            <button type="button" className="boton" disabled={anotando} onClick={anotarTemperatura}>
              Anotar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`boton fantasma chico ${estilos.revelar}`}
          onClick={() => setPidiendoGrados(true)}
        >
          Temperatura
        </button>
      )}

      {estado.aviso && <div className="aviso exito" role="status">{estado.aviso}</div>}
      {estado.error && <div className="aviso error" role="alert">{estado.error}</div>}
    </div>
  )
}
