import Link from 'next/link'
import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import Conversacion from '@/app/_migue/Conversacion'
import { Retrato } from '@/app/_migue/Retrato'
import { leerConfiguracion, migueEstaInstalado } from '@/lib/migue/configuracion'
import { HORAS_DE_CONVERSACION_DEL_PUNTO } from '@/lib/reglas'
import { sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

interface SitioDelPunto {
  id: string
  tipo: 'planta' | 'punto_verde'
  carga_detallada: boolean
}

/**
 * Las preguntas de ejemplo de un celular recién estrenado, según qué se hace
 * en ese punto.
 *
 * Salen de cómo pregunta de verdad el vigilador (relevamiento, preguntas V1 a
 * V18) y cada una tiene con qué contestarse desde el celular. Ninguna pide lo
 * del mes: el celular ve 48 horas, y un ejemplo que termina en «eso no lo
 * puedo ver desde acá» enseña a no preguntar. Tampoco las pilas: los volteos
 * que se anotan desde el celular todavía no llegan al tablero de pilas.
 */
function ejemplosDelPunto(sitio: SitioDelPunto): string[] {
  if (sitio.tipo === 'planta') {
    return [
      '¿Qué cargué hoy?',
      '¿Cuál fue el número del último que cargué?',
      'Me equivoqué en la última carga, ¿la puedo deshacer?',
      '¿Cuántos metros cúbicos es un camión?',
    ]
  }
  // Donde no se carga de a un vecino, el conteo del día es lo que se hace con
  // el sistema, y el recambio lo otro (el mismo orden que en /turno).
  if (!sitio.carga_detallada) {
    return [
      '¿Cuántos vecinos puse en el conteo de ayer?',
      'Me equivoqué en el conteo de ayer, ¿lo puedo corregir?',
      '¿Ya pedí el recambio del cartón?',
      '¿Qué contenedores tengo acá?',
    ]
  }
  return [
    '¿Qué cargué hoy?',
    '¿Ya pedí el recambio del cartón?',
    'Me equivoqué en la última carga, ¿la puedo deshacer?',
    '¿Qué contenedores tengo acá?',
  ]
}

export default async function Preguntar() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  // El marco ya manda a la coordinación a su panel. Una cuenta de punto sin
  // punto no debería existir, y sin punto no hay de quién ser la conversación.
  const sitioId = sesion.sitioId
  if (!sitioId) redirect('/turno')

  // La pregunta por la 0025 y el sitio van juntas, encauzadas en una sola
  // transacción: con la 0025 ausente, lo del sitio se descarta y listo.
  const [instalado, sitios] = await conSesion(sesion, (tx) => Promise.all([
    migueEstaInstalado(tx),
    tx.consultar<SitioDelPunto>(
      'select id, tipo, carga_detallada from sitios where id = $1',
      [sitioId],
    ),
  ]))

  const sitio = sitios[0]
  // Sin la 0025, Migue no existe: la pantalla vuelve al turno en vez de
  // mostrar algo que no anda. El botón que trae hasta acá tampoco aparece.
  if (!instalado || !sitio) redirect('/turno')

  // Al vigilador no le sirve el nombre de una variable de entorno: le sirve
  // saber que lo suyo, cargar, anda igual. El motivo exacto lo ve la
  // coordinación en su pantalla y en /api/salud.
  const apagado = leerConfiguracion().problemas.length > 0
    ? {
        titulo: 'Migue no está contestando por ahora.',
        detalle: ['Cargar anda igual que siempre. Si sigue así, avisale a la coordinación.'],
      }
    : null

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
        privacidad={
          `Lo que escribas lo ve cualquiera que use la cuenta del punto, durante ${HORAS_DE_CONVERSACION_DEL_PUNTO} horas. ` +
          'No pongas datos de vecinos.'
        }
        apagado={apagado}
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
