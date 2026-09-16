'use server'

/**
 * Lo que la coordinación hace con la cola de recambios.
 *
 * El circuito real no cambia: el pedido sigue viajando por WhatsApp al grupo de
 * choferes de la 9 de Julio, que es el canal de la empresa. Lo que cambia es que
 * queda registrado cuándo se avisó y cuándo se retiró, que es lo único que
 * después permite contestar cuánto espera un punto por un recambio.
 *
 * Las dos esperas se miden por separado —lo que tarda el municipio en avisar y
 * lo que tarda la empresa en venir— y eso condiciona estas acciones: marcar un
 * aviso que no ocurrió, o cerrar un retiro con una fecha anterior al aviso,
 * ensucia justamente el número que la pantalla existe para producir.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { consultarConSesion } from '@db/sesion'
import { cancelarPedido, confirmarRetiro, marcarAvisado, mensajeDeError } from '@/lib/datos'
import { fechaHora, paraInputFechaHora } from '@/lib/formato'
import { UUID } from '@/lib/recursos'
import { exigirAdmin } from '@/lib/sesion'

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Mensaje pensado para la coordinadora, no para el log. */
class ErrorDeRecambio extends Error {}

/** Hoy en Tucumán, como lo escribe un <input type="date">. */
const hoyEnTucuman = () => paraInputFechaHora().slice(0, 10)

/** Lo que la pantalla puede contar después de cada acción. */
function volver(aviso: string, detalle?: string): never {
  const parametros = new URLSearchParams({ aviso })
  if (detalle) parametros.set('detalle', detalle)
  redirect(`/recambios?${parametros.toString()}`)
}

/** El primer problema que encontró zod, que es el que hay que arreglar primero. */
function primerMensaje(error: z.ZodError, porDefecto: string): string {
  return error.issues[0]?.message || porDefecto
}

// ── Avisar a la empresa, en lote ────────────────────────────────────────

const IDS = z
  .array(z.string().regex(UUID, 'Hay un pedido que no se pudo identificar. Recargá la pantalla.'))
  .min(1, 'No elegiste ningún pedido: tildá los que ya le pasaste a la empresa.')

/**
 * La coordinación ya pasó estos pedidos al grupo de la 9 de Julio.
 *
 * Va en lote porque así se trabaja: se juntan los del día y se mandan de una.
 * Los ids llegan como las casillas marcadas del formulario, así que la pantalla
 * anda también sin JavaScript.
 */
export async function avisar(datos: FormData): Promise<void> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const analisis = IDS.safeParse(datos.getAll('id').map(String))
  if (!analisis.success) {
    volver('error', primerMensaje(analisis.error, 'No se pudo leer qué pedidos elegiste.'))
  }

  const resultado = await marcarAvisado(sesion, analisis.data)
  if (!resultado.ok) volver('error', resultado.error ?? 'No se pudieron marcar los pedidos.')

  // marcarAvisado solo toca los que seguían en 'pedido': si no quedó ninguno,
  // es que otra persona los marcó mientras esta pantalla estaba abierta.
  if (!resultado.cuantos) {
    volver('error', 'Esos pedidos ya los había marcado otra persona. Recargá la pantalla.')
  }

  revalidatePath('/recambios')
  volver('avisados', String(resultado.cuantos))
}

// ── Confirmar el retiro ─────────────────────────────────────────────────

const ESQUEMA_RETIRO = z.object({
  fecha: z.string().trim().regex(FECHA, 'Escribí la fecha del retiro completa.'),
  remito: z
    .string()
    .trim()
    .max(60, 'El número de remito no puede pasar de 60 caracteres.')
    .transform((v) => v || null),
  peso_kg: z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      if (!v) return
      const n = Number(v.replace(',', '.'))
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: 'custom', message: 'El peso tiene que ser un número, en kilos.' })
      } else if (n < 0) {
        ctx.addIssue({ code: 'custom', message: 'El peso no puede ser negativo.' })
      } else if (n > 100_000) {
        ctx.addIssue({ code: 'custom', message: 'Ese peso es demasiado alto. Revisá el remito.' })
      }
    })
    .transform((v) => (v ? Number(v.replace(',', '.')) : null)),
})

/**
 * Cuándo se guarda que ocurrió el retiro.
 *
 * Si es de hoy, se guarda el instante real (null deja que la base ponga now()).
 * Si es de un día anterior, al mediodía de Tucumán, que es la hora a la que
 * ninguna conversión de zona corre el día.
 *
 * Fechar para atrás solo se puede cuando el aviso a la empresa ya estaba
 * registrado, y nunca antes de ese aviso: confirmarRetiro sella el aviso con
 * now() si falta, así que un retiro anterior daría una espera negativa y el
 * promedio de la empresa saldría mejor de lo que fue.
 */
