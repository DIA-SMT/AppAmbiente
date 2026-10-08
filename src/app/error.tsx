'use client'

/**
 * Lo que se ve cuando algo se rompe del lado del servidor.
 *
 * Sin este archivo, Next deja la pantalla anterior congelada en el esqueleto de
 * carga, para siempre y sin decir nada: el vigilador no sabe si tiene que
 * esperar, si se quedó sin señal o si la app se rompió. Eso pasó de verdad y
 * costó encontrarlo.
 *
 * El texto está escrito para alguien parado en la calle con el celular en la
 * mano, no para quien programa: lo primero es que pueda seguir trabajando, y
 * recién después el detalle técnico, que es lo que la coordinadora necesita
 * para poder contar qué pasó.
 */

import { startTransition, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BASE_NO_DISPONIBLE } from '@db/disponibilidad'
import { pendientes } from '@/lib/cola'

/**
 * «Probar de nuevo» de verdad. reset() solo vuelve a dibujar con lo que ya
 * llegó del servidor, y si el error vino de ahí falla igual aunque la base ya
 * esté de vuelta: hay que pedirle la pantalla otra vez. Las dos cosas en la
 * misma transición, para que no se vea el error un instante antes de la
 * respuesta.
 */
function useReintentar(reset: () => void): () => void {
  const router = useRouter()
  return () =>
    startTransition(() => {
      router.refresh()
      reset()
    })
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Queda en la consola del servidor de desarrollo y en los registros del
    // proveedor, que es donde se puede leer de verdad.
    console.error('Pantalla rota:', error)
  }, [error])

  const reintentar = useReintentar(reset)

  if (error.digest === BASE_NO_DISPONIBLE) return <SinBase reintentar={reintentar} />

  return (
    <div className="pila" role="alert">
      <h1>No se pudo abrir esta pantalla</h1>

      <p className="gris" style={{ maxWidth: 'var(--ancho-lectura)' }}>
        Se rompió algo de nuestro lado, no de lo que estabas cargando. Si habías
        registrado un movimiento, quedó guardado.
      </p>

      <div className="fila">
        <button className="boton" type="button" onClick={reintentar}>
          Probar de nuevo
        </button>
        <Link href="/turno" className="boton secundario">
          Volver al inicio
        </Link>
      </div>

      <p className="menor gris" style={{ marginTop: '1rem' }}>
        Si vuelve a pasar, avisale a la coordinación
        {error.digest ? <> y pasale este código: <span className="mono fuerte">{error.digest}</span></> : null}.
      </p>
    </div>
  )
}

/**
 * La base no contesta: pausada, caída o sin conexiones libres.
 *
 * Acá no vale el «quedó guardado» de la pantalla de siempre: con la base caída
 * no se guarda nada en el servidor. Lo que sí puede haber es movimientos en la
 * cola del celular —el formulario los deja ahí cuando el envío falla, y
 * después de eso manda a /listo, que tampoco abre sin base y termina acá—, y
 * eso es lo primero que el vigilador tiene que saber para no cargarlos dos
 * veces.
 *
 * Tampoco es la señal: si esta pantalla llegó, el servidor contestó.
 */
function SinBase({ reintentar }: { reintentar: () => void }) {
  const [enCola, setEnCola] = useState<number | null>(null)

  useEffect(() => {
    pendientes().then(setEnCola, () => setEnCola(0))
  }, [])

  return (
    <div className="pila" role="alert">
      <h1>El sistema no está respondiendo</h1>

      <p className="gris" style={{ maxWidth: 'var(--ancho-lectura)' }}>
        No es tu celular ni tu señal: la base de datos no contesta. Probá de
        nuevo en unos minutos.
      </p>

      {enCola !== null && (
        <p style={{ maxWidth: 'var(--ancho-lectura)' }}>
          {enCola > 0
            ? `${enCola === 1 ? 'Hay 1 movimiento guardado' : `Hay ${enCola} movimientos guardados`} en este celular. Se ${enCola === 1 ? 'sube solo' : 'suben solos'} cuando vuelva el sistema: no ${enCola === 1 ? 'lo cargues' : 'los cargues'} de nuevo.`
            : 'Si tenías que registrar un movimiento, anotalo en papel y cargalo cuando vuelva.'}
        </p>
      )}

      <div className="fila">
        <button className="boton" type="button" onClick={reintentar}>
          Probar de nuevo
        </button>
      </div>

      <p className="menor gris" style={{ marginTop: '1rem' }}>
        Si en un rato sigue igual, avisale a la coordinación.
      </p>
    </div>
  )
}
