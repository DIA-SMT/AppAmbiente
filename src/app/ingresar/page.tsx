import Image from 'next/image'
import { redirect } from 'next/navigation'
import { sitiosParaIngreso } from '@/lib/acceso'
import { sesionActual } from '@/lib/sesion'
import FormularioIngreso from './FormularioIngreso'

export const dynamic = 'force-dynamic'

export default async function PantallaIngreso() {
  const sesion = await sesionActual()
  if (sesion) redirect(sesion.rol === 'admin' ? '/tablero' : '/turno')

  const sitios = await sitiosParaIngreso()

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header className="franja" style={{ paddingBottom: 26, paddingTop: 'calc(28px + env(safe-area-inset-top))' }}>
        <div className="angosto">
          <Image
            src="/marca/logo-smt-blanco.png"
            alt="Ciudad San Miguel de Tucumán"
            width={512} height={216}
            style={{ height: 34, width: 'auto' }}
            priority
          />
          <p className="sobretitulo" style={{ marginTop: 20 }}>
            Secretaría de Ambiente y Desarrollo Sustentable
          </p>
          <h1 style={{ fontSize: '1.75rem' }}>Registro de residuos</h1>
        </div>
      </header>
      <div className="regla" />

      <div className="contenido angosto" style={{ width: '100%', paddingTop: 26 }}>
        <FormularioIngreso sitios={sitios} />
      </div>

      <footer
        className="contenido angosto menor gris"
        style={{ width: '100%', marginTop: 'auto', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}
      >
        <div className="fila" style={{ gap: 12, alignItems: 'center' }}>
          <Image
            src="/marca/logo-ia.png"
            alt="Dirección de Inteligencia Artificial"
            width={512} height={216}
            style={{ height: 26, width: 'auto' }}
          />
          <span>Desarrollado por la Dirección de Inteligencia Artificial</span>
        </div>
      </footer>
    </main>
  )
}
