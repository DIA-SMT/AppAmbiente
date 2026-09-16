'use client'

import { useEffect, useState } from 'react'

/**
 * El video de fondo, solo en pantallas grandes.
 *
 * Esconderlo con CSS no alcanza: el navegador igual descarga el archivo. Del
 * relevamiento con la Secretaría surgió que los vigiladores cargan desde sus
 * celulares personales, con sus propios datos y con mala señal en casi todos los
 * puntos. 1,58 MB en la pantalla que abren todos los días sale de su bolsillo,
 * así que en el celular el elemento no llega a existir.
 *
 * El póster va como fondo del contenedor en CSS y se pinta siempre: en el
 * celular es lo único que se ve, y en escritorio tapa el hueco hasta que el
 * video arranca. Es el cuadro 0 del propio bucle, así que no salta.
 */
export default function FondoVideo({ className }: { className: string }) {
  const [enGrande, setEnGrande] = useState(false)

  useEffect(() => {
    const consulta = window.matchMedia('(min-width: 881px)')
    const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)')
    const revisar = () => setEnGrande(consulta.matches && !sinMovimiento.matches)

    revisar()
    consulta.addEventListener('change', revisar)
    sinMovimiento.addEventListener('change', revisar)
    return () => {
      consulta.removeEventListener('change', revisar)
      sinMovimiento.removeEventListener('change', revisar)
    }
  }, [])

  if (!enGrande) return null

  return (
    <video
      className={className}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
    >
      {/* El cruce entre el final y el principio va horneado en el archivo, así
          que loop alcanza: no hace falta JavaScript para disimular el empalme. */}
      <source src="/video/trituradora-bucle.mp4" type="video/mp4" />
    </video>
  )
}
