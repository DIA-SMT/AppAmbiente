/**
 * La cara de Migue. Sale del dibujo que eligió la Dirección de IA
 * (MigueRecolector), recortada a la cabeza y los hombros y sin fondo: el
 * círculo de color lo pone la hoja de estilos, así se ve igual en los dos temas.
 *
 * Es un archivo de 9 KB hecho a medida (public/migue/migue-cara.webp, 192 × 192,
 * el doble de lo más grande que se dibuja) y no la imagen original, que pesa
 * diez veces más: el vigilador la baja desde un celular, muchas veces con poca
 * señal, para verla en 36 píxeles.
 *
 * Va sin texto alternativo a propósito: al lado siempre dice «Migue», y un
 * lector de pantalla lo leería dos veces.
 */
import estilos from './conversacion.module.css'

const TAMANOS = { chico: 24, burbuja: 36, titulo: 52 } as const

export function Retrato({ tamano }: { tamano: keyof typeof TAMANOS }) {
  const lado = TAMANOS[tamano]
  return (
    <img
      src="/migue/migue-cara.webp"
      alt=""
      width={lado}
      height={lado}
      className={`${estilos.retrato} ${estilos[`retrato_${tamano}`]}`}
      decoding="async"
    />
  )
}
