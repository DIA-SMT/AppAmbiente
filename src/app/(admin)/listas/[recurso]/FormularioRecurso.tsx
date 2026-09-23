'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { Campo, Opcion, Recurso, ValorFormulario } from '@/lib/recursos'
import estilos from '../listas.module.css'
import { guardar, type EstadoGuardado } from './acciones'

/** Un bloque de la grilla: un campo suelto, o los que comparten `grupo`. */
interface Bloque {
  grupo?: string
  campos: Campo[]
}

/** Junta los campos pegados que declaran el mismo `grupo`; el resto queda solo. */
function enBloques(campos: Campo[]): Bloque[] {
  const bloques: Bloque[] = []
  for (const campo of campos) {
    const ultimo = bloques[bloques.length - 1]
    if (campo.grupo && ultimo && ultimo.grupo === campo.grupo) ultimo.campos.push(campo)
    else bloques.push({ grupo: campo.grupo, campos: [campo] })
  }
  return bloques
}

function Guardar() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? 'Guardando…' : 'Guardar'}
    </button>
  )
}

export default function FormularioRecurso({
  recurso,
  id,
  valores: iniciales,
  opciones,
  rutaCancelar,
}: {
  recurso: Recurso
  /** Null cuando es un alta. */
  id: string | null
  valores: Record<string, ValorFormulario>
  /** Opciones de los campos que salen de otra lista. */
  opciones: Record<string, Opcion[]>
  rutaCancelar: string
}) {
  const [estado, accion] = useActionState<EstadoGuardado, FormData>(guardar, {})
  // El estado del formulario es propio: si el guardado vuelve con un error, lo
  // escrito tiene que seguir ahí.
  const [valores, setValores] = useState(iniciales)

  const texto = (nombre: string) => {
    const v = valores[nombre]
    return typeof v === 'string' ? v : ''
  }
  const lista = (nombre: string) => {
    const v = valores[nombre]
    return Array.isArray(v) ? v : []
  }
  const marcado = (nombre: string) => valores[nombre] === true

  const poner = (nombre: string, valor: ValorFormulario) =>
    setValores((previos) => ({ ...previos, [nombre]: valor }))

  const alternar = (nombre: string, opcion: string, activa: boolean) =>
    setValores((previos) => {
      const actuales = Array.isArray(previos[nombre]) ? (previos[nombre] as string[]) : []
      return {
        ...previos,
        [nombre]: activa ? [...actuales, opcion] : actuales.filter((x) => x !== opcion),
      }
    })

  /** El tilde con su texto al lado. Va suelto o adentro de un grupo. */
  function casilla(campo: Campo) {
    return (
      <label key={campo.nombre} className={estilos.opcion}>
        <input
          type="checkbox"
          name={campo.nombre}
          value="si"
          checked={marcado(campo.nombre)}
          onChange={(e) => poner(campo.nombre, e.target.checked)}
        />
        <span>{campo.etiqueta}</span>
      </label>
    )
  }

  function control(campo: Campo) {
    const error = estado.errores?.[campo.nombre]
    const invalido = error ? true : undefined

    switch (campo.tipo) {
      case 'multi':
        return (
          <div className={estilos.opciones}>
            {(campo.opciones ?? []).map((opcion) => (
              <label key={opcion.valor} className={estilos.opcion}>
                <input
                  type="checkbox"
                  name={campo.nombre}
                  value={opcion.valor}
                  checked={lista(campo.nombre).includes(opcion.valor)}
                  onChange={(e) => alternar(campo.nombre, opcion.valor, e.target.checked)}
                />
                <span>{opcion.etiqueta}</span>
              </label>
            ))}
          </div>
        )

      case 'booleano':
        // Envuelto: si el label cuelga directo de .campo, globals.css lo pinta
        // como rótulo de campo (chiquito y en mayúsculas).
        return <div className={estilos.opciones}>{casilla(campo)}</div>

      case 'select': {
        const disponibles = campo.origen ? opciones[campo.nombre] ?? [] : campo.opciones ?? []
        return (
          <select
            id={campo.nombre}
            name={campo.nombre}
            className="control"
            aria-invalid={invalido}
            value={texto(campo.nombre)}
            onChange={(e) => poner(campo.nombre, e.target.value)}
          >
            <option value="" disabled={campo.obligatorio}>
              {campo.obligatorio ? 'Elegí una opción…' : '— Sin especificar —'}
            </option>
            {disponibles.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</option>
            ))}
          </select>
        )
      }

      case 'color':
        return (
          <input
            id={campo.nombre}
            name={campo.nombre}
            type="color"
            className={estilos.color}
            aria-invalid={invalido}
            value={texto(campo.nombre) || '#126ff5'}
            onChange={(e) => poner(campo.nombre, e.target.value)}
          />
        )

      case 'numero':
        return (
          <input
            id={campo.nombre}
            name={campo.nombre}
            type="number"
            inputMode="decimal"
            className="control"
            aria-invalid={invalido}
            step={campo.entero ? 1 : 'any'}
            min={campo.min}
            max={campo.max}
            value={texto(campo.nombre)}
            onChange={(e) => poner(campo.nombre, e.target.value)}
          />
        )

      case 'numeros':
        return (
          <input
            id={campo.nombre}
            name={campo.nombre}
            type="text"
            inputMode="decimal"
            className="control"
            placeholder="5, 10, 15, 20"
            aria-invalid={invalido}
            value={texto(campo.nombre)}
            onChange={(e) => poner(campo.nombre, e.target.value)}
          />
        )

      default:
        return (
          <input
            id={campo.nombre}
            name={campo.nombre}
            type="text"
            className="control"
            aria-invalid={invalido}
            maxLength={campo.maxLargo}
            autoComplete="off"
            value={texto(campo.nombre)}
            onChange={(e) => poner(campo.nombre, e.target.value)}
          />
        )
    }
  }

  return (
    <form action={accion} className="pila" noValidate>
      <input type="hidden" name="recurso" value={recurso.clave} />
      {id && <input type="hidden" name="id" value={id} />}

      {estado.error && <div className="aviso error" role="alert">{estado.error}</div>}

      {/* Lo que vale para todo el formulario, una sola vez y antes de los
          campos. Colgado de la ayuda de uno le estiraba el alto a su fila de la
          grilla y dejaba al lado dos huecos en blanco. */}
      {recurso.nota && (
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          {recurso.nota}
        </p>
      )}

      <div className={estilos.rejilla}>
        {enBloques(recurso.campos).map((bloque) => {
          // Un grupo de casillas ocupa una fila entera: los tildes van uno al
          // lado del otro y su explicación no le fija el alto a nadie.
          if (bloque.grupo) {
            return (
              <div key={bloque.grupo} className={`campo ${estilos.entero}`}>
                <span className="etiqueta">{bloque.grupo}</span>
                <div className={estilos.opciones}>{bloque.campos.map(casilla)}</div>
                {bloque.campos.map((campo) => campo.ayuda && (
                  <span key={campo.nombre} className="ayuda">{campo.ayuda}</span>
                ))}
                {bloque.campos.map((campo) => estado.errores?.[campo.nombre] && (
                  <span key={campo.nombre} className="error" role="alert">
                    {estado.errores[campo.nombre]}
                  </span>
                ))}
              </div>
            )
          }

          const [campo] = bloque.campos
          const error = estado.errores?.[campo.nombre]
          const sinEtiquetaPropia = campo.tipo === 'booleano'
          const opcional = !campo.obligatorio
            && ['texto', 'numero', 'select'].includes(campo.tipo)

          return (
            <div
              key={campo.nombre}
              className={`campo ${campo.ancho === 'entero' ? estilos.entero : ''}`}
            >
              {!sinEtiquetaPropia && (
                campo.tipo === 'multi'
                  ? <span className="etiqueta">{campo.etiqueta}</span>
                  : (
                    <label htmlFor={campo.nombre}>
                      {campo.etiqueta}{opcional && <span className="gris"> · opcional</span>}
                    </label>
                  )
              )}
              {control(campo)}
              {campo.ayuda && <span className="ayuda">{campo.ayuda}</span>}
              {error && <span className="error" role="alert">{error}</span>}
            </div>
          )
        })}
      </div>

      <div className={estilos.pieFormulario}>
        <Guardar />
        <Link href={rutaCancelar} className="boton secundario">Cancelar</Link>
        {id && (
          <span className="menor gris">
            Los cambios valen para lo que se cargue de acá en adelante. Los
            movimientos ya registrados quedan como estaban.
          </span>
        )}
      </div>
    </form>
  )
}
