'use client'

import { useActionState, useId, useState } from 'react'
import { ETIQUETA_ENTIDAD, ETIQUETA_FLUJO, numero } from '@/lib/formato'
import { formalizarDestino, type EstadoFormalizacion } from './acciones'
import estilos from './revisiones.module.css'

const TIPOS = Object.entries(ETIQUETA_ENTIDAD)

/**
 * Pasa a la lista un destino que hoy existe solo como texto escrito en el
 * celular. El nombre viene precargado con lo que escribieron, pero editable:
 * casi siempre hay algo que corregir — mayúsculas, una abreviatura, el nombre
 * completo del programa.
 */
export default function FormalizarDestino({
  escrito,
  veces,
  flujos,
}: {
  escrito: string
  veces: number
  flujos: string[]
}) {
  const campo = useId()
  const [nombre, setNombre] = useState(escrito)
  const [tipo, setTipo] = useState('')
  const [flujo, setFlujo] = useState(flujos[0] ?? '')

  const [estado, enviar, enviando] = useActionState<EstadoFormalizacion, FormData>(
    async (_previo, datos) =>
      formalizarDestino(
        escrito,
        String(datos.get('nombre') ?? ''),
        String(datos.get('tipo') ?? ''),
        String(datos.get('flujo') ?? ''),
      ),
    {},
  )

  return (
    <details className={estilos.desplegable}>
      <summary>Convertir en destino de la lista</summary>

      <div className={estilos.cuerpo}>
        <form action={enviar} className="pila-chica">
          <p>
            Se crea la entidad y, en la misma operación,{' '}
            {veces === 1 ? 'el movimiento que hoy dice' : `los ${numero(veces)} movimientos que hoy dicen`}{' '}
            <span className="fuerte">«{escrito}»</span> pasan a apuntarla, y también los que lo
            escribieron con otras mayúsculas. Lo que ya salió no pierde la trazabilidad, y de acá en
            adelante el destino se elige de la lista en vez de escribirse.
          </p>

          <div className="campo">
            <label htmlFor={`${campo}-nombre`}>Nombre en la lista</label>
            <input
              id={`${campo}-nombre`}
              name="nombre"
              className="control"
              required
              maxLength={120}
              autoComplete="off"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
            <span className="ayuda">
              Es el que va a ver el vigilador. Si ya existe una entidad con ese nombre, se usa esa y
              no se crea otra.
            </span>
          </div>

          <div className="campo">
            <label htmlFor={`${campo}-tipo`}>Qué es</label>
            <select
              id={`${campo}-tipo`}
              name="tipo"
              className="control"
              required
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
            >
              <option value="">Elegí el tipo…</option>
              {TIPOS.map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>{etiqueta}</option>
              ))}
            </select>
          </div>

          {flujos.length > 1 ? (
            <div className="campo">
              <label htmlFor={`${campo}-flujo`}>Dónde se ofrece</label>
              <select
                id={`${campo}-flujo`}
                name="flujo"
                className="control"
                required
                value={flujo}
                onChange={(e) => setFlujo(e.target.value)}
              >
                {flujos.map((f) => (
                  <option key={f} value={f}>{ETIQUETA_FLUJO[f] ?? f}</option>
                ))}
              </select>
              <span className="ayuda">
                Este destino apareció en más de un flujo. Queda habilitado en el que elijas; el otro
                se agrega después desde Listas.
              </span>
            </div>
          ) : (
            <input type="hidden" name="flujo" value={flujo} />
          )}

          {estado.error && <p className={estilos.error} role="alert">{estado.error}</p>}

          <button type="submit" className="boton ancho-total" disabled={enviando}>
            {enviando ? 'Formalizando…' : `Formalizar «${nombre.trim() || escrito}»`}
          </button>
        </form>
      </div>
    </details>
  )
}
