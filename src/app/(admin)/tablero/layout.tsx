import { exigirPanel } from '@/lib/sesion'
import Bienvenida from './Bienvenida'

/**
 * Los dos tableros (Planta y Puntos Verdes) abren con la misma bienvenida de
 * Applaza, así cambiar de pestaña no hace saltar la pantalla.
 */
export default async function LayoutTablero({ children }: { children: React.ReactNode }) {
  const sesion = await exigirPanel()

  return (
    <>
      <Bienvenida nombre={sesion.nombre} />
      <h2 className="titulo-seccion" style={{ marginBottom: 16 }}>Indicadores</h2>
      {children}
    </>
  )
}
