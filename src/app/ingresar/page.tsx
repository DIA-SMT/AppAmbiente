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
      <div className={css.velo} />

      <div className={css.capa}>
        <header className={css.marca}>
          <Image
            src="/marca/logo-smt-blanco.png"
            alt="Ciudad San Miguel de Tucumán"
            width={512}
            height={216}
            priority
          />
          <p className={css.sobretitulo}>Secretaría de Ambiente y Desarrollo Sustentable</p>
          <h1 className={css.titulo}>Registro de residuos</h1>
        </header>

        <div className={css.centro}>
          <div className={css.panel}>
            <div className={css.regla} />
            <FormularioIngreso sitios={sitios} />
          </div>
        </div>

        <footer className={css.pie}>
          <Image
            src="/marca/logo-ia.png"
            alt="Dirección de Inteligencia Artificial"
            width={512}
            height={216}
          />
          <span>Desarrollado por la Dirección de Inteligencia Artificial</span>
        </footer>
      </div>
    </main>
  )
}
