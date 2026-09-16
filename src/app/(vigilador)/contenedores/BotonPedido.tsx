'use client'

/**
 * Pedir el recambio de un contenedor, abajo del contenedor mismo.
 *
 * Es un toque y nada más: sin formulario que llenar ni confirmación que
 * aceptar, porque esto se toca con guantes y el celular en una mano. Lo urgente
 * y la observación existen, pero escondidas: si estuvieran a la vista, el
 * camino rápido —que es el que se usa— dejaría de serlo.
 *
 * Cuando el contenedor ya tiene un pedido abierto, el botón desaparece: lo
 * único que queda por hacer es cancelarlo, y solo mientras la base lo permita.
 */

import { useState, useTransition } from 'react'
import { cancelarElPedido, pedirElRecambio, type EstadoRecambio } from './acciones'
import estilos from './contenedores.module.css'

/** El pedido en curso, ya escrito por el servidor. */
export interface PedidoAbierto {
  id: string
  /** "Pedido hace 2 días · la coordinación ya avisó". */
  espera: string
  /** Abierto hace más de tres días. */
  demorado: boolean
  /** Dentro de las 24 horas y todavía sin avisar: lo que deja cancelar la base. */
  puedeCancelar: boolean
}

/**
 * Por qué se cancela. Son los dos casos reales —lo retiraron antes de que
 * nadie avisara, o se tocó el contenedor equivocado— y van como botones porque
 * la base pide un motivo y escribirlo con guantes no es una opción.
 */
const MOTIVOS = ['Ya lo retiraron', 'Me equivoqué de contenedor']

/** Un redirect de la server action no es un error de red: hay que dejarlo pasar. */
function esRedireccion(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}

export default function BotonPedido({
  contenedorId,
  corriente,
  pedido,
}: {
  contenedorId: string
  corriente: string
  pedido: PedidoAbierto | null
}) {
  const [estado, setEstado] = useState<EstadoRecambio>({})
  const [detalle, setDetalle] = useState(false)
  const [urgente, setUrgente] = useState(false)
  const [observaciones, setObservaciones] = useState('')
  const [cancelando, setCancelando] = useState(false)
  const [trabajando, iniciar] = useTransition()

  function correr(accion: () => Promise<EstadoRecambio>) {
    setEstado({})
    iniciar(async () => {
      try {
        setEstado(await accion())
      } catch (e) {
        if (esRedireccion(e)) throw e

        // Acá no hay cola sin señal como en el formulario de movimientos: un
        // pedido que no llegó tiene que decirlo, o el vigilador se queda
        // esperando un recambio que nadie sabe que pidió.
        setEstado({ error: 'No se pudo pedir: no hay señal. Probá de nuevo.' })
      }
    })
  }

  function pedir() {
    correr(async () => {
      const respuesta = await pedirElRecambio(contenedorId, urgente, observaciones)
      if (respuesta.ok) {
        setUrgente(false)
        setObservaciones('')
        setDetalle(false)
      }
      return respuesta
    })
  }

  function cancelar(motivo: string) {
    if (!pedido) return
    correr(async () => {
      const respuesta = await cancelarElPedido(pedido.id, motivo)
      if (respuesta.ok) setCancelando(false)
      return respuesta
    })
  }

  return (
    <div className="pila-chica">
      {pedido ? (
        <>
          <div className="fila">
            <span className={`chip ${pedido.demorado ? estilos.demora : 'pendiente'}`}>
              {pedido.demorado ? 'Demorado' : 'Esperando'}
            </span>
            <span className="fuerte crecer">{pedido.espera}</span>
          </div>

          {pedido.puedeCancelar && !cancelando && (
            <button
              type="button"
              className={`boton fantasma chico ${estilos.revelar}`}
              onClick={() => setCancelando(true)}
            >
              Cancelar el pedido
            </button>
          )}

          {pedido.puedeCancelar && cancelando && (
            <div className="pila-chica">
              <p className="menor gris" style={{ margin: 0 }}>¿Por qué se cancela?</p>
              <div className={estilos.motivos}>
                {MOTIVOS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="boton secundario"
                    disabled={trabajando}
                    onClick={() => cancelar(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={`boton fantasma chico ${estilos.revelar}`}
                onClick={() => setCancelando(false)}
              >
                Dejarlo como está
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {detalle && (
            <div className="pila-chica">
              <button
                type="button"
                className={estilos.urgente}
                aria-pressed={urgente}
                onClick={() => setUrgente(!urgente)}
              >
                Urgente · está desbordando
              </button>

              <div className="campo">
                <label htmlFor={`observaciones-${contenedorId}`}>
                  Observaciones<span className="gris"> · opcional</span>
                </label>
                <input
                  id={`observaciones-${contenedorId}`}
                  type="text"
                  className="control"
                  autoComplete="off"
                  maxLength={200}
                  placeholder="Quedó material afuera"
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            className="boton grande ancho-total"
            aria-label={`Pedir recambio del contenedor de ${corriente}`}
            disabled={trabajando}
            onClick={pedir}
          >
            {trabajando ? 'Pidiendo…' : 'Pedir recambio'}
          </button>

          <button
            type="button"
            className={`boton fantasma chico ${estilos.revelar}`}
            onClick={() => setDetalle(!detalle)}
          >
            {detalle ? 'Dejarlo sin detalle' : 'Agregar un detalle'}
          </button>
        </>
      )}

      {estado.aviso && (
        <div className={estado.ok ? 'aviso exito' : 'aviso'} role="status">{estado.aviso}</div>
      )}
      {estado.error && <div className="aviso error" role="alert">{estado.error}</div>}
    </div>
  )
}
