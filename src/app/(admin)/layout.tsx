import Image from 'next/image'
import { redirect } from 'next/navigation'
import { salir } from '@/app/ingresar/acciones'
import { ErrorSinPermiso, exigirAdmin, type Sesion } from '@/lib/sesion'
import PanelCuerpo from './PanelCuerpo'
import estilos from './PanelLayout.module.css'

export const dynamic = 'force-dynamic'

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  let sesion: Sesion | null = null
  let destino = '/ingresar'

  try {
    sesion = await exigirAdmin()
  } catch (error) {
    // El vigilador tiene sesión válida, solo que este panel no es para él.
    destino = error instanceof ErrorSinPermiso ? '/turno' : '/ingresar'
  }
  if (!sesion) redirect(destino)

  return (
    <div className={estilos.marco}>
      <header className={estilos.encabezado}>
        <div className={estilos.marca}>
          <div className={estilos.logo}>
            <Image
              src="/marca/logo-smt-blanco.png"
              alt="Ciudad San Miguel de Tucumán"
              width={512}
              height={216}
              priority
            />
          </div>
          <span className={estilos.separador} aria-hidden="true" />
          <div className={estilos.identidad}>
            <p>Panel de coordinación</p>
            <strong>Secretaría de Ambiente</strong>
          </div>
        </div>

        <form action={salir} className={estilos.usuario}>
          <span className={estilos.avatar} aria-hidden="true">
            {sesion.nombre.trim().charAt(0).toUpperCase()}
          </span>
          <span className={estilos.nombre}>{sesion.nombre}</span>
          <button type="submit" className={estilos.salir}>Salir</button>
        </form>
      </header>
      <div className={estilos.regla} />

      <PanelCuerpo>{children}</PanelCuerpo>
    </div>
  )
}
