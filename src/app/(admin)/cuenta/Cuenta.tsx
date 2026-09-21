'use client'

/**
 * Mi cuenta, y el portón que lleva hasta acá.
 *
 * La pantalla va en un solo componente que no se desmonta nunca, con o sin
 * correo y con o sin segundo factor. Los ocho códigos de respaldo llegan en la
 * respuesta de la acción y viven en el estado de este componente: si la
 * pantalla cambiara de forma al quedar completa, React lo desmontaría en el
 * mismo instante en que aparecen y se irían sin que nadie llegue a anotarlos.
 * Después ya no se pueden volver a mostrar, porque en la base están hasheados.
 */

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { fechaHora } from '@/lib/formato'
import { accionDeSegundoFactor, guardarCorreo, type EstadoCuenta } from './acciones'
import comunes from '../gente.module.css'
import estilos from './cuenta.module.css'

export interface DatosDeCuenta {
  usuario: string
  nombre: string
  correo: string | null
  confirmadoEn: string | null
  /**
   * Está confirmado pero el secreto guardado no se puede descifrar: rotaron
   * AUTH_SECRET y el teléfono muestra códigos que ya no entran.
   */
  secretoIlegible: boolean
  codigosRestantes: number
  /** El secreto en claro, para escanear o copiar. Sólo mientras falte confirmar. */
  secreto: string | null
  /** El QR ya dibujado en el servidor, o null si no se pudo: el secreto alcanza. */
  qr: string | null
}

const CUANTOS_CODIGOS = 8

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

/**
 * Copiar al portapapeles, que no está en todos lados.
 *
 * Sin HTTPS el navegador no da el portapapeles, y entonces hay que decirlo: un
 * botón que parece que copió y no copió es la forma de perder los ocho códigos
 * creyendo que están guardados.
 */
function Copiar({ texto, rotulo = 'Copiar' }: { texto: string; rotulo?: string }) {
  const [estado, setEstado] = useState<'listo' | 'copiado' | 'nada'>('listo')

  useEffect(() => {
    if (estado === 'listo') return
    const reloj = setTimeout(() => setEstado('listo'), 4000)
    return () => clearTimeout(reloj)
  }, [estado])

  return (
    <span className="fila">
      <button
        type="button"
        className="boton chico secundario"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(texto)
            setEstado('copiado')
          } catch {
            setEstado('nada')
          }
        }}
      >
        {estado === 'copiado' ? 'Copiado' : rotulo}
      </button>
      {estado === 'nada' && (
        <span className={comunes.mensajeError} role="alert">
          No se pudo copiar. Seleccionalo con el dedo y copialo a mano.
        </span>
      )}
    </span>
  )
}

function Paso({
  numero,
  titulo,
  hecho,
  children,
}: {
  numero: number
  titulo: string
  hecho: boolean
  children: ReactNode
}) {
  return (
    <section className="tarjeta">
      <div className={estilos.paso}>
        <span className={estilos.numero} data-hecho={hecho ? 'true' : 'false'} aria-hidden="true">
          {hecho ? '✓' : numero}
        </span>
        <div className="pila">
          <h2>
            {titulo}
            {hecho && <span className="sr-solo"> — ya está listo</span>}
          </h2>
          {children}
        </div>
      </div>
    </section>
  )
}

/**
 * El campo de la contraseña que va adentro de las confirmaciones.
 *
 * Apagar el segundo factor, renovar los ocho códigos y cambiar el correo con el
 * que se entra son las tres cosas que una sesión abierta en un escritorio no
 * puede hacer sola. Se pide la contraseña y no el código del celular porque
 * estos botones se usan justo el día que el celular no está.
 */
function Contrasena({ id, ayuda }: { id: string; ayuda: string }) {
  return (
    <div className="campo">
      <label htmlFor={id}>Tu contraseña</label>
      <input
        id={id}
        name="credencial"
        type="password"
        className="control"
        autoComplete="current-password"
        maxLength={128}
        required
      />
      <span className="ayuda">{ayuda}</span>
    </div>
  )
}

