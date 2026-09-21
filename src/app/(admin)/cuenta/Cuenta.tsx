'use client'

/**
 * Mi cuenta: con qué correo y con qué contraseña se entra al panel.
 *
 * Mientras falte algo, la pantalla es un solo formulario que guarda las dos
 * cosas juntas. Por acá tienen que pasar las cuentas de coordinación que todavía
 * usan la contraseña con la que las crearon, y cuantos menos pasos haya, menos
 * lugares hay donde abandonarla por la mitad.
 *
 * Con la cuenta ya completa se parte en dos tarjetas, porque a partir de ahí no
 * es un trámite sino dos cosas que se cambian por separado y en momentos
 * distintos, cada una con su confirmación.
 */

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useActionState, useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { fechaHora } from '@/lib/formato'
import { cambiarClave, completarCuenta, guardarCorreo, type EstadoCuenta } from './acciones'
import comunes from '../gente.module.css'

export interface DatosDeCuenta {
  usuario: string
  correo: string | null
  /** Null = la cuenta sigue con la contraseña con la que la crearon. */
  credencialCambiadaEn: string | null
  /**
   * Si la base ya tiene dónde anotar que la contraseña la eligió su dueño.
   *
   * Es false nada más que en el rato que va entre que sube el código y se
   * aplica la migración. Ahí esa mitad de la pantalla no se dibuja: un
   * formulario que no puede guardar lo que pide es peor que no estar.
   */
  puedeElegirClave: boolean
}

/** El mismo mínimo que revisa el servidor (esClaveValida, db/credenciales.ts). */
const LARGO_MINIMO = 6

/**
 * El cartel que acompaña al portón, no el portón.
 *
 * El que corta es exigirPanel(), en el servidor, que cada pantalla del panel
 * llama antes de consultar nada. Esto es lo que hace que el salto a /cuenta se
 * sienta inmediato al tocar una sección, en vez de esperar la ida y vuelta, y
 * lo que deja algo escrito si el navegador no ejecuta nada. Que se dibuje o no
 * se dibuje nunca decidió quién entra: la página ya venía armada del servidor.
 */
export function PortonDeCuenta({ falta, children }: { falta: boolean; children: ReactNode }) {
  const ruta = usePathname()
  const router = useRouter()
  const enCuenta = ruta === '/cuenta'

  useEffect(() => {
    if (falta && !enCuenta) router.replace('/cuenta')
  }, [falta, enCuenta, router])

  if (!falta || enCuenta) return <>{children}</>

  return (
    <div className="pila angosto">
      <div className="aviso atencion" role="status">
        <p className="fuerte">Antes de seguir, terminá de configurar tu cuenta.</p>
        <p style={{ margin: 0 }}>
          Te estamos llevando ahí. Si no pasa nada, entrá a <Link href="/cuenta">Mi cuenta</Link>.
        </p>
      </div>
    </div>
  )
}

function Boton({
  rotulo,
  esperando = 'Un momento…',
  clase = 'boton',
}: {
  rotulo: string
  esperando?: string
  clase?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={clase} disabled={pending}>
      {pending ? esperando : rotulo}
    </button>
  )
}

function Mensajes({ estado }: { estado: EstadoCuenta }) {
  if (estado.error) {
    return (
      <div className="aviso error" role="alert">
        {estado.error}
      </div>
    )
  }
  if (estado.aviso) {
    return (
      <div className="aviso exito" role="status">
        {estado.aviso}
      </div>
    )
  }
  return null
}

/**
 * El campo del correo, igual en los dos formularios que lo piden.
 *
 * Va controlado porque React vacía los campos no controlados apenas termina una
 * server action, salga bien o mal: sin esto, equivocarse en el dominio obliga a
 * escribir la dirección entera de nuevo.
 */
function CampoCorreo({
  valor,
  cambiar,
  usuario,
  foco,
}: {
  valor: string
  cambiar: (v: string) => void
  usuario: string
  foco: boolean
}) {
  // Los dos formularios que piden el correo no se ven nunca a la vez, pero los
  // dos que piden la contraseña actual sí: el id sale de React para que cada
  // etiqueta apunte a su propio campo.
  const id = useId()

  return (
    <div className="campo">
      <label htmlFor={id}>Tu correo del municipio</label>
      <input
        id={id}
        name="correo"
        type="email"
        className="control"
        value={valor}
        onChange={(e) => cambiar(e.target.value)}
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="nombre@smt.gob.ar"
        maxLength={160}
        autoFocus={foco}
        required
      />
      <span className="ayuda">
        Si tenés casilla del municipio, usá esa; si no, sirve cualquiera. Desde que lo guardes
        entrás con esto y no con <span className="mono">{usuario}</span>, así que fijate que
        esté bien escrito.
      </span>
    </div>
  )
}

