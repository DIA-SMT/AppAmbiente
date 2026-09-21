'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { ingresar, type EstadoIngreso } from './acciones'
import css from './ingresar.module.css'

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
  const [codigo, setCodigo] = useState('')
  const [conRespaldo, setConRespaldo] = useState(false)
  const pinRef = useRef<HTMLInputElement>(null)
  const codigoRef = useRef<HTMLInputElement>(null)

  // Qué paso se dibuja lo contesta el servidor, que es el que sabe si la cuenta
  // tiene segundo factor. El vigilador nunca llega acá: su ingreso es de un
  // solo paso y esta rama entera no existe para él.
  const enSegundoFactor = estado.segundoFactor === true

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

  // Cada respuesta del servidor y cada cambio de tipo de código dejan el campo
  // vacío y con el foco puesto: el código que se rechazó ya no sirve —el de la
  // app cambió mientras tanto— y borrarlo a mano con una sola mano, parado, es
  // justo lo que no queremos.
  useEffect(() => {
    if (!enSegundoFactor) return
    setCodigo('')
    codigoRef.current?.focus()
  }, [enSegundoFactor, conRespaldo, estado])

  // Cuando el servidor avisa que el código del teléfono no puede entrar —el
  // secreto guardado quedó ilegible—, la pantalla pasa sola a los códigos de
  // respaldo. Dejarla en el campo de seis dígitos sería ofrecer el único camino
  // que ya se sabe que no lleva a ningún lado.
  useEffect(() => {
    if (estado.respaldo) setConRespaldo(true)
  }, [estado])

  function recordar(valor: string) {
    setUsuario(valor)
    try { localStorage.setItem(RECORDADO, valor) } catch { /* modo privado */ }
  }

  return (
    <form action={accion} className="pila" noValidate>
      {estado.error && (
        <div className="aviso error" role="alert">{estado.error}</div>
      )}

      {enSegundoFactor ? (
        <>
          <input type="hidden" name="paso" value="segundo_factor" />
          {/* Viaja para poder devolverlo escrito si vuelven al primer paso. A
              quién se le valida el código lo decide la cookie, no esto. */}
          <input type="hidden" name="usuario" value={usuario} />
          {conRespaldo && <input type="hidden" name="respaldo" value="1" />}

          {usuario && (
            <p className={css.cuenta}>Entrando como <span>{usuario}</span></p>
          )}

          <div className="campo">
            <label htmlFor="codigo">{conRespaldo ? 'Código de respaldo' : 'Código de la app'}</label>
            <input
              ref={codigoRef}
              id="codigo"
              name="codigo"
              className={conRespaldo ? 'control' : `control ${css.codigo}`}
              type="text"
              required
              // Con one-time-code el teléfono lo ofrece solo; en el de respaldo
              // no hay nada que ofrecer y el autocompletado estorba.
              autoComplete={conRespaldo ? 'off' : 'one-time-code'}
              autoCapitalize="none"
              spellCheck={false}
              inputMode={conRespaldo ? 'text' : 'numeric'}
              pattern={conRespaldo ? undefined : '[0-9]*'}
              maxLength={conRespaldo ? 40 : 6}
              value={codigo}
              onChange={(e) =>
                setCodigo(
                  conRespaldo
                    // Pegado desde el teléfono, el código suele venir con un
                    // espacio en el medio; que eso no lo dé por inválido.
                    ? e.target.value
                    : e.target.value.replace(/\D/g, '').slice(0, 6),
                )
              }
            />
            <span className="ayuda">
              {conRespaldo
                ? 'Uno de los ocho que anotaste al configurar el segundo factor. Cada uno sirve una sola vez.'
                : 'Los seis dígitos que muestra la app de códigos en tu teléfono. Cambian cada treinta segundos.'}
            </span>
          </div>

          <Boton />

          <button
            type="button"
            className="boton fantasma ancho-total"
            onClick={() => setConRespaldo((v) => !v)}
          >
            {conRespaldo ? 'Volver al código de la app' : 'Usar un código de respaldo'}
          </button>

          {/* Un submit y no un enlace: volver tiene que borrar la cookie previa
              en el servidor, no sólo cambiar lo que se ve. */}
          <button
            type="submit"
            name="volver"
            value="1"
            className={`boton fantasma ancho-total ${css.volver}`}
          >
            Empezar de nuevo
          </button>
        </>
      ) : (
        <>
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
              <label htmlFor="usuario">Correo institucional</label>
              <input
                id="usuario"
                name="usuario"
                className="control"
                // Texto y no type="email" a propósito: las cuentas que todavía
                // no cargaron su correo entran con el nombre de usuario, y el
                // navegador daría eso por inválido.
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="email"
                maxLength={120}
                required
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
              />
              <span className="ayuda">
                Si todavía no cargaste tu correo, entrá con tu usuario de siempre.
              </span>
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
        </>
      )}
    </form>
  )
}
