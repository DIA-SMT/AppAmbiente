import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { listasDelFormulario } from '@/lib/datos'
import { paraInputFechaHora } from '@/lib/formato'
import { sesionActual } from '@/lib/sesion'
import FormularioMovimiento from './FormularioMovimiento'

export const dynamic = 'force-dynamic'

export default async function Cargar({ params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params
  if (tipo !== 'ingreso' && tipo !== 'salida') notFound()

  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  // La fase 1 es la Planta de Valorización; los otros dos flujos entran cuando
  // tengan pantalla propia.
  const listas = await listasDelFormulario(sesion, 'planta', tipo)

  return (
    <div className="pila">
      <div className="fila-entre">
        <h1>{tipo === 'ingreso' ? 'Registrar ingreso' : 'Registrar salida'}</h1>
        <Link href="/turno" className="boton fantasma chico">Volver</Link>
      </div>

      {listas.materiales.length === 0 ? (
        <div className="aviso atencion">
          No hay materiales habilitados para {tipo === 'ingreso' ? 'ingresos' : 'salidas'} en este punto.
          Avisale a la coordinadora.
        </div>
      ) : (
        <FormularioMovimiento tipo={tipo} listas={listas} ahora={paraInputFechaHora()} />
      )}
    </div>
  )
}
