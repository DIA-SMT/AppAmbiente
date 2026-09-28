'use client'

/**
 * «Olvidar», abajo de cada cosa que Migue recuerda del punto, en dos toques.
 *
 * El primero sólo pregunta, y dice lo que va a hacer el segundo: además de
 * olvidar el recuerdo, se cierran las conversaciones donde Migue lo tenía
 * presente. Con guantes y el celular en una mano, un toque de más no puede
 * cerrarle la charla al que está de turno sin que nadie le avise.
 */

import { useState, useTransition } from 'react'
import { olvidarDelPunto } from './acciones'

/** Un redirect de la server action no es un error de red: hay que dejarlo pasar. */
function esRedireccion(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}

export default function Olvidar({ recuerdoId }: { recuerdoId: string }) {
  const [preguntando, setPreguntando] = useState(false)
  const [error, setError] = useState('')
  const [trabajando, iniciar] = useTransition()

  function olvidar() {
    setError('')
    iniciar(async () => {
      try {
        const respuesta = await olvidarDelPunto(recuerdoId)
        if (respuesta.error) setError(respuesta.error)
      } catch (e) {
        if (esRedireccion(e)) throw e
        // Sin señal no hay cola que lo mande después, como con los
        // movimientos: tiene que decirlo, o el vigilador cree que Migue ya lo
        // olvidó y sigue apareciendo en la próxima conversación.
        setError('No se pudo: no hay señal. Probá de nuevo.')
      }
    })
  }

  if (!preguntando) {
    return (
      // A su ancho y no a lo ancho de la ficha: el primer toque no hace nada
      // todavía, y una lista de botones enteros se leería como una lista de
      // cosas por hacer.
      <button
        type="button"
        className="boton secundario chico"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setPreguntando(true)}
      >
        Olvidar
      </button>
    )
  }

  return (
    <div className="pila-chica">
      <p className="menor" style={{ margin: 0 }}>
        Migue lo olvida, y además cierra las conversaciones donde lo tenía presente: se vacían, y la
        próxima pregunta empieza de cero.
      </p>
      <div className="fila">
        <button type="button" className="boton peligro" disabled={trabajando} onClick={olvidar}>
          {trabajando ? 'Olvidando…' : 'Sí, que lo olvide'}
        </button>
        <button
          type="button"
          className="boton fantasma chico"
          disabled={trabajando}
          onClick={() => { setPreguntando(false); setError('') }}
        >
          Dejarlo
        </button>
      </div>
      {error && <div className="aviso error" role="alert">{error}</div>}
    </div>
  )
}
