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
  /** Escaneó el código y lo confirmó. Un usuario de punto nunca tiene. */
  tiene_segundo_factor: boolean
  ultimo_acceso: string | null
  intentos_fallidos: number
  bloqueado_hasta: string | null
  sitio_nombre: string | null
  sitio_codigo: string | null
  /** Null cuando el perfil no dejó nada a su nombre y entonces se puede borrar. */
  rastro: string | null
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
     * Lo mismo con el correo y el segundo factor, que llegan en la 0023: si el
     * build sube antes que el SQL, nombrar p.correo tira la pantalla entera y
     * justo ésta es desde donde se arregla cualquier problema de acceso. Una
     * sola pregunta alcanza para las dos columnas: vienen en la misma
     * migración, así que están las dos o no está ninguna.
     */
    const [{ hay_rastro: hayRastro, hay_correo: hayCorreo }] = await tx.consultar<{
      hay_rastro: boolean
      hay_correo: boolean
    }>(
      `select to_regprocedure('app.rastro_de_perfil(uuid)') is not null as hay_rastro,
              exists (select 1 from pg_attribute
                       where attrelid = 'public.perfiles'::regclass
                         and attname = 'correo' and not attisdropped) as hay_correo`,
    )

    // El rastro viene con la fila, y no cuando alguien toca «Eliminar»: si la
    // pantalla ofreciera el botón y recién ahí preguntara, al que no se puede
    // borrar le contestaría con un error en vez de explicarle por qué.
    const perfiles = await tx.consultar<FilaPerfil>(
      `select p.id, p.usuario, p.nombre, p.rol, p.activo, p.ultimo_acceso,
              p.intentos_fallidos, p.bloqueado_hasta,
              ${hayCorreo ? 'p.correo' : 'null::text'} as correo,
              ${hayCorreo ? 'p.totp_confirmado_en is not null' : 'false'} as tiene_segundo_factor,
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
        <p className="menor gris">
          Un usuario por punto, compartido por quienes estén de turno, y uno de coordinación por
          cada persona que administre. El PIN de un punto se muestra una sola vez al crearlo o al
          resetearlo; la contraseña de una cuenta de coordinación la elige quien la va a usar y no
          se muestra nunca. La coordinación entra con su correo institucional y un código de seis
          dígitos que le da una app en el celular: el segundo factor lo configura cada uno la
          primera vez que entra, y si alguien pierde el teléfono se lo restablecés desde acá.
          Desactivar un usuario le corta el acceso en el próximo pedido, aunque tenga la sesión
          abierta en el celular. Al que nunca llegó a cargar nada se lo puede eliminar de la lista,
          y eso no tiene vuelta atrás; al que ya cargó algo sólo se lo desactiva, para no perder
          quién hizo qué.
        </p>
      </header>

      {/* El resultado de eliminar se muestra acá arriba y no en la fila: la fila
          que se borró ya no está cuando llega la respuesta. */}
      <ListaDeUsuarios resumen={`${numero(perfiles.length)} usuarios · ${numero(activos)} activos`}>
        <div className="desplazable">
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
                return (
                  <tr key={p.id}>
                    <td className="mono">
                      <div className="pila-chica">
                        <span>{p.usuario}</span>
                        {/* El correo va pegado al usuario porque son lo mismo:
                            las dos formas de escribir quién es al entrar. */}
                        {p.correo && <span className="menor gris">{p.correo}</span>}
                      </div>
                    </td>
                    <td className="fuerte">{p.nombre}</td>
                    <td>
                      <span className="chip">{p.rol === 'admin' ? 'Coordinación' : 'Punto'}</span>
                    </td>
                    <td>
                      {p.sitio_nombre
                        ? <>{p.sitio_nombre} <span className="menor gris mono">{p.sitio_codigo}</span></>
                        : <span className="gris">Todos</span>}
                    </td>
                    <td>
                      {p.ultimo_acceso
                        ? <>
                            {fechaHora(p.ultimo_acceso)}
                            <span className="menor gris"> · {haceCuanto(p.ultimo_acceso)}</span>
                          </>
                        : <span className="gris">Nunca entró</span>}
                    </td>
                    <td>
                      <div className="pila-chica">
                        <span className={p.activo ? 'chip ingreso' : 'chip anulado'}>
                          {p.activo ? 'Activo' : 'Desactivado'}
                        </span>
                        {trabado && (
                          <span className="chip salida">
                            Bloqueado hasta {fechaHora(p.bloqueado_hasta)}
                          </span>
                        )}
                        {!trabado && p.intentos_fallidos > 0 && (
                          <span className="menor gris">
                            {numero(p.intentos_fallidos)} intento{p.intentos_fallidos === 1 ? '' : 's'} fallido{p.intentos_fallidos === 1 ? '' : 's'}
                          </span>
                        )}
                        {/* Sólo en coordinación: al usuario de un punto no le
                            corresponde ni correo ni segundo factor, y decir que
                            le "falta" sería inventarle un problema. */}
                        {p.rol === 'admin' && (
                          p.tiene_segundo_factor
                            ? <span className="chip">Segundo factor puesto</span>
                            : <>
                                <span className="chip pendiente">Segundo factor pendiente</span>
                                <span className="menor gris">
                                  {p.correo ? 'Lo configura' : 'Carga el correo y lo configura'} la
                                  próxima vez que entre.
                                </span>
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
                          tieneSegundoFactor: p.tiene_segundo_factor,
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
