import { conSesion } from '@db/sesion'
import { fechaHora, haceCuanto, numero } from '@/lib/formato'
import { exigirPanel } from '@/lib/sesion'
import estilos from '../gente.module.css'
import {
  AccionesUsuario,
  FormularioUsuario,
  ListaDeUsuarios,
  type SitioParaUsuario,
} from './FormularioUsuario'

export const dynamic = 'force-dynamic'

interface FilaPerfil {
  id: string
  usuario: string
  nombre: string
  rol: 'admin' | 'vigilador'
  activo: boolean
  correo: string | null
  /**
   * Cuenta de coordinación cuya contraseña todavía la escribió otro.
   *
   * Es un estado y no un origen, y por eso no se llama «de fábrica»: la columna
   * queda en null en los tres caminos —la cuenta recién creada, la reseteada
   * desde esta misma lista y la que pasó por db:clave—, así que decir «con la
   * que la crearon» desmiente al aviso que la propia pantalla acaba de dar.
   */
  sin_clave_propia: boolean
  ultimo_acceso: string | null
  intentos_fallidos: number
  bloqueado_hasta: string | null
  sitio_nombre: string | null
  sitio_codigo: string | null
  /** Null cuando el perfil no dejó nada a su nombre y entonces se puede borrar. */
  rastro: string | null
}

/**
 * El correo de la fila, partido por el arroba cuando no entra.
 *
 * La celda es `mono` y `table.datos td.mono` no deja partir nada —está puesto
 * para una patente o un código de pila—, así que «mcorbalan@smt.gob.ar» entero
 * le fijaba 186 px de mínimo a la columna Usuario y se los sacaba a Nombre, que
 * salía en cuatro renglones. La clase lo deja partirse; el <wbr> le dice dónde,
 * porque el navegador prefiere un corte de verdad antes que cortar por el medio
 * de una palabra, y sin él quedaba «abrito@smt.g / ob.ar».
 */
function Correo({ valor }: { valor: string }) {
  const corte = valor.indexOf('@')
  return (
    <span className={`menor gris ${estilos.correo}`}>
      {corte < 0 ? valor : <>{valor.slice(0, corte + 1)}<wbr />{valor.slice(corte + 1)}</>}
    </span>
  )
}

