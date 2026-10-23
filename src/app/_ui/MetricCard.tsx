/**
 * La tarjeta de un número del tablero: el ícono en su recuadro de color, el
 * rótulo, la cifra y lo que haga falta debajo (detalle, variación, nota).
 *
 * El color va por categoría y sale de la paleta: azul para lo que se cuenta,
 * celeste para el volumen, verde sólo para lo ambiental o lo que está bien,
 * ámbar para lo que pide atención.
 */
import type { ReactNode } from 'react'
import { Icono, type NombreDeIcono } from './Icono'
import estilos from './ui.module.css'

export type TonoDeMetrica = 'azul' | 'celeste' | 'verde' | 'ambar'

export function MetricCard({
  rotulo,
  valor,
  icono,
  tono = 'azul',
  alerta = false,
  children,
}: {
  rotulo: string
  valor: string
  icono: NombreDeIcono
  tono?: TonoDeMetrica
  /** Borde y fondo de atención, para la tarjeta que hay que mirar. */
  alerta?: boolean
  children?: ReactNode
}) {
  return (
    <div className={`tarjeta ${estilos.metrica} ${alerta ? estilos.metricaAlerta : ''}`} data-tono={tono}>
      <span className={estilos.icono}>
        <Icono nombre={icono} />
      </span>
      <div className={estilos.metricaCuerpo}>
        <span className="etiqueta">{rotulo}</span>
        <strong className={`cifras ${estilos.cifra}`}>{valor}</strong>
        {children}
      </div>
    </div>
  )
}
