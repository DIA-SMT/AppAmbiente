import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import { exigirAdmin } from '@/lib/sesion'
import { Cuenta } from './Cuenta'

export const dynamic = 'force-dynamic'

interface FilaCuenta {
  usuario: string
  correo: string | null
  credencial_cambiada_en: string | null
}

const COLUMNAS_NUEVAS = ['correo', 'credencial_cambiada_en']

export default async function PantallaCuenta() {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')

  /*
   * Primero se pregunta qué columnas tiene la base, y se pregunta por cada una
   * por separado.
   *
   * El build sube por su cuenta a Vercel y el SQL se pega a mano en Supabase:
   * son dos pasos sueltos, y el orden es ése —primero el código, después la
   * migración—, así que hay un rato en el que `credencial_cambiada_en` todavía
   * no existe. Nombrarla ahí voltea el Server Component, y ésta es la pantalla
   * a la que el portón manda a las cuentas a medio configurar: si se cae, esa
   * gente se queda mirando un error sin salida. Preguntando antes, en ese rato
   * se puede cargar igual el correo y lo único que espera es la contraseña.
   *
   * Va contra pg_attribute y no contra information_schema porque esta consulta
   * corre con el rol `authenticated`, e information_schema esconde las columnas
   * sobre las que el rol no tiene permisos: una lista vacía por un permiso
   * diría «falta la actualización» cuando lo que falta es un grant.
   */
  const { columnas, fila } = await conSesion(sesion, async (tx) => {
    const presentes = await tx.consultar<{ attname: string }>(
      `select attname
         from pg_attribute
        where attrelid = 'public.perfiles'::regclass
          and not attisdropped
          and attname = any($1::text[])`,
      [COLUMNAS_NUEVAS],
    )
    const columnas = new Set(presentes.map((c) => c.attname))
    if (!columnas.has('correo')) return { columnas, fila: null }

    const marca = columnas.has('credencial_cambiada_en')
      ? 'credencial_cambiada_en'
      : 'null::timestamptz as credencial_cambiada_en'
    const filas = await tx.consultar<FilaCuenta>(
      `select usuario, correo, ${marca} from perfiles where id = $1`,
      [sesion.perfilId],
    )
    return { columnas, fila: filas[0] ?? null }
  })

  // Sin la columna del correo no queda ninguna de las dos mitades de esta
  // pantalla. Es la base anterior a la actualización del ingreso, y en ese caso
  // el panel entero anda como antes: no hay nada que completar todavía.
  if (!columnas.has('correo')) {
    return (
      <div className="pila angosto">
        <h1>Mi cuenta</h1>
        <div className="aviso atencion" role="status">
          <p className="fuerte">La base todavía no está actualizada.</p>
          <p>
            Falta aplicarle la actualización que guarda el correo institucional y la contraseña
            que elegís vos. Avisale a la Dirección de Inteligencia Artificial. Mientras tanto
            entrás igual, con lo de siempre, y el panel funciona como hasta ahora.
          </p>
        </div>
      </div>
    )
  }

  if (!fila) redirect('/ingresar')

  return (
    <Cuenta
      datos={{
        usuario: fila.usuario,
        correo: fila.correo,
        credencialCambiadaEn: fila.credencial_cambiada_en,
        puedeElegirClave: columnas.has('credencial_cambiada_en'),
      }}
    />
  )
}