function instanteDelRetiro(fecha: string, hoy: string, avisadoEn: Date | string | null): string | null {
  if (fecha >= hoy) return null

  if (!avisadoEn) {
    throw new ErrorDeRecambio(
      'Este pedido nunca se marcó como avisado a la empresa, así que el aviso queda registrado '
      + 'recién ahora y el retiro no puede ser de un día anterior. Si el retiro ya pasó, cerralo '
      + 'con la fecha de hoy: la espera de la empresa de este pedido no se va a poder medir.',
    )
  }

  const instante = `${fecha}T12:00:00-03:00`
  if (new Date(instante).getTime() < new Date(avisadoEn).getTime()) {
    throw new ErrorDeRecambio(
      `El retiro no puede ser anterior al aviso a la empresa (${fechaHora(avisadoEn)}).`,
    )
  }
  return instante
}

/**
 * Cierra el pedido. El remito es lo que después permite cruzar esto contra el
 * Excel que la empresa manda a fin de mes.
 *
 * El id viaja atado con bind desde la ficha; el resto llega por el formulario.
 */
export async function confirmar(id: string, datos: FormData): Promise<void> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')
  if (!UUID.test(id)) volver('error', 'No se pudo identificar el pedido. Recargá la pantalla.')

  const analisis = ESQUEMA_RETIRO.safeParse({
    fecha: String(datos.get('fecha') ?? ''),
    remito: String(datos.get('remito') ?? ''),
    peso_kg: String(datos.get('peso_kg') ?? ''),
  })
  if (!analisis.success) {
    volver('error', primerMensaje(analisis.error, 'Revisá los datos del retiro.'))
  }
  const v = analisis.data

  const hoy = hoyEnTucuman()
  if (v.fecha > hoy) volver('error', 'La fecha del retiro no puede estar en el futuro.')

  let aviso = 'retirado'
  let detalle = ''
  try {
    const [pedido] = await consultarConSesion<{ avisado_en: Date | string | null }>(
      sesion,
      `select avisado_en from pedidos_recambio
        where id = $1 and estado in ('pedido', 'avisado')`,
      [id],
    )
    if (!pedido) throw new ErrorDeRecambio('Ese pedido ya estaba cerrado. Recargá la pantalla.')

    const resultado = await confirmarRetiro(sesion, {
      id,
      retirado_en: instanteDelRetiro(v.fecha, hoy, pedido.avisado_en) ?? undefined,
      remito: v.remito,
      peso_kg: v.peso_kg,
    })
    if (!resultado.ok) throw new ErrorDeRecambio(resultado.error ?? 'No se pudo cerrar el pedido.')

    detalle = v.remito ? `remito ${v.remito}` : ''
    revalidatePath('/recambios')
  } catch (e) {
    aviso = 'error'
    detalle = e instanceof ErrorDeRecambio ? e.message : mensajeDeError(e)
  }

  volver(aviso, detalle)
}

// ── Cancelar ────────────────────────────────────────────────────────────

const MOTIVO = z
  .string()
  .trim()
  .min(3, 'Decí por qué se cancela: con tres letras alcanza, pero algo tiene que decir.')
  .max(200, 'El motivo no puede pasar de 200 caracteres.')

/**
 * Se cancela cuando el pedido no correspondía: el contenedor no estaba lleno, o
 * lo retiraron sin que nadie avisara y ya no hay nada que pedir. El motivo lo
 * exige también la base, y es lo que después explica por qué ese pedido no
 * cuenta en el tiempo de respuesta.
 */
export async function cancelar(id: string, datos: FormData): Promise<void> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')
  if (!UUID.test(id)) volver('error', 'No se pudo identificar el pedido. Recargá la pantalla.')

  const analisis = MOTIVO.safeParse(String(datos.get('motivo') ?? ''))
  if (!analisis.success) {
    volver('error', primerMensaje(analisis.error, 'Escribí el motivo de la cancelación.'))
  }

  const resultado = await cancelarPedido(sesion, id, analisis.data)
  if (!resultado.ok) volver('error', resultado.error ?? 'No se pudo cancelar el pedido.')

  revalidatePath('/recambios')
  volver('cancelado', analisis.data)
}

// ── Conteo para la barra de navegación ──────────────────────────────────

/**
 * Los pedidos abiertos, para el número que va al lado de «Recambios» en la
 * barra. Vive acá y no en el layout porque la barra es un componente de cliente:
 * la llama al montarse y cada vez que se cambia de sección.
 *
 * Cuenta pedidos y avisados juntos: los dos son cosas que todavía no terminaron,
 * y el rótulo de la barra dice «pendientes», no «sin avisar».
 */
export async function contarRecambiosAbiertos(): Promise<number> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) return 0

  try {
    const [fila] = await consultarConSesion<{ total: number }>(
      sesion,
      `select count(*)::int as total from pedidos_recambio
        where estado in ('pedido', 'avisado')`,
    )
    return fila?.total ?? 0
  } catch {
    // Un número de menos en la barra no justifica romper el panel entero.
    return 0
  }
}
