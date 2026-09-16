import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { consultarConSesion } from '@db/sesion'
import { listasDelFormulario, pilasEnFormacion, pilasParaDespachar } from '@/lib/datos'
import { paraInputFechaHora } from '@/lib/formato'
import { sesionActual, type Sesion } from '@/lib/sesion'
import type { FilaPila, Flujo } from '@/lib/tipos'
import FormularioMovimiento from './FormularioMovimiento'

export const dynamic = 'force-dynamic'

/**
 * El flujo no lo elige el vigilador: es el tipo del sitio donde trabaja.
 *
 * Hay que saberlo antes de pedir las listas, porque listasDelFormulario ya
 * filtra los materiales y las entidades por flujo. Leer el sitio del perfil es
 * una consulta de una fila; pedir las listas dos veces sería mucho más caro.
 */
async function flujoDelSitio(sesion: Sesion): Promise<Flujo> {
  // La coordinadora no tiene sitio propio: sigue viendo la Planta, como en la fase 1.
  if (!sesion.sitioId) return 'planta'

  const [sitio] = await consultarConSesion<{ tipo: string }>(
    sesion,
    `select tipo from sitios where id = $1`,
    [sesion.sitioId],
  )
  return sitio?.tipo === 'punto_verde' ? 'punto_verde' : 'planta'
}

export default async function Cargar({ params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params
  if (tipo !== 'ingreso' && tipo !== 'salida') notFound()

  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  const flujo = await flujoDelSitio(sesion)

  // Las pilas solo existen en la Planta, y cada tipo de movimiento ofrece las
  // suyas: a un ingreso entra la que se está armando, de una salida sale una que
  // ya se pueda despachar. En un punto verde no hay ninguna y el campo no existe.
  const [listas, pilas] = await Promise.all([
    listasDelFormulario(sesion, flujo, tipo),
    flujo !== 'planta'
      ? Promise.resolve<FilaPila[]>([])
      : tipo === 'ingreso'
        ? pilasEnFormacion(sesion)
        : pilasParaDespachar(sesion),
  ])

  const esPuntoVerde = flujo === 'punto_verde'
  const titulo = esPuntoVerde
    ? tipo === 'ingreso' ? 'Registrar lo que trae un vecino' : 'Registrar lo que se lleva alguien'
    : tipo === 'ingreso' ? 'Registrar ingreso' : 'Registrar salida'

  return (
    <div className="pila">
      <div className="fila-entre">
        <h1>{titulo}</h1>
        <Link href="/turno" className="boton fantasma chico">Volver</Link>
      </div>

      {listas.materiales.length === 0 ? (
        <div className="aviso atencion">
          No hay materiales habilitados para {tipo === 'ingreso' ? 'ingresos' : 'salidas'} en este punto.
          Avisale a la coordinadora.
        </div>
      ) : (
        <FormularioMovimiento
          tipo={tipo}
          flujo={flujo}
          listas={listas}
          pilas={pilas}
          ahora={paraInputFechaHora()}
        />
      )}
    </div>
  )
}