/** Los ocho, una sola vez en la vida de esa cuenta. */
function CodigosDeRespaldo({ codigos }: { codigos: string[] }) {
  const caja = useRef<HTMLDivElement>(null)

  // Aparecen abajo de todo, después de un formulario que se envió: si la
  // pantalla no se mueve, lo único que se ve es que el campo se vació.
  useEffect(() => {
    caja.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  return (
    <div className={estilos.caja} ref={caja} role="status">
      <div className="pila-chica">
        <h2>Anotá estos ocho códigos ahora</h2>
        <p style={{ margin: 0 }}>
          Son la manera de entrar el día que no tengas el teléfono. Cada uno sirve una sola vez
          y <span className="fuerte">no se vuelven a mostrar</span>: guardalos donde guardás las
          contraseñas, o escribilos en un papel y metelo en un cajón con llave.
        </p>
      </div>

      <ul className={estilos.codigos}>
        {codigos.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>

      <Copiar texto={codigos.join('\n')} rotulo="Copiar los ocho" />
    </div>
  )
}

export function Cuenta({ datos }: { datos: DatosDeCuenta }) {
  const [estadoCorreo, accionCorreo] = useActionState<EstadoCuenta, FormData>(guardarCorreo, {})
  const [estadoFactor, accionFactor] = useActionState<EstadoCuenta, FormData>(
    accionDeSegundoFactor,
    {},
  )
  const [editando, setEditando] = useState(false)
  const [preguntando, setPreguntando] = useState<'regenerar' | 'reconfigurar' | null>(null)
  // El campo va controlado porque React vacía los no controlados apenas termina
  // una server action, salga bien o mal: sin esto, equivocarse en el dominio
  // obliga a escribir la dirección entera de nuevo.
  const [correo, setCorreo] = useState(datos.correo ?? '')

  const confirmado = Boolean(datos.confirmadoEn)
  const tieneCorreo = Boolean(datos.correo)
  const falta = !tieneCorreo || !confirmado

  useEffect(() => {
    if (estadoCorreo.aviso) setEditando(false)
  }, [estadoCorreo.aviso])

  // Lo guardado manda: cuando el correo cambió de verdad, el campo se pone al
  // día. Un intento rechazado no lo cambia, así que lo escrito sigue ahí.
  useEffect(() => {
    setCorreo(datos.correo ?? '')
  }, [datos.correo])

  useEffect(() => {
    if (estadoFactor.aviso || estadoFactor.error) setPreguntando(null)
  }, [estadoFactor.aviso, estadoFactor.error])

  const editandoCorreo = editando || !tieneCorreo

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Mi cuenta</h1>
        <p className="menor gris">
          Con qué correo entrás al panel, y el código de seis dígitos que el sistema te va a
          pedir después de la contraseña. Es tuyo y de nadie más: ni la Dirección de IA ni otra
          cuenta de coordinación pueden ver tu código ni tus contraseñas.
        </p>
      </header>

      {falta && (
        <div className="aviso atencion" role="status">
          <p className="fuerte" style={{ margin: 0 }}>
            El resto del panel se abre cuando termines estos dos pasos.
          </p>
          <p style={{ margin: '4px 0 0' }}>
            Son una sola vez. Tené el celular a mano: en el segundo paso hace falta.
          </p>
        </div>
      )}

      <Paso numero={1} titulo="Correo institucional" hecho={tieneCorreo}>
        {estadoCorreo.error && (
          <div className="aviso error" role="alert">
            {estadoCorreo.error}
          </div>
        )}
        {estadoCorreo.aviso && !estadoCorreo.error && (
          <div className="aviso exito" role="status">
            {estadoCorreo.aviso}
          </div>
        )}

        {!editandoCorreo ? (
          <div className="fila-entre">
            <span className="crecer">
              Entrás con <span className="fuerte mono">{datos.correo}</span>
              <span className="menor gris"> · tu usuario era {datos.usuario}</span>
            </span>
            <button type="button" className="boton chico secundario" onClick={() => setEditando(true)}>
              Cambiarlo
            </button>
          </div>
        ) : (
          <form action={accionCorreo} className="pila" noValidate>
            <div className="campo">
              <label htmlFor="correo">Tu correo del municipio</label>
              <input
                id="correo"
                name="correo"
                type="email"
                className="control"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="nombre@smt.gob.ar"
                maxLength={160}
                autoFocus={!tieneCorreo}
                required
              />
              <span className="ayuda">
                Tiene que terminar en @smt.gob.ar. Desde que lo guardes entrás con esto y no con
                tu nombre de usuario, así que fijate que esté bien escrito.
              </span>
            </div>
            {tieneCorreo && (
              <Contrasena
                id="clave-correo"
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
                    setEditando(false)
                    setCorreo(datos.correo ?? '')
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        )}
      </Paso>

      <Paso numero={2} titulo="Código del celular" hecho={confirmado && !datos.secretoIlegible}>
        {estadoFactor.error && (
          <div className="aviso error" role="alert">
            {estadoFactor.error}
          </div>
        )}
        {estadoFactor.aviso && !estadoFactor.error && (
          <div className="aviso exito" role="status">
            {estadoFactor.aviso}
          </div>
        )}

        {!tieneCorreo && (
          <p className="gris" style={{ margin: 0 }}>
            Primero guardá tu correo acá arriba: el código del celular se va a guardar con ese
            nombre y así lo reconocés entre los demás.
          </p>
        )}

        {tieneCorreo && !confirmado && datos.secreto && (
          <div className="pila">
            <p style={{ margin: 0 }}>
              Abrí en el celular la aplicación de códigos —Google Authenticator, Microsoft
              Authenticator, Authy, 1Password, la que uses—, elegí agregar una cuenta y escaneá
              esto. Si no podés escanear, cargá el texto a mano.
            </p>

            <div className={estilos.escaneo}>
              {datos.qr ? (
                <div
                  className={estilos.placa}
                  role="img"
                  aria-label="Código para escanear con la aplicación del celular"
                  dangerouslySetInnerHTML={{ __html: datos.qr }}
                />
              ) : (
                <div className={estilos.sinPlaca}>
                  No se pudo dibujar el código para escanear. Cargá el texto de al lado a mano:
                  funciona igual.
                </div>
              )}

              <div className="pila-chica">
                <span className="etiqueta">O cargalo a mano</span>
                <code className={estilos.secreto}>{enGrupos(datos.secreto)}</code>
                <span className="ayuda">
                  En la aplicación elegí «ingresar clave» o «entrada manual», poné{' '}
                  <span className="fuerte">Residuos SMT</span> como nombre y pegá esto. Los
                  espacios no importan.
                </span>
                <Copiar texto={datos.secreto} rotulo="Copiar el texto" />
              </div>
            </div>

            <form action={accionFactor} className="pila">
              <input type="hidden" name="accion" value="confirmar" />
              <div className="campo">
                <label htmlFor="codigo">Escribí el código que muestra la aplicación</label>
                <input
                  id="codigo"
                  name="codigo"
                  className={`control ${estilos.campoCodigo}`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  autoFocus
                  required
                />
                <span className="ayuda">
                  Son seis dígitos y cambian cada treinta segundos. Hasta que no escribas uno, el
                  sistema no te lo va a pedir para entrar: así nadie queda afuera por haber
                  cerrado esta pantalla a mitad de camino.
                </span>
              </div>
              <div className={comunes.acciones}>
                <Boton rotulo="Confirmar y activar" esperando="Comprobando…" />
              </div>
            </form>
          </div>
        )}

        {tieneCorreo && !confirmado && !datos.secreto && (
          <div className="aviso error" role="alert">
            No se pudo preparar el código para escanear. Actualizá la pantalla; si sigue igual,
            avisale a la Dirección de Inteligencia Artificial.
          </div>
        )}

        {confirmado && (
          <div className="pila">
            {datos.secretoIlegible ? (
              // Decir «Activado» acá sería afirmar que anda algo que no anda, y
              // dejar escondido el único botón que lo arregla.
              <div className="aviso error" role="alert">
                <p className="fuerte" style={{ margin: 0 }}>
                  El código de tu celular dejó de servir para esta cuenta.
                </p>
                <p style={{ margin: '4px 0 0' }}>
                  Cambió una clave del servidor y lo que estaba guardado ya no se puede leer: la
                  aplicación del celular te va a seguir mostrando números, pero ninguno va a
                  entrar. Tocá <span className="fuerte">Cambié de teléfono</span> acá abajo y
                  configuralo de nuevo; mientras tanto entrás con un código de respaldo.
                </p>
              </div>
            ) : (
              <>
                <div className="fila">
                  <span className="chip ingreso">Activado</span>
                  <span className="menor gris">desde el {fechaHora(datos.confirmadoEn)}</span>
                </div>
                <p style={{ margin: 0 }}>
                  Cada vez que entres, después de la contraseña te vamos a pedir el código de seis
                  dígitos de tu celular.
                </p>
              </>
            )}

            <div className="pila-chica">
              <span className="etiqueta">Códigos de respaldo</span>
              <span>
                {datos.codigosRestantes > 0 ? (
                  <>
                    Te quedan <span className="fuerte">{datos.codigosRestantes}</span> de{' '}
                    {CUANTOS_CODIGOS} sin usar.
                  </>
                ) : (
                  <span className="fuerte">No te queda ninguno sin usar.</span>
                )}{' '}
                Son los que te dejan entrar el día que no tengas el teléfono. Si no sabés dónde
                quedaron, generá ocho nuevos: los de antes dejan de servir en el acto.
              </span>
            </div>

            <div className={comunes.acciones}>
              {preguntando !== 'regenerar' && (
                <button
                  type="button"
                  className="boton chico secundario"
                  onClick={() => setPreguntando('regenerar')}
                >
                  Generar ocho códigos nuevos
                </button>
              )}
              {preguntando !== 'reconfigurar' && (
                <button
                  type="button"
                  className="boton chico secundario"
                  onClick={() => setPreguntando('reconfigurar')}
                >
                  Cambié de teléfono
                </button>
              )}
            </div>

            {preguntando === 'regenerar' && (
              <div className={comunes.confirmarCuerpo}>
                <span>
                  Se generan ocho nuevos y los que tengas anotados dejan de servir. Tenelos a la
                  vista cuando aparezcan: se muestran una sola vez.
                </span>
                <form action={accionFactor} className="pila-chica">
                  <input type="hidden" name="accion" value="regenerar" />
                  <Contrasena
                    id="clave-regenerar"
                    ayuda="Los códigos que tengas anotados dejan de servir, así que lo confirmamos con tu contraseña."
                  />
                  <div className={comunes.acciones}>
                    <Boton rotulo="Sí, generar ocho nuevos" esperando="Generando…" clase="boton chico" />
                    <button
                      type="button"
                      className="boton chico fantasma"
                      onClick={() => setPreguntando(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </div>
            )}

            {preguntando === 'reconfigurar' && (
              <div className={comunes.confirmarCuerpo}>
                <span>
                  Se borra lo que está configurado y arrancás de cero con el teléfono nuevo: hay
                  que escanear otro código y confirmarlo acá. Los códigos de respaldo de ahora
                  también se van, y al final te damos ocho nuevos. Mientras tanto entrás sólo con
                  tu contraseña y el panel te trae de vuelta a esta pantalla.
                </span>
                <form action={accionFactor} className="pila-chica">
                  <input type="hidden" name="accion" value="reconfigurar" />
                  <Contrasena
                    id="clave-reconfigurar"
                    ayuda="Hasta que confirmes el teléfono nuevo se entra con la contraseña sola, así que lo confirmamos con ella."
                  />
                  <div className={comunes.acciones}>
                    <Boton
                      rotulo="Sí, empezar de nuevo"
                      esperando="Borrando…"
                      clase="boton peligro chico"
                    />
                    <button
                      type="button"
                      className="boton chico fantasma"
                      onClick={() => setPreguntando(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}
      </Paso>

      {estadoFactor.codigos && estadoFactor.codigos.length > 0 && (
        <CodigosDeRespaldo codigos={estadoFactor.codigos} />
      )}

      <p className="menor gris">
        Si perdés el teléfono y también los códigos de respaldo, otra cuenta de coordinación te
        restablece el segundo factor desde Usuarios. Si no hay ninguna otra, se hace desde una
        máquina con acceso a la base con{' '}
        <code className="mono">npm run db:2fa -- --usuario {datos.usuario} --reset</code>.
      </p>
    </div>
  )
}

/** El secreto en grupos de cuatro, que es como se copia a mano sin perderse. */
function enGrupos(secreto: string): string {
  return secreto.replace(/(.{4})/g, '$1 ').trim()
}
