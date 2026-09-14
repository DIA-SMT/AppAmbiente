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
      {/*
        El póster se pinta al instante y el video entra encima cuando termina de
        bajar: nadie se queda mirando un rectángulo negro con mala señal. Es el
        cuadro 0 del propio bucle, así que al arrancar el video no salta nada.
        Muteado y playsInline porque es la única forma de que los celulares
        dejen arrancar un video solo.

        El archivo trae el cruce horneado adentro (el final se funde con el
        principio), así que loop alcanza: no hace falta ni un segundo video ni
        JavaScript para disimular el empalme.
      */}
      <video
        className={css.fondo}
        poster="/video/trituradora-bucle.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
      >
        <source src="/video/trituradora-bucle.mp4" type="video/mp4" />
      </video>
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
