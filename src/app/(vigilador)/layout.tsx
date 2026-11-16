/**
 * Marco de las pantallas del celular. Lo mínimo: dónde estoy y cómo salgo.
 * Todo el resto del alto de pantalla es para lo que el vigilador tiene que
 * tocar.
 */
import { redirect } from 'next/navigation'
import { Marca } from '@/app/_ui/Marca'
import { conSesion } from '@db/sesion'
import BurbujaMigue from '@/app/_migue/BurbujaMigue'
import { apagadoDelPunto, ejemplosDelPunto, PRIVACIDAD_DEL_PUNTO, sitioDelPuntoEnTx } from '@/app/_migue/textos'
import { salir } from '@/app/ingresar/acciones'
import RecorridoGuiado from '@/app/RecorridoGuiado'
import SelectorDeTema from '@/app/SelectorDeTema'
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
          {/* La barra blanca de Applaza: la marca y, debajo de «Residuos SMT»,
              el punto donde se está cargando. */}
          <div className={estilos.identidad}>
            <Marca compacta prioridad bajada={sesion.nombre} />
          </div>
          <RecorridoGuiado rol="vigilador" autoIniciar className={estilos.ayuda} />
          <SelectorDeTema className={estilos.tema} />
          <form action={salir} data-recorrido="salir">
            <button type="submit" className={estilos.salir} title="Salir">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
              <span>Salir</span>
            </button>
          </form>
        </div>
      </header>
      <div className={estilos.regla} />

      <main className={`contenido angosto ${estilos.contenido}`} data-recorrido="contenido">
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
