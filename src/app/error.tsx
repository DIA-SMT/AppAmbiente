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

import { useEffect } from 'react'
import Link from 'next/link'

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

  return (
    <div className="pila" role="alert">
      <h1>No se pudo abrir esta pantalla</h1>

      <p className="gris" style={{ maxWidth: 'var(--ancho-lectura)' }}>
        Se rompió algo de nuestro lado, no de lo que estabas cargando. Si habías
        registrado un movimiento, quedó guardado.
      </p>

      <div className="fila">
        <button className="boton" type="button" onClick={reset}>
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
