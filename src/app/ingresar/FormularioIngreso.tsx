'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { ingresar, type EstadoIngreso } from './acciones'

interface SitioIngreso {
  usuario: string
  sitio_nombre: string
  sitio_tipo: string
}

const RECORDADO = 'ambiente.ultimo-usuario'

function Boton() {
  const { pending } = useFormStatus()
  return (
    <button className="boton ancho-total grande" type="submit" disabled={pending}>
      {pending ? 'Entrando…' : 'Entrar'}
    </button>
  )
}

export default function FormularioIngreso({ sitios }: { sitios: SitioIngreso[] }) {
  const [estado, accion] = useActionState<EstadoIngreso, FormData>(ingresar, {})
  const [modoCoordinacion, setModoCoordinacion] = useState(false)
  const [usuario, setUsuario] = useState('')
  const pinRef = useRef<HTMLInputElement>(null)

  // El celular es siempre el mismo y el punto también: recordar cuál se eligió
  // la última vez ahorra el paso más aburrido de la pantalla.
  useEffect(() => {
    const guardado = typeof window !== 'undefined' ? localStorage.getItem(RECORDADO) : null
    const inicial = estado.usuario || guardado || ''
    if (inicial && sitios.some((s) => s.usuario === inicial)) {
      setUsuario(inicial)
      pinRef.current?.focus()
    } else if (inicial) {
      setModoCoordinacion(true)
      setUsuario(inicial)
    }
  }, [estado.usuario, sitios])

  function recordar(valor: string) {
    setUsuario(valor)
    try { localStorage.setItem(RECORDADO, valor) } catch { /* modo privado */ }
  }

  return (
    <form action={accion} className="pila" noValidate>
      {estado.error && (
        <div className="aviso error" role="alert">{estado.error}</div>
      )}

      {/* Para que el mensaje de error hable de PIN o de contraseña según el caso. */}
      <input type="hidden" name="modo" value={modoCoordinacion ? 'admin' : 'punto'} />

      {!modoCoordinacion ? (
        sitios.length === 0 ? (
          // Una base recién entregada no tiene usuarios de punto: los crea la
          // coordinación desde la app. Sin esto, el vigilador ve un selector
          // vacío y no tiene forma de saber si se rompió algo o si todavía no
          // le tocó.
          <div className="aviso atencion">
            Todavía no hay ningún punto habilitado para entrar desde el celular.
            Los crea la coordinación desde <span className="fuerte">Usuarios</span>.
          </div>
        ) : (
          <div className="campo">
            <label htmlFor="usuario">¿En qué punto estás?</label>
            <select
              id="usuario"
              name="usuario"
              className="control"
              required
              value={usuario}
              onChange={(e) => recordar(e.target.value)}
            >
              <option value="" disabled>Elegí tu punto…</option>
              {sitios.map((s) => (
                <option key={s.usuario} value={s.usuario}>{s.sitio_nombre}</option>
              ))}
            </select>
          </div>
        )
      ) : (
        <div className="campo">
          <label htmlFor="usuario">Usuario</label>
          <input
            id="usuario"
            name="usuario"
            className="control"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
          />
        </div>
      )}

      {/* Sin puntos que elegir no hay nada que hacer con el PIN. */}
      {(modoCoordinacion || sitios.length > 0) && (
      <div className="campo">
        <label htmlFor="credencial">{modoCoordinacion ? 'Contraseña' : 'PIN'}</label>
        <input
          ref={pinRef}
          id="credencial"
          name="credencial"
          className="control"
          type="password"
          required
          autoComplete={modoCoordinacion ? 'current-password' : 'one-time-code'}
          // El teclado numérico sale solo, sin tener que buscarlo.
          inputMode={modoCoordinacion ? 'text' : 'numeric'}
          pattern={modoCoordinacion ? undefined : '[0-9]*'}
          maxLength={modoCoordinacion ? 128 : 8}
          style={modoCoordinacion ? undefined : { fontSize: '1.5rem', letterSpacing: '.4em', textAlign: 'center' }}
        />
      </div>
      )}

      {(modoCoordinacion || sitios.length > 0) && <Boton />}

      <button
        type="button"
        className="boton fantasma ancho-total"
        onClick={() => { setModoCoordinacion((v) => !v); setUsuario('') }}
      >
        {modoCoordinacion ? 'Volver al ingreso por punto' : 'Entrar como coordinación'}
      </button>
    </form>
  )
}
