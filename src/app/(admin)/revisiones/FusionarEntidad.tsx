'use client'

import { useActionState, useState } from 'react'
import { ETIQUETA_ENTIDAD } from '@/lib/formato'
import { fusionar, type EstadoFusion } from './acciones'
import estilos from './revisiones.module.css'

export interface Candidata {
  id: string
  nombre: string
  tipo: string
}

/**
 * "Don Ramón" y "don ramon" son el mismo carrero escrito dos veces. Acá se
 * elige cuál de las dos queda.
 */
export default function FusionarEntidad({
  pendiente,
  candidatas,
}: {
  pendiente: { id: string; nombre: string }
  candidatas: Candidata[]
}) {
  const [elegida, setElegida] = useState('')

  const [estado, enviar, enviando] = useActionState<EstadoFusion, FormData>(
    async (_previo, datos) => fusionar(pendiente.id, String(datos.get('destino') ?? '')),
    {},
  )

  const nombreElegida = candidatas.find((c) => c.id === elegida)?.nombre
  const campo = `destino-${pendiente.id}`

  return (
    <details className={estilos.desplegable}>
      <summary>Fusionar con…</summary>

      <div className={estilos.cuerpo}>
        {candidatas.length === 0 ? (
          <p>
            No hay ninguna entidad confirmada de este flujo con la que fusionar. Si es alguien
            nuevo de verdad, confirmala; si la definitiva todavía no existe, cargala primero en
            Listas y volvé acá.
          </p>
        ) : (
          <form action={enviar} className="pila-chica">
            <p>
              Los movimientos que hoy apuntan a <span className="fuerte">{pendiente.nombre}</span>{' '}
              pasan a la entidad que elijas, y <span className="fuerte">{pendiente.nombre}</span>{' '}
              queda desactivada. No se borra nada.
            </p>

            <div className="campo">
              <label htmlFor={campo}>Entidad que queda</label>
              <select
                id={campo}
                name="destino"
                className="control"
                required
                value={elegida}
                onChange={(e) => setElegida(e.target.value)}
              >
                <option value="">Elegí una de la lista…</option>
                {candidatas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} · {ETIQUETA_ENTIDAD[c.tipo] ?? c.tipo}
                  </option>
                ))}
              </select>
            </div>

            {estado.error && <p className={estilos.error} role="alert">{estado.error}</p>}

            <button type="submit" className="boton ancho-total" disabled={enviando}>
              {enviando
                ? 'Fusionando…'
                : nombreElegida
                  ? `Fusionar con ${nombreElegida}`
                  : 'Fusionar'}
            </button>
          </form>
        )}
      </div>
    </details>
  )
}
