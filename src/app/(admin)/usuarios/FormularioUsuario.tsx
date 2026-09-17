'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
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
  const [rol, setRol] = useState<'vigilador' | 'admin'>('vigilador')
  const esCoordinacion = rol === 'admin'

  // Usuario y nombre van controlados porque React vacía los campos no
  // controlados apenas termina una server action, salga bien o mal. Sin esto,
  // equivocarse en el PIN obliga a volver a escribir todo lo demás.
  const [usuario, setUsuario] = useState('')
  const [nombre, setNombre] = useState('')

  // Y se vacían recién cuando el alta salió bien. El alta de coordinación no
  // devuelve PIN —la contraseña la escribió quien la va a usar—, así que para
  // saber que salió bien hay que mirar el aviso.
  useEffect(() => {
    if (estado.pin || (estado.aviso && !estado.error)) {
      formulario.current?.reset()
      setUsuario('')
      setNombre('')
    }
  }, [estado.pin, estado.aviso, estado.error])

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

      {estado.aviso && !estado.pin && !estado.error && (
        <div className="aviso exito" role="status">{estado.aviso}</div>
      )}

      <div className="campo">
        <label htmlFor="rol">Qué clase de cuenta</label>
        <select
          id="rol"
          name="rol"
          className="control"
          value={rol}
          onChange={(e) => setRol(e.target.value === 'admin' ? 'admin' : 'vigilador')}
        >
          <option value="vigilador">De punto — carga movimientos desde el celular</option>
          <option value="admin">De coordinación — ve todo y administra las listas</option>
        </select>
        <span className="ayuda">
          {esCoordinacion
            ? 'Ve los tres flujos, los datos de los vecinos y la auditoría. No se le asigna punto.'
            : 'Solo puede cargar movimientos del punto que le asignes.'}
        </span>
      </div>

      <div className={estilos.grilla}>
        <div className="campo">
          <label htmlFor="usuario">Usuario</label>
          <input
            id="usuario"
            name="usuario"
            className="control mono"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
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
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoComplete="off"
            maxLength={120}
            required
          />
          <span className="ayuda">
            {esCoordinacion
              ? 'Por ejemplo: Coordinación de Ambiente.'
              : 'Por ejemplo: Punto Verde Plaza Urquiza — turno.'}
          </span>
        </div>

        {esCoordinacion ? (
          <div className="campo">
            <label htmlFor="clave">Contraseña</label>
            <input
              id="clave"
              name="clave"
              type="password"
              className="control"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
            <span className="ayuda">
              De 12 caracteres para arriba, y la elegís vos: el sistema no inventa
              contraseñas de coordinación. No se vuelve a mostrar.
            </span>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>

      <div className="fila">
        <BotonAlta />
      </div>
    </form>
  )
}

function BotonFila({ rotulo }: { rotulo: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="boton chico secundario" disabled={pending}>
      {pending ? 'Un momento…' : rotulo}
    </button>
  )
}

/**
 * Un botón de fila, con su propio formulario.
 *
 * Cada acción va en un `<form>` aparte y lleva la suya en un campo oculto. Antes
 * eran varios botones `name="accion" value="…"` dentro de un solo formulario, que
 * es lo natural en HTML —el navegador manda el valor del botón que envió— pero
 * React no serializa el botón que envía cuando la acción del formulario es una
 * server action: al servidor llegaba `id` y nada más, y ninguna de estas
 * acciones funcionaba. Un formulario por acción no depende de eso.
 */
function AccionDeFila({
  accion, id, valor, rotulo,
}: {
  accion: (datos: FormData) => void
  id: string
  valor: string
  rotulo: string
}) {
  return (
    <form action={accion}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="accion" value={valor} />
      <BotonFila rotulo={rotulo} />
    </form>
  )
}

export function AccionesUsuario({ perfil }: { perfil: PerfilParaAcciones }) {
  const [estado, accion] = useActionState<EstadoUsuario, FormData>(accionSobreUsuario, {})
  // La contraseña de coordinación se escribe, no se inventa, así que el campo
  // aparece recién cuando alguien lo pide: una caja de contraseña abierta en
  // cada fila de una lista es ruido, y encima invita a tocarla sin querer.
  const [cambiando, setCambiando] = useState(false)
  const esCoordinacion = perfil.rol === 'admin'

  useEffect(() => {
    if (estado.aviso) setCambiando(false)
  }, [estado.aviso])

  return (
    <div className="pila-chica">
      <div className={estilos.acciones}>
        {!esCoordinacion && (
          <AccionDeFila accion={accion} id={perfil.id} valor="reset" rotulo="Resetear PIN" />
        )}
        {esCoordinacion && !cambiando && (
          <button
            type="button"
            className="boton chico secundario"
            onClick={() => setCambiando(true)}
          >
            Cambiar contraseña
          </button>
        )}
        <AccionDeFila
          accion={accion}
          id={perfil.id}
          valor={perfil.activo ? 'desactivar' : 'activar'}
          rotulo={perfil.activo ? 'Desactivar' : 'Activar'}
        />
        {perfil.trabado && (
          <AccionDeFila accion={accion} id={perfil.id} valor="desbloquear" rotulo="Desbloquear" />
        )}
      </div>

      {esCoordinacion && cambiando && (
        <form action={accion} className="pila-chica">
          <input type="hidden" name="id" value={perfil.id} />
          <input type="hidden" name="accion" value="clave" />
          <div className="campo">
            <label htmlFor={`clave-${perfil.id}`} className="menor">
              Contraseña nueva de {perfil.usuario}
            </label>
            <input
              id={`clave-${perfil.id}`}
              name="clave"
              type="password"
              className="control"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              autoFocus
              required
            />
            <span className="ayuda">De 12 caracteres para arriba. No se vuelve a mostrar.</span>
          </div>
          <div className={estilos.acciones}>
            <BotonFila rotulo="Guardar contraseña" />
            <button
              type="button"
              className="boton chico fantasma"
              onClick={() => setCambiando(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {estado.error && <p className={estilos.mensajeError} role="alert">{estado.error}</p>}
      {estado.aviso && <p className={estilos.mensajeOk} role="status">{estado.aviso}</p>}
      {estado.pin && <Pin pin={estado.pin} usuario={estado.usuario} />}
    </div>
  )
}
