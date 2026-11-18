/**
 * La marca combinada, como la de Applaza: el isotipo oficial con el nombre de
 * la ciudad, una raya, y el nombre de esta app con su hojita.
 *
 * El isotipo es el PNG del kit, tal cual: no se redibuja ni se recolorea.
 * `compacta` deja sólo el isotipo y el nombre de la app, para el celular.
 */
import Image from 'next/image'
import estilos from './marca.module.css'

export function Marca({
  compacta = false,
  prioridad = false,
  bajada = 'Secretaría de Ambiente',
}: {
  compacta?: boolean
  prioridad?: boolean
  /** Lo que va abajo de «Residuos SMT». */
  bajada?: string
}) {
  return (
    <span className={`${estilos.marca} ${compacta ? estilos.compacta : ''}`}>
      <Image
        src="/institucional/isotipo-smt-112.webp"
        alt="Ciudad San Miguel de Tucumán"
        width={112}
        height={112}
        priority={prioridad}
      />
      <span className={estilos.ciudad} aria-hidden="true">
        <small>Ciudad</small>
        <b>San Miguel de Tucumán</b>
      </span>
      <i className={estilos.raya} aria-hidden="true" />
      <svg className={estilos.hoja} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
        <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" fill="none" />
      </svg>
      <span className={estilos.app}>
        <b>Residuos SMT</b>
        <small>{bajada}</small>
      </span>
    </span>
  )
}
