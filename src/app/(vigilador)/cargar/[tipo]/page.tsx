import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import {
  flujoDelSitioEnTx, listasDelFormularioEnTx, pilasEnFormacionEnTx, pilasParaDespacharEnTx,
} from '@/lib/datos'
import { paraInputFechaHora } from '@/lib/formato'
import { sesionActual } from '@/lib/sesion'
import type { FilaPila } from '@/lib/tipos'
import FormularioMovimiento from './FormularioMovimiento'

export const dynamic = 'force-dynamic'

export default async function Cargar({ params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params
  if (tipo !== 'ingreso' && tipo !== 'salida') notFound()

  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  // Una sola transacción para toda la pantalla.
  //
  // Antes el flujo abría la suya y las listas y las pilas abrían otra cada una:
  // tres peajes de cuatro viajes (BEGIN, identidad, consulta, COMMIT), que en
  // serverless ni siquiera se superponen porque el pool tiene una sola conexión.
  // Adentro de un mismo `tx` se paga una vez y el resto viaja encauzado.
  const { flujo, listas, pilas } = await conSesion(sesion, async (tx) => {
    // El flujo no lo elige el vigilador: es el tipo del sitio donde trabaja, y
    // hay que saberlo antes de lo demás, porque decide qué materiales y qué
    // entidades traen las listas y qué pilas hay que ofrecer. Va con await
    // suelto a propósito: es una fila de `sitios` por id, y esperar por ella
    // acá adentro sigue siendo la misma transacción.
    const flujo = await flujoDelSitioEnTx(tx, sesion)

    // Las pilas solo existen en la Planta, y cada tipo de movimiento ofrece las
    // suyas: a un ingreso entra la que se está armando, de una salida sale una
    // que ya se pueda despachar. En un punto verde no hay ninguna y el campo no
    // existe. Con el flujo en mano, las dos se piden juntas.
    const [listas, pilas] = await Promise.all([
      listasDelFormularioEnTx(tx, sesion, flujo, tipo),
      flujo !== 'planta'
        ? Promise.resolve<FilaPila[]>([])
        : tipo === 'ingreso'
          ? pilasEnFormacionEnTx(tx)
          : pilasParaDespacharEnTx(tx),
    ])

    return { flujo, listas, pilas }
  })

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
