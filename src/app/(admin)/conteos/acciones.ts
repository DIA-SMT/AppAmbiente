'use server'

/**
 * Carga y corrección de un conteo diario desde el panel.
 *
 * El vigilador carga lo suyo desde el celular y la base le pone el límite de
 * siete días para atrás. La coordinadora no lo tiene: esta acción existe para
 * cuando el vigilador avisa por teléfono —"ayer vinieron quince"— o para
 * arreglar un día viejo que quedó mal.
 *
 * guardarConteo es idempotente por (punto, fecha): volver a cargar el mismo día
 * corrige el valor en vez de agregar otro, y el anterior queda en la auditoría.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { guardarConteo } from '@/lib/datos'
import { UUID } from '@/lib/recursos'
import { exigirAdmin } from '@/lib/sesion'

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Fin del día de hoy en Tucumán: así la fecha de hoy nunca se rechaza por la zona. */
function esFutura(iso: string): boolean {
  return new Date(`${iso}T23:59:59-03:00`).getTime() > Date.now()
}

/**
 * Vuelve a la pantalla contando qué pasó. Si algo salió mal, lo que se escribió
 * viaja en la URL y el formulario aparece con los mismos valores: nadie tiene
 * que volver a tipear el conteo entero por una fecha mal puesta.
 */
function volver(parametros: Record<string, string>, alFormulario = false): never {
  const limpios = Object.entries(parametros).filter(([, v]) => v !== '')
  redirect(`/conteos?${new URLSearchParams(limpios).toString()}${alFormulario ? '#cargar' : ''}`)
}

export async function registrarConteo(datos: FormData): Promise<void> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')

  const sitioId = String(datos.get('sitio_id') ?? '').trim()
  const fecha = String(datos.get('fecha') ?? '').trim()
  const escrito = String(datos.get('vecinos') ?? '').trim()
  const observaciones = String(datos.get('observaciones') ?? '').trim()

  const eco = { punto: sitioId, fecha, vecinos: escrito, obs: observaciones }
  const mal = (detalle: string) => ({ ...eco, aviso: 'error', detalle })

  if (!UUID.test(sitioId)) return volver(mal('Elegí el punto de la lista.'), true)
  if (!FECHA.test(fecha)) return volver(mal('Escribí la fecha completa.'), true)
  if (esFutura(fecha)) {
    return volver(mal('La fecha no puede estar en el futuro: el conteo se carga al cerrar la jornada.'), true)
  }

  const vecinos = Number(escrito)
  if (!escrito || !Number.isInteger(vecinos) || vecinos < 0) {
    return volver(mal('La cantidad de vecinos tiene que ser un número entero de cero para arriba.'), true)
  }

  const resultado = await guardarConteo(sesion, { sitioId, fecha, vecinos, observaciones })
  if (!resultado.ok) return volver(mal(resultado.error ?? 'No se pudo guardar el conteo.'), true)

  // El conteo entra en las visitas del tablero de Puntos Verdes: si no se
  // revalida, la coordinadora carga y sigue viendo el punto en cero.
  revalidatePath('/conteos')
  revalidatePath('/tablero/puntos-verdes')

  volver({
    aviso: resultado.corregido ? 'corregido' : 'guardado',
    punto: sitioId,
    fecha,
    vecinos: String(vecinos),
  })
}
