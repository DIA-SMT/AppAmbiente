'use client'

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
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
  /** Lo que este usuario dejó hecho, en una frase. Null si no dejó nada. */
  rastro: string | null
  /** El usuario con el que está abierta esta pantalla. */
  esVos: boolean
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
  const [correo, setCorreo] = useState('')

  // Y se vacían recién cuando el alta salió bien. El alta de coordinación no
  // devuelve PIN —la contraseña la escribió quien la va a usar—, así que para
  // saber que salió bien hay que mirar el aviso.
  useEffect(() => {
    if (estado.pin || (estado.aviso && !estado.error)) {
      formulario.current?.reset()
      setUsuario('')
      setNombre('')
      setCorreo('')
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
          <span className="ayuda">Lo que se teclea al entrar. Minúsculas y sin espacios: pv09.</span>
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
          <>
            <div className="campo">
              <label htmlFor="correo">Correo institucional</label>
              <input
                id="correo"
                name="correo"
                type="email"
                className="control"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="nombre@smt.gob.ar"
                maxLength={160}
                required
              />
              <span className="ayuda">
                Con esto entra al panel. Mejor la casilla del municipio, pero sirve cualquiera.
                No la pueden compartir dos cuentas.
              </span>
            </div>

            <div className="campo">
              {/* «Contraseña para la primera vez» no entraba en un renglón y
                  partido en dos corría este campo 25 px abajo de los otros
                  tres. Lo que es, lo dice la ayuda. */}
              <label htmlFor="clave">Contraseña provisoria</label>
              <input
                id="clave"
                name="clave"
                type="password"
                className="control"
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                required
              />
              <span className="ayuda">
                De 6 caracteres para arriba. Dura hasta que entre: ahí elige la suya.
              </span>
            </div>
          </>
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

/**
 * El borrado, que no puede vivir dentro de la fila que borra.
 *
 * Todas las demás acciones dejan la fila en su lugar y contestan ahí mismo.
 * Ésta la hace desaparecer: la respuesta trae el listado nuevo sin ese renglón,
 * así que React desmonta el componente en el mismo commit en que le entrega el
 * resultado y el «quedó eliminado» no llega a dibujarse nunca. Por eso tanto el
 * estado de la acción como la pregunta de confirmación viven acá arriba, en algo
 * que sobrevive al borrado, y bajan por contexto hasta el botón.
 *
 * La pregunta además se DIBUJA acá arriba, arriba de la tabla y al lado del
 * aviso que contesta esa misma acción. Adentro de la celda de acciones vivía en
 * una columna de 136 px: el texto se partía de a dos palabras, «Sí, eliminar»
 * quedaba en dos renglones y la fila se estiraba a 471 px, con el nombre y el
 * usuario arriba de un rectángulo blanco. Es una sola por vez y nombra a quién
 * borra, así que no hace falta que esté pegada a su renglón.
 */
interface EnDuda {
  id: string
  usuario: string
}

interface Borrado {
  /** Qué fila tiene la pregunta abierta. Una sola por vez. */
  confirmando: EnDuda | null
  preguntar: (cual: EnDuda | null) => void
  accion: (datos: FormData) => void
}

const Borrar = createContext<Borrado | null>(null)

export function ListaDeUsuarios({ resumen, children }: { resumen: string; children: ReactNode }) {
  const [estado, accion] = useActionState<EstadoUsuario, FormData>(accionSobreUsuario, {})
  const [confirmando, preguntar] = useState<EnDuda | null>(null)

  // Si salió bien, la fila ya no está y la pregunta se fue con ella. Si la base
  // lo rechazó, la fila sigue: dejarle la pregunta abierta invita a insistir con
  // algo que no va a cambiar de respuesta.
  useEffect(() => {
    if (estado.aviso || estado.error) preguntar(null)
  }, [estado.aviso, estado.error])

  return (
    <Borrar.Provider value={{ confirmando, preguntar, accion }}>
      <div className="fila menor gris">
        <span>{resumen}</span>
      </div>
      {estado.error && <div className="aviso error" role="alert">{estado.error}</div>}
      {estado.aviso && <div className="aviso exito" role="status">{estado.aviso}</div>}
      {confirmando && (
        <div className="aviso atencion pila-chica" role="alert">
          <span>
            Se borra <span className="fuerte mono">{confirmando.usuario}</span> de la lista y no hay
            vuelta atrás. No se pierde nada: no quedó ni un movimiento ni un registro a su nombre.
            Si más adelante hace falta, se crea de nuevo.
          </span>
          <div className={estilos.acciones}>
            <form action={accion}>
              <input type="hidden" name="id" value={confirmando.id} />
              <input type="hidden" name="accion" value="eliminar" />
              <BotonFila rotulo={`Sí, eliminar ${confirmando.usuario}`} clase="boton peligro chico" />
            </form>
            <button type="button" className="boton chico fantasma" onClick={() => preguntar(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {children}
    </Borrar.Provider>
  )
}

function BotonFila({ rotulo, clase = 'boton chico secundario' }: { rotulo: string; clase?: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={clase} disabled={pending}>
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
  // Eliminar no se deshace, así que va en dos pasos: el botón abre la pregunta
  // y recién la respuesta borra. Los dos pasos los lleva la lista, no la fila:
  // ver ListaDeUsuarios.
  const borrado = useContext(Borrar)
  const borrando = borrado?.confirmando?.id === perfil.id
  const esCoordinacion = perfil.rol === 'admin'

  // Sobre el propio usuario no se dice nada de eliminar: desactivarse tampoco se
  // puede, ya lo avisa esa acción, y repetirlo en cada fila es ruido.
  const sePuedeEliminar = Boolean(borrado) && !perfil.esVos && perfil.rastro === null
  const retenido = !perfil.esVos && perfil.rastro !== null

  useEffect(() => {
    if (estado.aviso) setCambiando(false)
  }, [estado.aviso])

  return (
    <div className="pila-chica">
      <div className={estilos.acciones}>
        {!esCoordinacion && (
          // «PIN» a secas por lo mismo que «Contraseña» acá abajo: es el rótulo
          // más largo de la columna y no entraba en línea con «Desactivar», así
          // que cada fila de un punto se llevaba dos renglones de botones. Los
          // dos dicen la credencial sobre la que se actúa y quedan parejos: a la
          // cuenta de un punto se le repone el PIN, a la de coordinación la
          // contraseña.
          <AccionDeFila accion={accion} id={perfil.id} valor="reset" rotulo="PIN" />
        )}
        {esCoordinacion && !cambiando && (
          <button
            type="button"
            className="boton chico secundario"
            onClick={() => { setCambiando(true); borrado?.preguntar(null) }}
          >
            {/* «Cambiar contraseña» sola se llevaba un renglón de la columna. */}
            Contraseña
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
        {sePuedeEliminar && !borrando && (
          <button
            type="button"
            className="boton chico secundario"
            onClick={() => {
              borrado?.preguntar({ id: perfil.id, usuario: perfil.usuario })
              setCambiando(false)
            }}
          >
            Eliminar
          </button>
        )}
      </div>

      {/* La pregunta de «Eliminar» no se dibuja acá sino arriba de la tabla: ver
          ListaDeUsuarios. Y de por qué no se puede eliminar queda el motivo
          solo; qué hacer en su lugar lo dice el encabezado de la pantalla, una
          vez. Esa segunda oración eran dos renglones más adentro de una columna
          angosta, en cada fila que ya cargó algo, que son casi todas. */}
      {retenido && (
        <span className="menor gris">No se puede eliminar: {perfil.rastro}.</span>
      )}

      {esCoordinacion && cambiando && (
        <form action={accion} className="pila-chica">
          <input type="hidden" name="id" value={perfil.id} />
          <input type="hidden" name="accion" value="clave" />
          {/* Sobre la propia cuenta va primero la actual. Esta lista se abre
              sola en cualquier sesión viva, igual que Mi cuenta: sin este campo,
              la sesión que quedó abierta en una notebook se queda con la cuenta
              escribiendo dos veces en un formulario. Sobre una cuenta ajena no
              va, porque ahí quien cambia no es el dueño y no la sabe. */}
          {perfil.esVos && (
            <div className="campo">
              <label htmlFor={`actual-${perfil.id}`} className="menor">
                Tu contraseña actual
              </label>
              <input
                id={`actual-${perfil.id}`}
                name="credencial"
                type="password"
                className="control"
                autoComplete="current-password"
                maxLength={128}
                autoFocus
                required
              />
              <span className="ayuda">La misma con la que entrás al panel.</span>
            </div>
          )}
          <div className="campo">
            <label htmlFor={`clave-${perfil.id}`} className="menor">
              {perfil.esVos
                ? 'Tu contraseña nueva'
                : `Contraseña para que ${perfil.usuario} vuelva a entrar`}
            </label>
            <input
              id={`clave-${perfil.id}`}
              name="clave"
              type="password"
              className="control"
              autoComplete="new-password"
              minLength={6}
              maxLength={128}
              // Sobre la propia cuenta el foco arranca en la contraseña actual,
              // que es el campo de arriba.
              autoFocus={!perfil.esVos}
              required
            />
            {/* Sobre una cuenta ajena esto no es "ponerle la contraseña": es
                prestarle una para que entre. El panel le va a pedir la propia
                apenas entre, que es lo que hace que pasarla por teléfono no
                deje a nadie sabiendo la contraseña de otro. */}
            <span className="ayuda">
              {perfil.esVos
                ? 'De 6 caracteres para arriba. No se vuelve a mostrar.'
                : 'De 6 caracteres para arriba. Se la pasás y dura hasta que entre: ahí el panel '
                  + 'le pide que elija una propia.'}
            </span>
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
