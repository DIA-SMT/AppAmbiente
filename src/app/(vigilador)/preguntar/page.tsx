import Link from 'next/link'
import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import Conversacion from '@/app/_migue/Conversacion'
import { Retrato } from '@/app/_migue/Retrato'
import { apagadoDelPunto, ejemplosDelPunto, PRIVACIDAD_DEL_PUNTO, sitioDelPuntoEnTx } from '@/app/_migue/textos'
import { migueEstaInstalado } from '@/lib/migue/configuracion'
import { sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

export default async function Preguntar() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  // El marco ya manda a la coordinación a su panel. Una cuenta de punto sin
  // punto no debería existir, y sin punto no hay de quién ser la conversación.
  const sitioId = sesion.sitioId
  if (!sitioId) redirect('/turno')

  // La pregunta por la 0025 y el sitio van juntas, encauzadas en una sola
  // transacción: con la 0025 ausente, lo del sitio se descarta y listo.
  const [instalado, sitio] = await conSesion(sesion, (tx) => Promise.all([
    migueEstaInstalado(tx),
    sitioDelPuntoEnTx(tx, sitioId),
  ]))

  // Sin la 0025, Migue no existe: la pantalla vuelve al turno en vez de
  // mostrar algo que no anda. El botón que trae hasta acá tampoco aparece.
  if (!instalado || !sitio) redirect('/turno')

  return (
    <div className="pila">
      <div className="fila-entre">
        <div className="fila">
          <Retrato tamano="titulo" />
          <h1>Preguntale a Migue</h1>
        </div>
        <Link href="/turno" className="boton fantasma chico">Volver</Link>
      </div>

      <Conversacion
        rol="vigilador"
        dueno={sitio.id}
        inicial={null}
        privacidad={PRIVACIDAD_DEL_PUNTO}
        apagado={apagadoDelPunto()}
        ejemplos={ejemplosDelPunto(sitio)}
      />

      {/* Abajo y no arriba: arriba está lo que se viene a hacer, que es
          preguntar. Pero tiene que estar siempre, también con Migue apagado:
          lo que recuerda del punto se ve y se olvida desde ahí. */}
      <Link href="/preguntar/recuerdos" className="boton fantasma ancho-total">
        Lo que Migue recuerda de este punto
      </Link>
    </div>
  )
}
