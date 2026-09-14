'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { accionSobreUsuario, crearUsuario, type EstadoUsuario } from './acciones'
import estilos from '../gente.module.css'

export interface SitioParaUsuario {
  id: string
  codigo: string
  nombre: string
  usuarios: number
}

export interface PerfilParaAcciones {
  id: string
  usuario: string
  rol: 'admin' | 'vigilador'
  activo: boolean
  trabado: boolean
}

function Pin({ pin, usuario }: { pin: string; usuario?: string }) {
  return (
    <div className={estilos.pinCaja}>
      <span className={estilos.pin}>{pin}</span>
      <span className="menor gris">
        PIN de <span className="fuerte">{usuario}</span>. Anotalo ahora: no se vuelve a mostrar.
        Si se pierde, se resetea desde esta misma lista.
      </span>
    </div>
  )
}

function BotonAlta() {
  const { pending } = useFormStatus()
  return (
    <button className="boton" type="submit" disabled={pending}>
      {pending ? 'Creando…' : 'Crear usuario'}
    </button>
  )
}

export function FormularioUsuario({ sitios }: { sitios: SitioParaUsuario[] }) {
  const [estado, accion] = useActionState<EstadoUsuario, FormData>(crearUsuario, {})
  const formulario = useRef<HTMLFormElement>(null)

  // Vaciar los campos recién cuando el alta salió bien, para no perder lo
  // escrito si la base rechazó el usuario por repetido.
  useEffect(() => {
    if (estado.pin) formulario.current?.reset()
  }, [estado.pin])

  return (
    <form ref={formulario} action={accion} className="pila" noValidate>
      {estado.error && <div className="aviso error" role="alert">{estado.error}</div>}

      {estado.pin && (
        <div className="aviso exito" role="status">
          <div className="pila-chica">
            <span className="fuerte">{estado.aviso}</span>
            <Pin pin={estado.pin} usuario={estado.usuario} />
          </div>
        </div>
      )}

      <div className={estilos.grilla}>
        <div className="campo">
          <label htmlFor="usuario">Usuario</label>
          <input
            id="usuario"
            name="usuario"
            className="control mono"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={32}
            required
          />
          <span className="ayuda">Es lo que se teclea al entrar. Minúsculas y sin espacios: pv09.</span>
        </div>

        <div className="campo">
          <label htmlFor="nombre">Nombre que se va a ver</label>
          <input
            id="nombre"
            name="nombre"
            className="control"
            autoComplete="off"
            maxLength={120}
            required
          />
          <span className="ayuda">Por ejemplo: Punto Verde Plaza Urquiza — turno.</span>
        </div>

        <div className="campo">
          <label htmlFor="sitio_id">Punto</label>
          <select id="sitio_id" name="sitio_id" className="control" defaultValue="" required>
            <option value="" disabled>Elegí el punto…</option>
            {sitios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}{s.usuarios > 0 ? ' · ya tiene usuario' : ''}
              </option>
            ))}
          </select>
          <span className="ayuda">Solo va a poder cargar movimientos de este punto.</span>
        </div>

        <div className="campo">
          <label htmlFor="pin">PIN</label>
          <input
            id="pin"
            name="pin"
            className="control"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={8}
            placeholder="Se genera solo"
          />
          <span className="ayuda">Dejalo vacío y el sistema inventa uno de 4 dígitos.</span>
        </div>
      </div>

      <div className="fila">
        <BotonAlta />
        <span className="menor gris">
          Desde acá salen los usuarios de punto. El de coordinación se crea en la base.
        </span>
      </div>
    </form>
  )
}

function BotonFila({ accion, rotulo }: { accion: string; rotulo: string }) {
  const { pending, data } = useFormStatus()
  const enCurso = pending && data?.get('accion') === accion
  return (
    <button
      type="submit"
      name="accion"
      value={accion}
      className="boton chico secundario"
      disabled={pending}
    >
      {enCurso ? 'Un momento…' : rotulo}
    </button>
  )
}

export function AccionesUsuario({ perfil }: { perfil: PerfilParaAcciones }) {
  const [estado, accion] = useActionState<EstadoUsuario, FormData>(accionSobreUsuario, {})

  return (
    <form action={accion} className="pila-chica">
      <input type="hidden" name="id" value={perfil.id} />

      <div className={estilos.acciones}>
        {perfil.rol === 'vigilador' && <BotonFila accion="reset" rotulo="Resetear PIN" />}
        <BotonFila
          accion={perfil.activo ? 'desactivar' : 'activar'}
          rotulo={perfil.activo ? 'Desactivar' : 'Activar'}
        />
        {perfil.trabado && <BotonFila accion="desbloquear" rotulo="Desbloquear" />}
      </div>

      {estado.error && <p className={estilos.mensajeError} role="alert">{estado.error}</p>}
      {estado.aviso && <p className={estilos.mensajeOk} role="status">{estado.aviso}</p>}
      {estado.pin && <Pin pin={estado.pin} usuario={estado.usuario} />}
    </form>
  )
}