/** Los dos campos de la contraseña nueva, escrita dos veces. */
function CamposClaveNueva({
  nueva,
  repetida,
  cambiarNueva,
  cambiarRepetida,
  foco = false,
}: {
  nueva: string
  repetida: string
  cambiarNueva: (v: string) => void
  cambiarRepetida: (v: string) => void
  foco?: boolean
}) {
  const id = useId()

  return (
    <div className="pila-chica">
      <div className={comunes.grilla}>
        <div className="campo">
          <label htmlFor={`${id}-nueva`}>Contraseña nueva</label>
          <input
            id={`${id}-nueva`}
            name="nueva"
            type="password"
            className="control"
            value={nueva}
            onChange={(e) => cambiarNueva(e.target.value)}
            autoComplete="new-password"
            maxLength={128}
            autoFocus={foco}
            required
          />
        </div>
        <div className="campo">
          <label htmlFor={`${id}-repetida`}>Escribila otra vez</label>
          <input
            id={`${id}-repetida`}
            name="repetida"
            type="password"
            className="control"
            value={repetida}
            onChange={(e) => cambiarRepetida(e.target.value)}
            autoComplete="new-password"
            maxLength={128}
            required
          />
        </div>
      </div>
      <span className="ayuda">
        De {LARGO_MINIMO} caracteres para arriba, y distinta de la que estás usando ahora. Si el
        navegador o el gestor de contraseñas te ofrece guardarla, aceptá: es la que vas a escribir
        cada vez que entres.
      </span>
    </div>
  )
}

/** La contraseña de ahora, para las dos cosas que no alcanza con tener la sesión abierta. */
function CampoClaveActual({ valor, cambiar, ayuda }: {
  valor: string
  cambiar: (v: string) => void
  ayuda: string
}) {
  const id = useId()

  return (
    <div className="campo">
      <label htmlFor={id}>Tu contraseña actual</label>
      <input
        id={id}
        name="credencial"
        type="password"
        className="control"
        value={valor}
        onChange={(e) => cambiar(e.target.value)}
        autoComplete="current-password"
        maxLength={128}
        required
      />
      <span className="ayuda">{ayuda}</span>
    </div>
  )
}

/**
 * Lo obligatorio, en un formulario y un botón.
 *
 * El correo viene cargado cuando ya existe —pasa cuando otra cuenta de
 * coordinación le puso una contraseña provisoria a ésta— y lo único que falta
 * ahí es elegir la propia.
 *
 * Y en ese caso se muestra escrito, sin campo para tocarlo: cambiar un correo ya
 * cargado es mudarle la puerta a la cuenta y eso pide la contraseña actual, que
 * acá justamente no se pide. Si el que está cargado está mal, primero se elige
 * la contraseña y después se lo corrige desde la tarjeta del correo, que es la
 * que sabe pedirla.
 */
function Completar({
  datos,
  estado,
  accion,
}: {
  datos: DatosDeCuenta
  estado: EstadoCuenta
  accion: (datos: FormData) => void
}) {
  // Vacío y no `datos.correo`: el campo sólo se dibuja cuando no hay ninguno.
  const [correo, setCorreo] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const tieneCorreo = Boolean(datos.correo)

  return (
    <section className="tarjeta pila">
      <h2>{tieneCorreo ? 'Elegí tu contraseña' : 'Tu correo y tu contraseña'}</h2>

      {estado.error && (
        <div className="aviso error" role="alert">
          {estado.error}
        </div>
      )}

      <form action={accion} className="pila" noValidate>
        {tieneCorreo ? (
          <p className="menor gris" style={{ margin: 0 }}>
            Entrás con <span className="fuerte mono">{datos.correo}</span>. Lo podés cambiar
            desde acá mismo apenas elijas tu contraseña.
          </p>
        ) : (
          <CampoCorreo valor={correo} cambiar={setCorreo} usuario={datos.usuario} foco />
        )}
        <CamposClaveNueva
          nueva={nueva}
          repetida={repetida}
          cambiarNueva={setNueva}
          cambiarRepetida={setRepetida}
          foco={tieneCorreo}
        />
        <div className={comunes.acciones}>
          <Boton rotulo="Guardar y seguir" esperando="Guardando…" />
        </div>
      </form>
    </section>
  )
}

