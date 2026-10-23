import Image from 'next/image'
import { redirect } from 'next/navigation'
import { sitiosParaIngreso } from '@/lib/acceso'
import { sesionActual } from '@/lib/sesion'
import FormularioIngreso from './FormularioIngreso'
import css from './ingresar.module.css'

export const dynamic = 'force-dynamic'

export default async function PantallaIngreso() {
  const sesion = await sesionActual()
  if (sesion) redirect(sesion.rol === 'admin' ? '/tablero' : '/turno')

  const sitios = await sitiosParaIngreso()

  return (
    <main className={css.pantalla}>
      <div className={css.capa}>
        <div className={`${css.panel} card-smt`}>
          <header className={css.marca}>
            {/* El isotipo oficial, tal cual viene en el kit: no se redibuja. */}
            <Image
              src="/institucional/isotipo-smt-oficial-original.png"
              alt="Ciudad San Miguel de Tucumán"
              width={235}
              height={235}
              className={css.isotipo}
              priority
            />
            <div className={css.identidad}>
              <span className={css.ciudad}>Ciudad SMT</span>
              <span className={css.secretaria}>Secretaría de Ambiente y Desarrollo Sustentable</span>
            </div>
          </header>

          <h1 className={css.titulo}>Registro de residuos</h1>
          <p className={css.bajada}>Control y trazabilidad de los movimientos de residuos.</p>

          <div className={css.regla} />
          <FormularioIngreso sitios={sitios} />

          <footer className={css.pie}>
            <Image
              src="/marca/logo-ia.png"
              alt="Dirección de Inteligencia Artificial"
              width={526}
              height={220}
            />
            <span>Desarrollado por la Dirección de Inteligencia Artificial</span>
          </footer>
        </div>
      </div>
    </main>
  )
}
