'use server'

/**
 * Olvidar lo que Migue recuerda y revisar las palabras que propone.
 *
 * Las dos cosas las hace la base: app.migue_olvidar_recuerdo vacía el recuerdo
 * y las conversaciones que lo tenían presente, y app.migue_revisar_expresion
 * cambia el estado de la expresión. Las dos tienen su guarda —de quién es el
 * recuerdo, que quien revisa sea coordinación—, así que acá sólo se valida lo
 * que llega del formulario y se arma el aviso de vuelta.
 *
 * Andan con Migue apagado. Es a propósito: el día que no contesta porque se
 * llegó al tope o se acabó el crédito, alguien igual puede querer que olvide
 * lo que le dijo, y eso no puede esperar a que Migue vuelva.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { olvidarRecuerdo, revisarExpresion } from '@/lib/migue/pantallas'
import { UUID } from '@/lib/recursos'
import { exigirAdminCompleto } from '@/lib/sesion'

const PANTALLA = '/migue/recuerdos'

/**
 * Vuelve a la pantalla contando qué pasó. Ni el recuerdo ni la expresión
 * viajan en la URL: son texto que escribió alguien, y una URL queda en el
 * historial del navegador y en los registros del proveedor.
 */
function volver(aviso: string, detalle = '', ancla = ''): never {
  const parametros = new URLSearchParams({ aviso })
  if (detalle) parametros.set('detalle', detalle)
  redirect(`${PANTALLA}?${parametros.toString()}${ancla}`)
}

export async function olvidar(datos: FormData): Promise<void> {
  const sesion = await exigirAdminCompleto().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const id = String(datos.get('id') ?? '').trim()
  if (!UUID.test(id)) volver('error', 'No se pudo identificar el recuerdo. Actualizá la pantalla.')

  const hecho = await olvidarRecuerdo(sesion, id)
  if (!hecho.ok) volver('error', hecho.error)

  revalidatePath(PANTALLA)
  // Olvidar pudo haber vaciado la conversación que la coordinadora tenía
  // abierta en Migue: si la pantalla del chat quedara en la memoria del
  // navegador, seguiría mostrando una charla que ya no existe.
  revalidatePath('/migue')
  volver('olvidado')
}

/** Lo que se puede decidir desde esta pantalla. Devolverla a «propuesta» no se ofrece. */
const DECISIONES = ['aprobada', 'descartada'] as const
type Decision = (typeof DECISIONES)[number]

export async function revisar(datos: FormData): Promise<void> {
  const sesion = await exigirAdminCompleto().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const id = String(datos.get('id') ?? '').trim()
  const estado = String(datos.get('estado') ?? '').trim()
  if (!UUID.test(id)) volver('error', 'No se pudo identificar la expresión. Actualizá la pantalla.', '#vocabulario')
  if (!(DECISIONES as readonly string[]).includes(estado)) {
    volver('error', 'No se entendió qué hacer con la expresión. Actualizá la pantalla.', '#vocabulario')
  }

  const hecho = await revisarExpresion(sesion, id, estado as Decision)
  if (!hecho.ok) volver('error', hecho.error, '#vocabulario')

  revalidatePath(PANTALLA)
  volver(estado, '', '#vocabulario')
}
