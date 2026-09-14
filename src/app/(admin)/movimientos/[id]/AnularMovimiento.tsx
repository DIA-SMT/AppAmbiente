'use client'

import { useActionState, useState } from 'react'
import { anular, type EstadoAnulacion } from '../acciones'

export default function AnularMovimiento({ id, numero }: { id: string; numero: number }) {
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [confirmado, setConfirmado] = useState(false)

  const [estado, enviar, pendiente] = useActionState<EstadoAnulacion, FormData>(
    async (_previo, datos) => anular(id, String(datos.get('motivo') ?? '')),
    {},
  )

  const faltan = 5 - motivo.trim().length
  const listo = faltan <= 0 && confirmado

  if (estado.ok) {
    return (
      <div className="aviso exito" role="status">
        Movimiento Nº {numero} anulado. Queda registrado con el motivo y tu nombre.
      </div>
    )
  }

  if (!abierto) {
    return (
      <section className="tarjeta pila-chica">
        <h2>Anular movimiento</h2>
        <p className="menor gris" style={{ margin: 0 }}>
          Anular no borra: el movimiento Nº {numero} queda en el sistema con el motivo y
          tu nombre, y deja de sumar en los totales y en la exportación.
        </p>
        <div>
          <button type="button" className="boton peligro" onClick={() => setAbierto(true)}>
            Anular movimiento
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="tarjeta pila">
      <h2>Anular el movimiento Nº {numero}</h2>

      {estado.error && <div className="aviso error" role="alert">{estado.error}</div>}

      <form action={enviar} className="pila">
        <div className="campo">
          <label htmlFor="motivo">¿Por qué se anula?</label>
          <textarea
            id="motivo"
            name="motivo"
            className="control"
            required
            minLength={5}
            maxLength={500}
            autoFocus
            placeholder="Ej.: se cargó dos veces el mismo viaje del camión municipal."
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            aria-describedby="ayuda-motivo"
          />
          <span id="ayuda-motivo" className="ayuda">
            {faltan > 0
              ? `Escribí al menos ${faltan} ${faltan === 1 ? 'carácter más' : 'caracteres más'}. El motivo queda guardado y se ve en el detalle.`
              : 'El motivo queda guardado y se ve en el detalle.'}
          </span>
        </div>

        <label
          className="fila"
          style={{ gap: 10, minHeight: 44, alignItems: 'flex-start', flexWrap: 'nowrap', cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={confirmado}
            onChange={(e) => setConfirmado(e.target.checked)}
            style={{ width: 22, height: 22, marginTop: 3, flex: '0 0 auto', accentColor: 'var(--peligro)' }}
          />
          <span className="menor">
            Confirmo la anulación. Entiendo que el movimiento no se borra: queda registrado
            como anulado y no se puede volver atrás desde la pantalla.
          </span>
        </label>

        <div className="fila">
          <button type="submit" className="boton peligro" disabled={!listo || pendiente}>
            {pendiente ? 'Anulando…' : 'Confirmar anulación'}
          </button>
          <button
            type="button"
            className="boton secundario"
            disabled={pendiente}
            onClick={() => { setAbierto(false); setMotivo(''); setConfirmado(false) }}
          >
            Cancelar
          </button>
        </div>
      </form>
    </section>
  )
}
