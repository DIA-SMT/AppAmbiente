/**
 * Lo que se muestra cuando una lista no tiene nada: la ilustración del kit
 * (public/institucional/empty-state-registro-residuos.webp), una frase corta
 * y, si hace falta, qué hacer.
 */
import type { ReactNode } from 'react'
import estilos from './ui.module.css'

export function EmptyState({
  titulo,
  children,
  compacto = false,
}: {
  titulo: string
  children?: ReactNode
  /** Sin ilustración grande, para adentro de una tarjeta chica. */
  compacto?: boolean
}) {
  return (
    <div className={`${estilos.vacio} ${compacto ? estilos.vacioCompacto : ''}`}>
      <img
        src="/institucional/empty-state-registro-residuos.webp"
        alt=""
        width={560}
        height={420}
        className={estilos.vacioImagen}
        decoding="async"
        loading="lazy"
      />
      <p className={estilos.vacioTitulo}>{titulo}</p>
      {children && <div className={estilos.vacioTexto}>{children}</div>}
    </div>
  )
}
