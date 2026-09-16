/**
 * Diagnóstico del despliegue.
 *
 *     GET /api/salud
 *
 * Next esconde los errores de servidor detrás de un digest —`Application error:
 * a server-side exception has occurred`— y sin acceso a los logs del proveedor
 * eso no se puede diagnosticar. Esta ruta contesta las tres preguntas que
 * explican casi cualquier despliegue roto: si está la cadena de conexión, si la
 * base contesta, y si está la clave de firma.
 *
 * No devuelve ningún valor: solo si están o no, y cuántas migraciones ve. Ni el
 * host, ni el usuario, ni nada de la cadena de conexión, que es justo lo que un
 * endpoint así no tiene que filtrar. Y como se conecta igual que la app, un 200
 * acá significa que la app puede leer la base de verdad.
 */
import { NextResponse } from 'next/server'
import { comoServicio } from '@db/sesion'

export const dynamic = 'force-dynamic'

/**
 * El mensaje de error sin la cadena de conexión.
 *
 * Los errores de postgres-js a veces traen el host, y el host de la base no
 * tiene por qué salir en una respuesta pública.
 */
function sinSecretos(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e)
  return texto
    .replace(/postgres(ql)?:\/\/\S+/gi, '«cadena de conexión»')
    .replace(/[\w.-]+\.(supabase\.(co|com)|neon\.tech|rds\.amazonaws\.com)\b/gi, '«host»')
    .slice(0, 300)
}

export async function GET() {
  const hayUrl = Boolean(process.env.DATABASE_URL?.trim())
  const claveOk = (process.env.AUTH_SECRET ?? '').length >= 32
  // Sin DATABASE_URL la app usa PGlite, que en la máquina de desarrollo está
  // bien y en una función serverless no puede andar.
  const serverless = Boolean(
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY,
  )

  const salud: Record<string, unknown> = {
    motor: hayUrl ? 'postgres' : 'pglite',
    base_configurada: hayUrl || !serverless,
    clave_de_sesion: claveOk,
  }

  try {
    const filas = await comoServicio((tx) =>
      tx.consultar<{ n: string }>('select count(*)::text as n from app.migraciones'),
    )
    salud.conecta = true
    salud.migraciones = Number(filas[0]?.n ?? 0)
  } catch (e) {
    salud.conecta = false
    salud.error = sinSecretos(e)
  }

  const bien = (hayUrl || !serverless) && claveOk && salud.conecta === true
  salud.estado = bien ? 'ok' : 'falta configuración'

  if (!bien) {
    salud.que_hacer = [
      !hayUrl && serverless && 'Cargar DATABASE_URL en Vercel (Settings → Environment Variables, entorno Production) con la cadena del pooler en modo transacción, puerto 6543.',
      !claveOk && 'Cargar AUTH_SECRET, de al menos 32 caracteres: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))".',
      hayUrl && salud.conecta === false && 'La cadena está pero la base no contesta: revisar la contraseña dentro de la URL y que sea la del pooler.',
      'Después de cambiar una variable hay que volver a desplegar: Vercel no las recarga solo.',
    ].filter(Boolean)
  }

  return NextResponse.json(salud, { status: bien ? 200 : 503 })
}
