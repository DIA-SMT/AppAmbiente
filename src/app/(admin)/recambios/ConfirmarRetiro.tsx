'use client'

/**
 * Las dos piezas de cliente de la cola de recambios.
 *
 * Van juntas en un archivo porque son dos botones, no dos pantallas, y porque
 * las dos existen por la misma razón: el circuito real sigue pasando por el
 * WhatsApp de la empresa, y lo único que la app puede hacer es facilitar el
 * puente y registrar lo que pasó de este lado.
 */

import { useActionState, useId, useState } from 'react'
import { confirmar } from './acciones'
import estilos from './recambios.module.css'

export default function ConfirmarRetiro({
  id,
  punto,
  corriente,
  hoy,
  desde,
}: {
  id: string
  punto: string
  corriente: string
  /** Hoy en Tucumán, calculado en el servidor: acá no se puede leer el reloj sin romper la hidratación. */
  hoy: string
  /** Día en que se avisó a la empresa. Null si el pedido todavía no se avisó. */
  desde: string | null
}) {
  const campo = useId()

  // La acción vuelve siempre a la pantalla —con el retiro cerrado o con el
  // motivo por el que no se pudo—, así que acá no hay estado que guardar: lo
  // único que se necesita es apagar el botón mientras viaja.
  const [, enviar, enviando] = useActionState<null, FormData>(
    async (_previo, datos) => {
      await confirmar(id, datos)
      return null
    },
    null,
  )

  return (
    <details className={estilos.desplegable}>
      <summary>Confirmar el retiro</summary>

      <div className={estilos.cuerpo}>
        <form action={enviar} className="pila-chica">
          <p>
            Cierra el pedido de <span className="fuerte">{corriente}</span> de{' '}
            <span className="fuerte">{punto}</span>.
          </p>

          <div className="campo">
            <label htmlFor={`${campo}-fecha`}>Día del retiro</label>
            <input
              id={`${campo}-fecha`}
              name="fecha"
              type="date"
              className="control"
              defaultValue={hoy}
              min={desde ?? hoy}
              max={hoy}
              required
            />
            <span className="ayuda">
              {desde
                ? 'No puede ser anterior al día en que se avisó a la empresa: la espera se cuenta desde ahí.'
                : 'Este pedido nunca se marcó como avisado, así que el aviso queda registrado ahora '
                  + 'y solo se puede cerrar con la fecha de hoy. Su espera del lado de la empresa no '
                  + 'va a poder medirse.'}
            </span>
          </div>

          <div className="campo">
            <label htmlFor={`${campo}-remito`}>
              Remito<span className="gris"> · opcional</span>
            </label>
            <input
              id={`${campo}-remito`}
              name="remito"
              type="text"
              className="control"
              maxLength={60}
              autoComplete="off"
              placeholder="Número que trae el papel del camión"
            />
            <span className="ayuda">
              Es lo único que después permite cruzar esto contra el Excel que la empresa manda a
              fin de mes. Sin remito el retiro queda registrado igual, pero ese cruce no se puede
              hacer: no hay por dónde atar una fila con la otra.
            </span>
          </div>

          <div className="campo">
            <label htmlFor={`${campo}-peso`}>
              Peso en kilos<span className="gris"> · opcional</span>
            </label>
            <input
              id={`${campo}-peso`}
              name="peso_kg"
              type="text"
              inputMode="decimal"
              className="control"
              autoComplete="off"
              placeholder="Ej.: 320,5"
            />
            <span className="ayuda">Si el remito lo trae. Si no, dejalo vacío.</span>
          </div>

          <button type="submit" className="boton ancho-total" disabled={enviando}>
            {enviando ? 'Cerrando…' : 'Confirmar el retiro'}
          </button>
        </form>
      </div>
    </details>
  )
}

// ── El puente con el WhatsApp que sigue existiendo ──────────────────────

export interface LineaDePedido {
  id: string
  texto: string
}

/**
 * Arma en el portapapeles el mensaje listo para pegar en el grupo de choferes.
 *
 * Copia exactamente los pedidos tildados —lee las casillas del mismo formulario
 * que después los marca como avisados—, así lo que se manda y lo que queda
 * registrado son la misma lista. Si no hay ninguno tildado, copia todos: es el
 * caso de siempre y no tiene sentido hacerla tildar de nuevo lo que ya está.
 */
export function CopiarParaWhatsApp({
  titulo,
  lineas,
}: {
  titulo: string
  lineas: LineaDePedido[]
}) {
  const [copiado, setCopiado] = useState('')
  // Cuando el navegador no deja escribir en el portapapeles, el texto se muestra
  // para copiarlo a mano: quedarse sin mensaje no es una opción, es el trabajo.
  const [aMano, setAMano] = useState('')

  async function copiar(evento: React.MouseEvent<HTMLButtonElement>) {
    const formulario = evento.currentTarget.form
    const elegidos = formulario
      ? new Set(new FormData(formulario).getAll('id').map(String))
      : new Set<string>()

    const cuerpo = elegidos.size ? lineas.filter((l) => elegidos.has(l.id)) : lineas
    const texto = [titulo, ...cuerpo.map((l) => l.texto)].join('\n')

    setAMano('')
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(
        `Copiado: ${cuerpo.length} ${cuerpo.length === 1 ? 'pedido' : 'pedidos'}. Pegalo en el grupo.`,
      )
    } catch {
      setCopiado('')
      setAMano(texto)
    }
  }

  return (
    <>
      <button type="button" className="boton secundario" onClick={copiar}>
        Copiar el texto para WhatsApp
      </button>

      {copiado && (
        <span className={`menor ${estilos.copiado}`} role="status">
          {copiado}
        </span>
      )}

      {aMano && (
        <div className={`campo ${estilos.aMano}`}>
          <label htmlFor="texto-para-whatsapp">
            El navegador no dejó copiar. Seleccioná el texto y copialo a mano
          </label>
          <textarea
            id="texto-para-whatsapp"
            className="control"
            rows={Math.min(lineas.length + 2, 12)}
            readOnly
            value={aMano}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
    </>
  )
}
