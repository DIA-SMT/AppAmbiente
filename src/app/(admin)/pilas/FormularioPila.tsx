'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { numero } from '@/lib/formato'
import estilos from './pilas.module.css'
import { crearPila, editarPila, type EstadoGuardado } from './acciones'

export interface ValoresPila {
  codigo: string
  sitio_id: string
  fecha_armado: string
  largo_m: string
  ancho_m: string
  alto_m: string
  responsable_id: string
  composicion: string
  notas: string
  activo: boolean
}

export interface Opcion {
  valor: string
  etiqueta: string
}

export default function FormularioPila({
  id,
  valores: iniciales,
  sitios,
  personas,
  rutaCancelar,
}: {
  /** Null cuando es una pila nueva. */
  id: string | null
  valores: ValoresPila
  sitios: Opcion[]
  personas: Opcion[]
  rutaCancelar: string
}) {
  const [estado, accion, pendiente] = useActionState<EstadoGuardado, FormData>(
    id ? editarPila : crearPila,
    {},
  )
  // El estado del formulario es propio: si el guardado vuelve con un error, lo
  // que se escribió tiene que seguir ahí.
  const [valores, setValores] = useState(iniciales)

  const poner = (nombre: keyof ValoresPila, valor: string | boolean) =>
    setValores((previos) => ({ ...previos, [nombre]: valor }))

  const error = (campo: keyof ValoresPila) => estado.errores?.[campo]
  const invalido = (campo: keyof ValoresPila) => (error(campo) ? true : undefined)

  const volumen = ['largo_m', 'ancho_m', 'alto_m'].reduce((total, campo) => {
    const n = Number(String(valores[campo as keyof ValoresPila]).replace(',', '.'))
    return Number.isFinite(n) ? total * n : NaN
  }, 1)

  const medidas: Array<[keyof ValoresPila, string]> = [
    ['largo_m', 'Largo (m)'],
    ['ancho_m', 'Ancho (m)'],
    ['alto_m', 'Alto (m)'],
  ]

  return (
    <form action={accion} className="pila" noValidate>
      {id && <input type="hidden" name="id" value={id} />}

      {estado.error && <div className="aviso error" role="alert">{estado.error}</div>}

      <div className={estilos.rejilla}>
        <div className="campo">
          <label htmlFor="codigo">Código</label>
          <input
            id="codigo"
            name="codigo"
            type="text"
            className="control mono"
            autoComplete="off"
            maxLength={24}
            aria-invalid={invalido('codigo')}
            value={valores.codigo}
            onChange={(e) => poner('codigo', e.target.value)}
          />
          <span className="ayuda">Como se la nombra en la Planta: P-18.</span>
          {error('codigo') && <span className="error" role="alert">{error('codigo')}</span>}
        </div>

        <div className={`campo ${estilos.doble}`}>
          <label htmlFor="sitio_id">Punto</label>
          <select
            id="sitio_id"
            name="sitio_id"
            className="control"
            aria-invalid={invalido('sitio_id')}
            value={valores.sitio_id}
            onChange={(e) => poner('sitio_id', e.target.value)}
          >
            <option value="" disabled>Elegí una opción…</option>
            {sitios.map((s) => (
              <option key={s.valor} value={s.valor}>{s.etiqueta}</option>
            ))}
          </select>
          {error('sitio_id') && <span className="error" role="alert">{error('sitio_id')}</span>}
        </div>

        <div className="campo">
          <label htmlFor="fecha_armado">Fecha de armado</label>
          <input
            id="fecha_armado"
            name="fecha_armado"
            type="date"
            className="control"
            aria-invalid={invalido('fecha_armado')}
            value={valores.fecha_armado}
            onChange={(e) => poner('fecha_armado', e.target.value)}
          />
          <span className="ayuda">El día que se empezó a armar.</span>
          {error('fecha_armado') && (
            <span className="error" role="alert">{error('fecha_armado')}</span>
          )}
        </div>

        <div className="campo">
          <label htmlFor="responsable_id">
            Responsable<span className="gris"> · opcional</span>
          </label>
          <select
            id="responsable_id"
            name="responsable_id"
            className="control"
            aria-invalid={invalido('responsable_id')}
            value={valores.responsable_id}
            onChange={(e) => poner('responsable_id', e.target.value)}
          >
            <option value="">— Sin asignar —</option>
            {personas.map((p) => (
              <option key={p.valor} value={p.valor}>{p.etiqueta}</option>
            ))}
          </select>
          {error('responsable_id') && (
            <span className="error" role="alert">{error('responsable_id')}</span>
          )}
        </div>

        <div className={`campo ${estilos.entero}`}>
          <span className="etiqueta">Dimensiones</span>
          <div className={estilos.medidas}>
            {medidas.map(([campo, rotulo]) => (
              <div className="campo" key={campo}>
                <label htmlFor={campo}>{rotulo}</label>
                <input
                  id={campo}
                  name={campo}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  className="control"
                  aria-invalid={invalido(campo)}
                  value={String(valores[campo])}
                  onChange={(e) => poner(campo, e.target.value)}
                />
                {error(campo) && <span className="error" role="alert">{error(campo)}</span>}
              </div>
            ))}
          </div>
          <span className="ayuda">
            La medida real de la Planta es 100 × 1 × 1 m.
            {Number.isFinite(volumen) && volumen > 0 && (
              <> Volumen nominal: <span className="fuerte">{numero(volumen, 1)} m³</span>.</>
            )}
          </span>
        </div>

        <div className={`campo ${estilos.entero}`}>
          <label htmlFor="composicion">
            Lo que se le agregó a mano<span className="gris"> · opcional</span>
          </label>
          <textarea
            id="composicion"
            name="composicion"
            className="control"
            rows={2}
            aria-invalid={invalido('composicion')}
            value={valores.composicion}
            onChange={(e) => poner('composicion', e.target.value)}
          />
          <span className="ayuda">
            Tierra, estiércol, restos de la huerta: lo que no entró con un movimiento y por eso no
            se calcula solo. Lo que llegó en camión ya sale de los ingresos.
          </span>
          {error('composicion') && (
            <span className="error" role="alert">{error('composicion')}</span>
          )}
        </div>

        <div className={`campo ${estilos.entero}`}>
          <label htmlFor="notas">Notas<span className="gris"> · opcional</span></label>
          <textarea
            id="notas"
            name="notas"
            className="control"
            rows={2}
            aria-invalid={invalido('notas')}
            value={valores.notas}
            onChange={(e) => poner('notas', e.target.value)}
          />
          {error('notas') && <span className="error" role="alert">{error('notas')}</span>}
        </div>

        {id && (
          <div className={`campo ${estilos.entero}`}>
            <span className="etiqueta">Baja</span>
            <label className={estilos.opcion}>
              <input
                type="checkbox"
                name="activo"
                value="si"
                checked={valores.activo}
                onChange={(e) => poner('activo', e.target.checked)}
              />
              <span>La pila sigue en uso</span>
            </label>
            <span className="ayuda">
              Acá no se borra nada. Destildar la saca de los listados; los ingresos y las salidas
              que ya la nombran se siguen leyendo igual, y se puede volver a activar.
            </span>
          </div>
        )}
      </div>

      <div className={estilos.pieFormulario}>
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? 'Guardando…' : id ? 'Guardar los cambios' : 'Abrir la pila'}
        </button>
        <Link href={rutaCancelar} className="boton secundario">Cancelar</Link>
      </div>
    </form>
  )
}
