'use client'

/**
 * Las piezas de cliente del turno. Van juntas en un módulo porque las tres
 * leen lo mismo —lo que quedó guardado en este celular— y así la suscripción a
 * la cola se arma una sola vez por pantalla.
 */

import { useEffect, useState } from 'react'
import {
  activarSincronizacion, alCambiar, listar, recordado, recordar, sincronizar,
  type EnvioPendiente,
} from '@/lib/cola'
import { hora } from '@/lib/formato'
import type { Persona } from '@/lib/tipos'

function useCola() {
  const [envios, setEnvios] = useState<EnvioPendiente[]>([])

  useEffect(() => {
    const releer = () => { void listar().then(setEnvios) }
    const baja = alCambiar(releer)
    const parar = activarSincronizacion()
    releer()
    return () => { baja(); parar() }
  }, [])

  return envios
}

// ── Quién está de turno ─────────────────────────────────────────────────

/**
 * Son unos 67 y rotan sin asignación fija a cada punto, así que la lista nunca
 * va a estar al día. Por eso elegir el nombre es opcional y no interrumpe: sirve
 * para saber quién cargó cada movimiento, no para habilitar el turno.
 */
export default function SelectorVigilador({
  sitioId,
  vigiladores,
}: {
  sitioId: string
  vigiladores: Persona[]
}) {
  const [elegido, setElegido] = useState('')
  const [cambiando, setCambiando] = useState(false)
  const [montado, setMontado] = useState(false)

  // Se lee después de montar: en el servidor no existe el localStorage y si se
  // adivinara acá la pantalla parpadearía con el nombre equivocado.
  useEffect(() => {
    const guardado = recordado(sitioId, 'vigilador')
    if (guardado && vigiladores.some((v) => v.id === guardado)) setElegido(guardado)
    else if (guardado) recordar(sitioId, 'vigilador', '')
    setMontado(true)
  }, [sitioId, vigiladores])

  if (!montado) return null

  // Si el punto no tiene gente cargada no hay nada que elegir, y avisarlo sería
  // pedirle al vigilador que resuelva algo que no está en sus manos.
  if (vigiladores.length === 0) return null

  const nombre = vigiladores.find((v) => v.id === elegido)?.nombre

  function elegir(id: string) {
    setElegido(id)
    recordar(sitioId, 'vigilador', id)
    setCambiando(false)
  }

  if (nombre && !cambiando) {
    return (
      <div className="fila-entre">
        <p className="menor gris" style={{ margin: 0 }}>
          A cargo: <span className="fuerte">{nombre}</span>
        </p>
        <button type="button" className="boton fantasma chico" onClick={() => setCambiando(true)}>
          Cambiar
        </button>
      </div>
    )
  }

  return (
    <div className="campo">
      <label htmlFor="vigilador-turno">¿Quién está de turno? (opcional)</label>
      <select
        id="vigilador-turno"
        className="control"
        value={elegido}
        onChange={(e) => elegir(e.target.value)}
      >
        <option value="">Sin indicar</option>
        {vigiladores.map((v) => (
          <option key={v.id} value={v.id}>{v.nombre}</option>
        ))}
      </select>
      <span className="ayuda">
        Sirve para saber quién cargó cada movimiento. No hace falta elegirlo: los movimientos se
        registran igual. Queda guardado en este celular hasta que lo cambies.
      </span>
    </div>
  )
}

// ── Pendientes de subir ─────────────────────────────────────────────────

export function AvisoPendientes() {
  const envios = useCola()
  const [subiendo, setSubiendo] = useState(false)

  if (envios.length === 0) return null

  async function reintentar() {
    setSubiendo(true)
    try { await sincronizar() } finally { setSubiendo(false) }
  }

  return (
    <div className="aviso atencion fila-entre">
      <span className="crecer">
        {envios.length === 1
          ? 'Hay 1 movimiento guardado en el celular, sin subir.'
          : `Hay ${envios.length} movimientos guardados en el celular, sin subir.`}
      </span>
      <button type="button" className="boton secundario chico" onClick={reintentar} disabled={subiendo}>
        {subiendo ? 'Subiendo…' : 'Subir ahora'}
      </button>
    </div>
  )
}

/** El bloque que va arriba del listado del turno. */
export function ListaPendientes() {
  const envios = useCola()

  if (envios.length === 0) return null

  return (
    <section className="pila-chica">
      <h3>Sin subir</h3>
      <ul className="lista">
        {envios.map((e) => (
          <li key={e.client_uuid} className="pila-chica">
            <div className="fila">
              <span className="chip pendiente">Sin subir</span>
              <span className="mono menor gris">{hora(e.movimiento.ocurrido_en)}</span>
            </div>
            <div className="fuerte">{e.resumen}</div>
            {e.error && <div className="menor gris">{e.error}</div>}
          </li>
        ))}
      </ul>
      <p className="menor gris" style={{ margin: 0 }}>
        Se suben solos cuando vuelva la señal.
      </p>
    </section>
  )
}