/**
 * El correo solo.
 *
 * Es la tarjeta de la cuenta ya completa, y también la pantalla entera en el
 * rato en que la base todavía no puede guardar la contraseña propia: ahí el
 * formulario nace abierto y no pide la contraseña actual, porque cargar el
 * correo es lo único que saca a esta cuenta de /cuenta.
 */
function TarjetaCorreo({ datos, alGuardar }: { datos: DatosDeCuenta; alGuardar: () => void }) {
  const [estado, accion] = useActionState<EstadoCuenta, FormData>(guardarCorreo, {})
  const [abierto, setAbierto] = useState(false)
  const [correo, setCorreo] = useState(datos.correo ?? '')
  const [actual, setActual] = useState('')
  const tieneCorreo = Boolean(datos.correo)
  const editando = abierto || !tieneCorreo

  useEffect(() => {
    if (!estado.aviso) return
    setAbierto(false)
    setActual('')
    alGuardar()
  }, [estado.aviso, alGuardar])

  // Lo guardado manda: cuando el correo cambió de verdad, el campo se pone al
  // día. Un intento rechazado no lo cambia, así que lo escrito sigue ahí.
  useEffect(() => {
    setCorreo(datos.correo ?? '')
  }, [datos.correo])

  return (
    <section className="tarjeta pila">
      <h2>Correo institucional</h2>
      <Mensajes estado={estado} />

      {tieneCorreo && (
        <div className="fila-entre">
          <span className="crecer">
            Entrás con <span className="fuerte mono">{datos.correo}</span>
            <span className="menor gris"> · tu usuario era {datos.usuario}</span>
          </span>
          {!abierto && (
            <button type="button" className="boton chico secundario" onClick={() => setAbierto(true)}>
              Cambiarlo
            </button>
          )}
        </div>
      )}

      {editando && (
        <form action={accion} className="pila" noValidate>
          <CampoCorreo valor={correo} cambiar={setCorreo} usuario={datos.usuario} foco />
          {/* Cambiar un correo ya cargado es mudarle la puerta a la cuenta;
              cargarlo la primera vez es la única forma de salir de acá. */}
          {tieneCorreo && (
            <CampoClaveActual
              valor={actual}
              cambiar={setActual}
              ayuda="Cambiar el correo cambia con qué entrás al panel, así que lo confirmamos con tu contraseña."
            />
          )}
          <div className={comunes.acciones}>
            <Boton rotulo="Guardar el correo" esperando="Guardando…" />
            {tieneCorreo && (
              <button
                type="button"
                className="boton chico fantasma"
                onClick={() => {
                  setAbierto(false)
                  setActual('')
                  setCorreo(datos.correo ?? '')
                }}
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  )
}

/** Con la cuenta completa: cambiar la contraseña, escribiendo la de ahora. */
function TarjetaClave({ datos, alGuardar }: { datos: DatosDeCuenta; alGuardar: () => void }) {
  const [estado, accion] = useActionState<EstadoCuenta, FormData>(cambiarClave, {})
  const [abierto, setAbierto] = useState(false)
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')

  useEffect(() => {
    if (!estado.aviso) return
    setAbierto(false)
    setActual('')
    setNueva('')
    setRepetida('')
    alGuardar()
  }, [estado.aviso, alGuardar])

  // La base todavía no tiene dónde anotar quién eligió la contraseña, así que
  // tampoco hay forma de cambiarla desde acá. Dura lo que tarda en aplicarse la
  // actualización; mientras tanto se entra con la de siempre.
  if (!datos.puedeElegirClave) {
    return (
      <section className="tarjeta pila">
        <h2>Contraseña</h2>
        <p className="gris" style={{ margin: 0 }}>
          Elegir tu propia contraseña va a estar disponible en un rato, cuando la base termine de
          actualizarse. Hasta entonces entrás con la que tenés. Si tarda, avisale a la Dirección de
          Inteligencia Artificial.
        </p>
      </section>
    )
  }

  return (
    <section className="tarjeta pila">
      <h2>Contraseña</h2>
      <Mensajes estado={estado} />

      <div className="fila-entre">
        <span className="crecer">
          La elegiste vos
          <span className="menor gris"> · desde el {fechaHora(datos.credencialCambiadaEn)}</span>
        </span>
        {!abierto && (
          <button type="button" className="boton chico secundario" onClick={() => setAbierto(true)}>
            Cambiarla
          </button>
        )}
      </div>

      {abierto && (
        <form action={accion} className="pila" noValidate>
          <CampoClaveActual
            valor={actual}
            cambiar={setActual}
            ayuda="Esta pantalla se abre en cualquier sesión abierta, así que la contraseña nueva se confirma con la de ahora."
          />
          <CamposClaveNueva
            nueva={nueva}
            repetida={repetida}
            cambiarNueva={setNueva}
            cambiarRepetida={setRepetida}
          />
          <div className={comunes.acciones}>
            <Boton rotulo="Cambiar la contraseña" esperando="Cambiando…" />
            <button
              type="button"
              className="boton chico fantasma"
              onClick={() => {
                setAbierto(false)
                setActual('')
                setNueva('')
                setRepetida('')
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

/** Qué le falta a esta cuenta, dicho en la línea del aviso de arriba. */
function queFalta(tieneCorreo: boolean, faltaLaClave: boolean): string {
  if (!faltaLaClave) {
    return 'Cargá el correo del municipio con el que vas a entrar de ahora en más.'
  }
  if (tieneCorreo) {
    return 'La contraseña que estás usando la eligió otra persona. Poné una tuya y seguimos.'
  }
  return 'Son dos datos y es una sola vez: tu correo del municipio y una contraseña que elijas vos.'
}

export function Cuenta({ datos }: { datos: DatosDeCuenta }) {
  /*
   * El estado de la acción obligatoria vive acá arriba y no adentro del
   * formulario. Al guardar, la pantalla pasa de un formulario a dos tarjetas:
   * si el estado viviera en el formulario, React lo desmontaría junto con él y
   * el «listo» se iría en el mismo instante en que aparece.
   */
  const [estadoCompletar, accionCompletar] = useActionState<EstadoCuenta, FormData>(
    completarCuenta,
    {},
  )

  /*
   * Ese «listo» se va apenas la persona guarda otra cosa. Si se quedara, quien
   * completa la cuenta y acto seguido corrige una letra del correo termina con
   * dos avisos verdes: el de abajo con la dirección nueva y el de arriba
   * repitiendo la vieja como si siguiera siendo con la que entra.
   */
  const [tapadoPorOtro, setTapadoPorOtro] = useState(false)
  const taparElListo = useCallback(() => setTapadoPorOtro(true), [])

  const tieneCorreo = Boolean(datos.correo)
  // Mientras la base no tenga la columna no hay nada que saber, y no saber no
  // deja a nadie afuera: en ese rato lo único que puede faltar es el correo.
  const faltaLaClave = datos.puedeElegirClave && !datos.credencialCambiadaEn
  const falta = !tieneCorreo || faltaLaClave

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Mi cuenta</h1>
        <p className="menor gris">
          Con qué correo y con qué contraseña entrás al panel. La contraseña es tuya y de nadie
          más: ni la Dirección de IA ni otra cuenta de coordinación pueden verla.
        </p>
      </header>

      {estadoCompletar.aviso && !falta && !tapadoPorOtro && (
        <div className="aviso exito" role="status">
          <p className="fuerte" style={{ margin: 0 }}>{estadoCompletar.aviso}</p>
          <p style={{ margin: '4px 0 0' }}>Ya podés usar el resto del panel.</p>
        </div>
      )}

      {falta && (
        <div className="aviso atencion" role="status">
          <p className="fuerte" style={{ margin: 0 }}>
            El resto del panel se abre cuando completes esto.
          </p>
          <p style={{ margin: '4px 0 0' }}>{queFalta(tieneCorreo, faltaLaClave)}</p>
        </div>
      )}

      {faltaLaClave ? (
        <Completar datos={datos} estado={estadoCompletar} accion={accionCompletar} />
      ) : (
        <>
          <TarjetaCorreo datos={datos} alGuardar={taparElListo} />
          <TarjetaClave datos={datos} alGuardar={taparElListo} />
        </>
      )}

      <p className="menor gris">
        Si olvidás tu contraseña, otra cuenta de coordinación te la cambia desde Usuarios y vos
        elegís una nueva al entrar. Si no hay ninguna otra, se hace desde una máquina con acceso a
        la base con{' '}
        <code className="mono">
          CONFIRMO_CLAVE=si DATABASE_URL=&quot;…&quot; npm run db:clave -- --usuario {datos.usuario}
        </code>
        . La cadena va escrita adelante, en la misma línea: los comandos de base que se corren
        pelados van a la que esté configurada en esa máquina, que puede no ser ésta.
      </p>
    </div>
  )
}
