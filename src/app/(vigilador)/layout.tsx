/**
 * Marco de las pantallas del celular. Lo mínimo: dónde estoy y cómo salgo.
 * Todo el resto del alto de pantalla es para lo que el vigilador tiene que
 * tocar.
 */
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import BurbujaMigue from '@/app/_migue/BurbujaMigue'
import { apagadoDelPunto, ejemplosDelPunto, PRIVACIDAD_DEL_PUNTO, sitioDelPuntoEnTx } from '@/app/_migue/textos'
import { salir } from '@/app/ingresar/acciones'
import { migueSeMuestra } from '@/lib/migue/pantallas'
import { sesionActual } from '@/lib/sesion'
import estilos from './MarcoVigilador.module.css'

export const dynamic = 'force-dynamic'

export default async function MarcoVigilador({ children }: { children: React.ReactNode }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')
  if (sesion.rol === 'admin') redirect('/tablero')

  // La cara de Migue en la esquina, si la base tiene la 0025. Los ejemplos
  // dependen de qué se hace en el punto, y de ahí la consulta. Falla cerrado:
  // sin base, o sin el punto, el marco sale igual y sin la cara, que lo que
  // se viene a hacer acá es cargar.
  const sitioId = sesion.sitioId
  const sitio = sitioId && (await migueSeMuestra(sesion))
    ? await conSesion(sesion, (tx) => sitioDelPuntoEnTx(tx, sitioId)).catch(() => null)
    : null

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

      {sitio && (
        <BurbujaMigue
          pantalla="/preguntar"
          rol="vigilador"
          dueno={sitio.id}
          privacidad={PRIVACIDAD_DEL_PUNTO}
          apagado={apagadoDelPunto()}
          ejemplos={ejemplosDelPunto(sitio)}
        />
      )}
    </div>
  )
}
