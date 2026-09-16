/**
 * Marco de las pantallas del celular. Lo mínimo: dónde estoy y cómo salgo.
 * Todo el resto del alto de pantalla es para lo que el vigilador tiene que
 * tocar.
 */
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { salir } from '@/app/ingresar/acciones'
import { sesionActual } from '@/lib/sesion'
import estilos from './MarcoVigilador.module.css'

export const dynamic = 'force-dynamic'

export default async function MarcoVigilador({ children }: { children: React.ReactNode }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')
  if (sesion.rol === 'admin') redirect('/tablero')

  return (
    <div className={estilos.marco}>
      <header className={estilos.encabezado}>
        <div className={estilos.interior}>
          <div className={estilos.identidad}>
            <Image
              src="/marca/logo-muni-iso.png"
              alt="Municipalidad de San Miguel de Tucumán"
              width={256}
              height={256}
              priority
            />
            <div className="crecer">
              <p>Registro de residuos</p>
              <h2>{sesion.nombre}</h2>
            </div>
          </div>
          <form action={salir}>
            <button type="submit" className={estilos.salir}>Salir</button>
          </form>
        </div>
      </header>
      <div className={estilos.regla} />

      <main className={`contenido angosto ${estilos.contenido}`}>
        {children}
      </main>
    </div>
  )
}
