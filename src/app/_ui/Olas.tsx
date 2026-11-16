/**
 * Las tres olas de Applaza, de abajo de una franja: celeste, amarilla y el
 * color del fondo. La ola de fondo se puede cambiar con --ola-fondo.
 */
import estilos from './olas.module.css'

export function Olas({ className = '' }: { className?: string }) {
  return (
    <svg className={`${estilos.olas} ${className}`} viewBox="0 0 1200 110" preserveAspectRatio="none" aria-hidden="true">
      <path className={estilos.celeste} d="M0 110V62c230 40 470 44 700 10 190-28 350-46 500-30v68z" />
      <path className={estilos.amarilla} d="M0 110V84c240 26 480 26 720 0 180-20 330-30 480-18v44z" />
      <path className={estilos.fondo} d="M0 110V100c260 10 520 8 780-8 160-10 300-14 420-8v26z" />
    </svg>
  )
}
