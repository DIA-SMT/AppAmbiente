import Image from 'next/image'
import { redirect } from 'next/navigation'
import { salir } from '@/app/ingresar/acciones'
import { ErrorSinPermiso, exigirAdmin, type Sesion } from '@/lib/sesion'
import Navegacion from './Navegacion'

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
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header className="franja">
        <div className="ancho fila-entre" style={{ flexWrap: 'wrap', rowGap: 10 }}>
          <div className="fila" style={{ gap: 14 }}>
            <Image
              src="/marca/logo-smt-blanco.png"
              alt="Ciudad San Miguel de Tucumán"
              width={512}
              height={216}
              style={{ height: 30, width: 'auto' }}
              priority
            />
            <div>
              <p className="sobretitulo" style={{ margin: 0 }}>Panel de coordinación</p>
              <h2 style={{ fontSize: '1.05rem' }}>Secretaría de Ambiente</h2>
            </div>
          </div>

          <form action={salir} className="fila" style={{ gap: 10 }}>
            <span className="menor" style={{ opacity: .85 }}>{sesion.nombre}</span>
            <button type="submit" className="boton chico secundario">Salir</button>
          </form>
        </div>
      </header>
      <div className="regla" />

      <Navegacion />

      <main className="contenido ancho" style={{ width: '100%' }}>{children}</main>
    </div>
  )
}
