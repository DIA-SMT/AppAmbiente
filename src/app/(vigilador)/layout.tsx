/**
 * Marco de las pantallas del celular. Lo mínimo: dónde estoy y cómo salgo.
 * Todo el resto del alto de pantalla es para lo que el vigilador tiene que
 * tocar.
 */
import { redirect } from 'next/navigation'
import { salir } from '@/app/ingresar/acciones'
import { sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

export default async function MarcoVigilador({ children }: { children: React.ReactNode }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')
  if (sesion.rol === 'admin') redirect('/tablero')

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header className="franja">
        <div className="fila-entre">
          <div className="crecer">
            <p className="sobretitulo">Registro de residuos</p>
            <h2 style={{ fontSize: '1.1rem' }}>{sesion.nombre}</h2>
          </div>
          <form action={salir}>
            <button
              type="submit"
              className="boton fantasma chico"
              style={{ color: '#fff', border: '1px solid rgba(255,255,255,.35)' }}
            >
              Salir
            </button>
          </form>
        </div>
      </header>
      <div className="regla" />

      <main
        className="contenido angosto"
        style={{ width: '100%', flex: '1 1 auto', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}
      >
        {children}
      </main>
    </div>
  )
}
