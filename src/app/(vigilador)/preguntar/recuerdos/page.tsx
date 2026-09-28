import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Retrato } from '@/app/_migue/Retrato'
import { numero } from '@/lib/formato'
import { pantallaDelPunto } from '@/lib/migue/pantallas'
import { RECUERDOS_MAXIMOS } from '@/lib/reglas'
import { sesionActual } from '@/lib/sesion'
import Olvidar from './Olvidar'

export const dynamic = 'force-dynamic'

type Parametros = Record<string, string | string[] | undefined>

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()

/**
 * «Lo que Migue recuerda de este punto».
 *
 * Se muestra aunque Migue esté apagado —sin crédito, en el tope del mes—: lo
 * que recuerda se tiene que poder ver y olvidar también el día que no contesta.
 * Lo único que hace falta es que la base tenga lo de Migue.
 */
export default async function LoQueRecuerdaDelPunto({
  searchParams,
}: {
  searchParams: Promise<Parametros>
}) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')
  if (!sesion.sitioId) redirect('/turno')

  const [pantalla, sp] = await Promise.all([pantallaDelPunto(sesion), searchParams])
  const olvidado = uno(sp.aviso) === 'olvidado'

  if (!pantalla) {
    return (
      <div className="pila">
        <div className="fila-entre">
          <h1>Lo que Migue recuerda</h1>
          <Link href="/turno" className="boton fantasma chico">Volver</Link>
        </div>
        <div className="aviso atencion">Migue todavía no está en este sistema.</div>
      </div>
    )
  }

  const { punto, recuerdos } = pantalla

  return (
    <div className="pila">
      <div className="fila-entre">
        <div className="fila">
          <Retrato tamano="titulo" />
          <h1>Lo que Migue recuerda</h1>
        </div>
        <Link href="/preguntar" className="boton fantasma chico">Volver</Link>
      </div>

      <p className="menor gris" style={{ margin: 0 }}>{punto.nombre}</p>

      <div className="aviso">
        Es del punto, no de una persona: lo ve cualquiera que entre con la cuenta del punto, y la
        coordinación. Migue lo tiene presente en cada conversación nueva.
      </div>

      {olvidado && (
        <div className="aviso exito" role="status">
          Listo: Migue lo olvidó. Si había una conversación abierta, se cerró y la próxima pregunta
          empieza de cero.
        </div>
      )}

      {recuerdos.length === 0 ? (
        <div className="tarjeta pila-chica">
          <p className="fuerte" style={{ margin: 0 }}>No recuerda nada de este punto.</p>
          <p className="menor gris" style={{ margin: 0 }}>
            Si querés que tenga algo presente cada vez, pedíselo en la conversación: «acordate de
            que al contenedor de RSU le decimos el tacho grande».
          </p>
        </div>
      ) : (
        <>
          <ul className="lista">
            {recuerdos.map((r) => (
              <li key={r.id} className="pila-chica">
                <span className="fuerte" style={{ overflowWrap: 'anywhere' }}>{r.texto}</span>
                <span className="menor gris">Desde el {r.desde}</span>
                <Olvidar recuerdoId={r.id} />
              </li>
            ))}
          </ul>
          <p className="menor gris" style={{ margin: 0 }}>
            {numero(recuerdos.length)} de {numero(RECUERDOS_MAXIMOS)}. Olvidar algo también cierra
            las conversaciones donde Migue lo tenía presente.
          </p>
        </>
      )}
    </div>
  )
}
