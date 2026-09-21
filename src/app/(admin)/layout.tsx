import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { salir } from '@/app/ingresar/acciones'
import { ErrorSinPermiso, exigirAdmin, pendientesDeCuenta, type Sesion } from '@/lib/sesion'
import PanelCuerpo from './PanelCuerpo'
import { PortonDeCuenta } from './cuenta/Cuenta'
import propios from './cuenta/cuenta.module.css'
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

  /*
   * Lo que sigue es sólo para AVISAR que falta algo: el puntito al lado del
   * nombre y el cartel mientras el navegador cambia de pantalla.
   *
   * El portón de verdad no está acá. Está en exigirPanel(), que cada pantalla
   * del panel llama antes de consultar una sola fila (src/lib/sesion.ts): un
   * layout no sabe en qué ruta está, así que lo único que puede hacer desde acá
   * es dibujar o no dibujar, y para entonces la página ajena ya se armó entera
   * en el servidor y viaja en la respuesta. Se veía con curl, con «ver código
   * fuente» y con el JavaScript apagado.
   *
   * Falla abierto a propósito, igual que exigirPanel. Si esta consulta revienta
   * —la base todavía sin la actualización del correo y el segundo factor, que
   * es un orden posible cuando el SQL y el despliegue son dos pasos sueltos—,
   * el panel sigue andando como antes. Un portón roto que deja pasar es una
   * molestia de un rato; uno roto que no deja pasar es la coordinación entera
   * afuera del sistema, y con una sola cuenta no hay quien lo destrabe desde
   * adentro.
   */
  const pendientes = await pendientesDeCuenta(sesion).catch(() => ({
    correo: false,
    segundoFactor: false,
  }))
  const falta = pendientes.correo || pendientes.segundoFactor

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

        <div className={estilos.usuario}>
          <Link
            href="/cuenta"
            className={propios.enlaceCuenta}
            title={falta ? 'Mi cuenta — te falta completarla' : 'Mi cuenta'}
          >
            <svg
              className={propios.iconoCuenta}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
            <span className={estilos.avatar} aria-hidden="true">
              {sesion.nombre.trim().charAt(0).toUpperCase()}
            </span>
            <span className={estilos.nombre}>{sesion.nombre}</span>
            <span className="sr-solo">
              Mi cuenta{falta ? ' — te falta completarla' : ''}
            </span>
            {falta && <span className={propios.puntoFalta} aria-hidden="true" />}
          </Link>

          <form action={salir}>
            <button type="submit" className={estilos.salir}>Salir</button>
          </form>
        </div>
      </header>
      <div className={estilos.regla} />

      <PanelCuerpo>
        <PortonDeCuenta falta={falta}>{children}</PortonDeCuenta>
      </PanelCuerpo>
    </div>
  )
}