export default async function PantallaUsuarios() {
  const sesion = await exigirPanel()

  const { perfiles, sitios } = await conSesion(sesion, async (tx) => {
    /*
     * La app se despliega en Vercel y la base se actualiza pegando SQL en
     * Supabase: son dos pasos, y nada garantiza el orden. Si el build sube
     * antes que la 0022, nombrar app.rastro_de_perfil en la consulta tiraría
     * todo el Server Component y esta pantalla —la única desde donde se crean
     * cuentas y se resetean PINes— dejaría de abrir por una función que falta.
     *
     * Preguntar primero si está cuesta una consulta que no puede fallar.
     * Mientras no esté, el rastro viaja en null: aparece «Eliminar» de más y la
     * base lo rechaza con su propio mensaje, que es un mal día mucho más chico.
     *
     * Con el correo (0023) el razonamiento es el mismo. Con
     * credencial_cambiada_en (0024) ya no es que puede pasar: pasa seguro. Esa
     * migración borra columnas que el código que está en el aire todavía
     * nombra, así que se aplica DESPUÉS de subir el build —al revés el ingreso
     * se cae para todos—, y en el rato que va de una cosa a la otra esta
     * pantalla corre contra una base donde la columna no existe. Mientras
     * tanto no hay forma de saber quién conserva la contraseña con la que la
     * crearon, así que no se avisa nada: mejor callado que inventando.
     */
    const [{
      hay_rastro: hayRastro,
      hay_correo: hayCorreo,
      hay_credencial: hayCredencial,
    }] = await tx.consultar<{
      hay_rastro: boolean
      hay_correo: boolean
      hay_credencial: boolean
    }>(
      `select to_regprocedure('app.rastro_de_perfil(uuid)') is not null as hay_rastro,
              exists (select 1 from pg_attribute
                       where attrelid = 'public.perfiles'::regclass
                         and attname = 'correo' and not attisdropped) as hay_correo,
              exists (select 1 from pg_attribute
                       where attrelid = 'public.perfiles'::regclass
                         and attname = 'credencial_cambiada_en'
                         and not attisdropped) as hay_credencial`,
    )

    // El rastro viene con la fila, y no cuando alguien toca «Eliminar»: si la
    // pantalla ofreciera el botón y recién ahí preguntara, al que no se puede
    // borrar le contestaría con un error en vez de explicarle por qué.
    const perfiles = await tx.consultar<FilaPerfil>(
      `select p.id, p.usuario, p.nombre, p.rol, p.activo, p.ultimo_acceso,
              p.intentos_fallidos, p.bloqueado_hasta,
              ${hayCorreo ? 'p.correo' : 'null::text'} as correo,
              ${hayCredencial
                ? `p.rol = 'admin' and p.credencial_cambiada_en is null`
                : 'false'} as sin_clave_propia,
              s.nombre as sitio_nombre, s.codigo as sitio_codigo,
              ${hayRastro ? 'app.rastro_de_perfil(p.id)' : 'null::text'} as rastro
         from perfiles p
         left join sitios s on s.id = p.sitio_id
        order by p.rol, s.orden nulls first, p.usuario`,
    )
    const sitios = await tx.consultar<SitioParaUsuario>(
      `select s.id, s.codigo, s.nombre,
              (count(p.id) filter (where p.rol = 'vigilador' and p.activo))::int as usuarios
         from sitios s
         left join perfiles p on p.sitio_id = s.id
        where s.activo
        group by s.id, s.codigo, s.nombre, s.orden
        order by s.orden`,
    )
    return { perfiles, sitios }
  })

  const ahora = Date.now()
  const activos = perfiles.filter((p) => p.activo).length

  return (
    <div className="pila">
      <header className="pila-chica">
        <h1>Usuarios y accesos</h1>
        {/* Ocho oraciones seguidas de punta a punta del panel eran diez
            renglones en el celular. Van en tres párrafos y con el ancho de
            lectura que ya usan Listas y Entidades. */}
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Un usuario por punto, compartido por quienes estén de turno, y uno de coordinación por
          cada persona que administre. El PIN de un punto se muestra una sola vez: al crearlo o al
          resetearlo.
        </p>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Una cuenta de coordinación se crea con su correo institucional y una contraseña
          provisoria. La próxima vez que entre, el panel la lleva a Mi cuenta y no la deja ir a
          otra pantalla hasta que elija la suya, así que quien la creó deja de saberla.
        </p>
        <p className="menor gris" style={{ margin: 0, maxWidth: 'var(--ancho-lectura)' }}>
          Desactivar un usuario le corta el acceso en el próximo pedido, aunque tenga la sesión
          abierta en el celular. Al que nunca llegó a cargar nada se lo puede eliminar de la lista,
          y eso no tiene vuelta atrás; al que ya cargó algo sólo se lo desactiva, para no perder
          quién hizo qué.
        </p>
      </header>

      {/* El resultado de eliminar se muestra acá arriba y no en la fila: la fila
          que se borró ya no está cuando llega la respuesta. */}
      <ListaDeUsuarios resumen={`${numero(perfiles.length)} usuarios · ${numero(activos)} activos`}>
        {/* Siete columnas no entran en 390 px: quedaban 689 px afuera y los
            botones de resetear el PIN, desactivar y eliminar parecían no
            existir. Abajo de 720 px cada usuario pasa a ser una ficha. */}
        <div className="desplazable tabla-ficha">
          <table className="datos">
            <thead>
              <tr>
                <th className="mono">Usuario</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Punto</th>
                <th>Último acceso</th>
                <th>Estado</th>
                <th className={estilos.columnaAcciones}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {perfiles.map((p) => {
                const trabado = Boolean(p.bloqueado_hasta && new Date(p.bloqueado_hasta).getTime() > ahora)
                // Lo mismo que mira el portón del panel antes de dejarla pasar
                // a cualquier pantalla que no sea Mi cuenta.
                const sinTerminar = p.rol === 'admin' && (!p.correo || p.sin_clave_propia)
                return (
                  <tr key={p.id}>
                    <td data-rotulo="Usuario" className="mono">
                      <div className="pila-chica">
                        <span>{p.usuario}</span>
                        {/* El correo va pegado al usuario porque son lo mismo:
                            las dos formas de escribir quién es al entrar. */}
                        {p.correo && <Correo valor={p.correo} />}
                      </div>
                    </td>
                    <td data-rotulo="Nombre" className="fuerte">{p.nombre}</td>
                    <td data-rotulo="Rol">
                      <span className="chip">{p.rol === 'admin' ? 'Coordinación' : 'Punto'}</span>
                    </td>
                    <td data-rotulo="Punto">
                      {p.sitio_nombre
                        ? <>{p.sitio_nombre} <span className="menor gris mono">{p.sitio_codigo}</span></>
                        : <span className="gris">Todos</span>}
                    </td>
                    <td data-rotulo="Último acceso">
                      {p.ultimo_acceso
                        ? <>
                            {fechaHora(p.ultimo_acceso)}
                            <span className="menor gris"> · {haceCuanto(p.ultimo_acceso)}</span>
                          </>
                        : <span className="gris">Nunca entró</span>}
                    </td>
                    <td data-rotulo="Estado">
                      <div className="pila-chica">
                        <span className={p.activo ? 'chip ingreso' : 'chip anulado'}>
                          {p.activo ? 'Activo' : 'Desactivado'}
                        </span>
                        {/* La fecha va afuera del chip: un chip no se parte
                            (white-space: nowrap), y «Bloqueado hasta 22/09/2026
                            10:05» le imponía 250 px de ancho mínimo a esta
                            columna, que es de lo que la tabla se pasaba del
                            panel. Afuera se acomoda en dos renglones. */}
                        {trabado && (
                          <>
                            <span className="chip salida">Bloqueado</span>
                            <span className="menor gris">
                              hasta {fechaHora(p.bloqueado_hasta)}
                            </span>
                          </>
                        )}
                        {!trabado && p.intentos_fallidos > 0 && (
                          <span className="menor gris">
                            {numero(p.intentos_fallidos)} intento{p.intentos_fallidos === 1 ? '' : 's'} fallido{p.intentos_fallidos === 1 ? '' : 's'}
                          </span>
                        )}
                        {/* Sólo en coordinación: al usuario de un punto no le
                            corresponde correo ni contraseña propia —la cuenta
                            es del punto—, y decir que le "falta" sería
                            inventarle un problema.

                            Qué pasa cuando entre lo dice el encabezado de la
                            pantalla, una vez: repetido en cada fila eran tres
                            renglones adentro de una columna angosta, y la fila
                            entera se estiraba. */}
                        {sinTerminar && (
                          <>
                            {!p.correo && <span className="chip pendiente">Sin correo</span>}
                            {/* Un chip no se parte, así que su texto es el
                                ancho mínimo de la columna: cuanto más largo,
                                más se pasa la tabla del panel. Y dice lo mismo
                                que «todavía no eligió la suya»: la que tiene se
                                la prestó quien la creó. */}
                            {p.sin_clave_propia && (
                              <span className="chip pendiente">Contraseña prestada</span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className={estilos.columnaAcciones}>
                      <AccionesUsuario
                        perfil={{
                          id: p.id,
                          usuario: p.usuario,
                          rol: p.rol,
                          activo: p.activo,
                          trabado: trabado || p.intentos_fallidos > 0,
                          rastro: p.rastro,
                          esVos: p.id === sesion.perfilId,
                        }}
                      />
                    </td>
                  </tr>
                )
              })}
              {perfiles.length === 0 && (
                <tr>
                  <td colSpan={7} className="centrado gris">Todavía no hay usuarios cargados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ListaDeUsuarios>

      <section className="tarjeta pila">
        <h2>Crear un usuario</h2>
        <FormularioUsuario sitios={sitios} />
      </section>
    </div>
  )
}
