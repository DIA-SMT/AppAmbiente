'use server'

/**
 * Alta, edición y ciclo de vida de las pilas de compost.
 *
 * El ciclo es en_formacion → madurando → lista → despachada, y el paso que
 * importa es el cierre: desde la fecha de cierre se cuentan los meses de
 * maduración, así que sin ella no hay forma de saber cuándo una pila está
 * lista ni de marcar un volteo atrasado.
 *
 * Acá no se borra: una pila que no va más se da de baja con `activo`. La base
 * tiene revocado el DELETE para todos los roles.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { consultarConSesion } from '@db/sesion'
import { mensajeDeError } from '@/lib/datos'
import { UUID } from '@/lib/recursos'
import { exigirAdmin } from '@/lib/sesion'
import type { EstadoPila } from '@/lib/tipos'

export interface EstadoGuardado {
  error?: string
  /** Nombre de campo → qué le falta o qué está mal. */
  errores?: Record<string, string>
}

const ESTADOS: EstadoPila[] = ['en_formacion', 'madurando', 'lista', 'despachada']

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Fin del día de hoy en Tucumán, para no rechazar la fecha de hoy por la zona. */
function esFutura(iso: string): boolean {
  return new Date(`${iso}T23:59:59-03:00`).getTime() > Date.now()
}

/** Las columnas `date` vuelven de la base como medianoche UTC. */
function soloDia(v: unknown): string | null {
  if (!v) return null
  const iso = v instanceof Date ? v.toISOString() : String(v)
  return FECHA.test(iso.slice(0, 10)) ? iso.slice(0, 10) : null
}

// ── Validación del formulario ───────────────────────────────────────────

/** Los números llegan como texto y pueden venir con coma decimal. */
function medida(etiqueta: string, minimo: number, maximo: number) {
  return z.string().trim().superRefine((v, ctx) => {
    if (!v) {
      ctx.addIssue({ code: 'custom', message: `Falta ${etiqueta}.` })
      return
    }
    const n = Number(v.replace(',', '.'))
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: 'custom', message: 'Tiene que ser un número.' })
      return
    }
    if (n < minimo || n > maximo) {
      ctx.addIssue({ code: 'custom', message: `Tiene que estar entre ${minimo} y ${maximo} m.` })
    }
  }).transform((v) => Number(v.replace(',', '.')))
}

function opcional(maxLargo: number) {
  return z.string().trim().superRefine((v, ctx) => {
    if (v.length > maxLargo) {
      ctx.addIssue({ code: 'custom', message: `No puede pasar de ${maxLargo} caracteres.` })
    }
  }).transform((v) => v || null)
}

function referencia(etiqueta: string, obligatoria: boolean) {
  return z.string().trim().superRefine((v, ctx) => {
    if (!v) {
      if (obligatoria) ctx.addIssue({ code: 'custom', message: `Falta ${etiqueta}.` })
      return
    }
    if (!UUID.test(v)) ctx.addIssue({ code: 'custom', message: 'Elegí una opción de la lista.' })
  }).transform((v) => v || null)
}

const ESQUEMA = z.object({
  codigo: z.string().trim().superRefine((v, ctx) => {
    if (!v) ctx.addIssue({ code: 'custom', message: 'Falta el código de la pila.' })
    else if (v.length > 24) ctx.addIssue({ code: 'custom', message: 'No puede pasar de 24 caracteres.' })
  }),
  sitio_id: referencia('el punto', true),
  fecha_armado: z.string().trim().superRefine((v, ctx) => {
    if (!v) {
      ctx.addIssue({ code: 'custom', message: 'Falta la fecha en que se empezó a armar.' })
      return
    }
    if (!FECHA.test(v)) {
      ctx.addIssue({ code: 'custom', message: 'Escribí la fecha completa.' })
      return
    }
    if (esFutura(v)) ctx.addIssue({ code: 'custom', message: 'La fecha no puede estar en el futuro.' })
  }),
  largo_m: medida('el largo', 1, 500),
  ancho_m: medida('el ancho', 0.2, 50),
  alto_m: medida('el alto', 0.2, 20),
  responsable_id: referencia('el responsable', false),
  composicion: opcional(2000),
  notas: opcional(2000),
  activo: z.boolean(),
})

function erroresPorCampo(error: z.ZodError): Record<string, string> {
  const errores: Record<string, string> = {}
  for (const problema of error.issues) {
    const campo = String(problema.path[0] ?? '')
    if (campo && !errores[campo]) errores[campo] = problema.message
  }
  return errores
}

function traducir(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('pilas_codigo_key') || (m.includes('codigo') && m.includes('duplicate'))) {
    return 'Ya hay una pila con ese código. Los códigos no se repiten, ni siquiera con una pila dada de baja.'
  }
  if (m.includes('pilas_sitio_id_fkey')) return 'Ese punto ya no existe. Recargá la pantalla.'
  if (m.includes('pilas_responsable_id_fkey')) return 'Esa persona ya no existe. Recargá la pantalla.'
  return mensajeDeError(e)
}

// ── Alta y edición ──────────────────────────────────────────────────────

/**
 * Una sola escritura para las dos acciones: lo único que cambia es si hay id.
 * El estado no se toca acá — se mueve con cerrarPila y cambiarEstado, que son
 * las que saben qué implica cada paso del ciclo.
 */
async function guardar(id: string | null, datos: FormData): Promise<EstadoGuardado> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) return { error: 'Se cerró la sesión. Entrá de nuevo.' }

  if (id !== null && !UUID.test(id)) {
    return { error: 'No se pudo identificar la pila que estabas editando. Volvé a abrirla.' }
  }

  const analisis = ESQUEMA.safeParse({
    codigo: String(datos.get('codigo') ?? ''),
    sitio_id: String(datos.get('sitio_id') ?? ''),
    fecha_armado: String(datos.get('fecha_armado') ?? ''),
    largo_m: String(datos.get('largo_m') ?? ''),
    ancho_m: String(datos.get('ancho_m') ?? ''),
    alto_m: String(datos.get('alto_m') ?? ''),
    responsable_id: String(datos.get('responsable_id') ?? ''),
    composicion: String(datos.get('composicion') ?? ''),
    notas: String(datos.get('notas') ?? ''),
    // En el alta la casilla no existe: una pila nueva nace activa.
    activo: id === null ? true : datos.get('activo') === 'si',
  })
  if (!analisis.success) {
    return { error: 'Revisá lo que está marcado en rojo.', errores: erroresPorCampo(analisis.error) }
  }
  const v = analisis.data

  const valores = [
    v.codigo, v.sitio_id, v.fecha_armado,
    v.largo_m, v.ancho_m, v.alto_m,
    v.responsable_id, v.composicion, v.notas, v.activo,
  ]

  try {
    if (id) {
      const filas = await consultarConSesion<{ id: string }>(
        sesion,
        `update pilas
            set codigo = $1, sitio_id = $2, fecha_armado = $3::date,
                largo_m = $4, ancho_m = $5, alto_m = $6,
                responsable_id = $7, composicion = $8, notas = $9, activo = $10
          where id = $11
          returning id`,
        [...valores, id],
      )
      if (!filas.length) return { error: 'Esa pila ya no existe o no tenés permiso para editarla.' }
    } else {
      await consultarConSesion(
        sesion,
        `insert into pilas (codigo, sitio_id, fecha_armado, largo_m, ancho_m, alto_m,
                            responsable_id, composicion, notas, activo)
         values ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10)`,
        valores,
      )
    }
  } catch (e) {
    return { error: traducir(e) }
  }

  revalidatePath('/pilas')
  if (id) revalidatePath(`/pilas/${id}`)
  redirect(`/pilas?guardado=${encodeURIComponent(v.codigo)}`)
}

/** Abre una pila nueva: código, punto, fecha de armado, dimensiones, responsable y notas. */
export async function crearPila(
  _previo: EstadoGuardado,
  datos: FormData,
): Promise<EstadoGuardado> {
  return guardar(null, datos)
}

/** Edita una pila, composición declarada incluida. El id viaja en el formulario. */
export async function editarPila(
  _previo: EstadoGuardado,
  datos: FormData,
): Promise<EstadoGuardado> {
  return guardar(String(datos.get('id') ?? '').trim(), datos)
}

// ── Ciclo de vida ───────────────────────────────────────────────────────

/** Lo que la ficha puede contar después de cada acción. */
function volver(id: string, aviso: string, detalle?: string): never {
  const parametros = new URLSearchParams({ aviso })
  if (detalle) parametros.set('detalle', detalle)
  redirect(`/pilas/${id}?${parametros.toString()}`)
}

function refrescar(id: string) {
  revalidatePath('/pilas')
  revalidatePath(`/pilas/${id}`)
}

/** Mensaje pensado para la coordinadora, no para el log. */
class ErrorDePila extends Error {}

/**
 * Cierra la pila: deja de recibir material y pasa a madurar.
 *
 * La fecha la elige quien cierra, así que llega por el formulario; el id va
 * atado con bind desde la ficha.
 */
export async function cerrarPila(id: string, datos: FormData): Promise<void> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')
  if (!UUID.test(id)) redirect('/pilas')

  const fechaCierre = String(datos.get('fecha_cierre') ?? '').trim()
  if (!FECHA.test(fechaCierre)) volver(id, 'error', 'Escribí la fecha de cierre completa.')
  if (esFutura(fechaCierre)) volver(id, 'error', 'La fecha de cierre no puede estar en el futuro.')

  let aviso = 'cerrada'
  let detalle = ''
  try {
    const [pila] = await consultarConSesion<{ estado: EstadoPila; fecha_armado: unknown }>(
      sesion,
      'select estado, fecha_armado from pilas where id = $1',
      [id],
    )
    if (!pila) throw new ErrorDePila('Esa pila ya no existe.')
    if (pila.estado !== 'en_formacion') {
      throw new ErrorDePila('Esa pila ya estaba cerrada. Recargá la pantalla.')
    }
    const armado = soloDia(pila.fecha_armado)
    if (armado && fechaCierre < armado) {
      throw new ErrorDePila('El cierre no puede ser anterior al armado de la pila.')
    }

    const filas = await consultarConSesion<{ codigo: string }>(
      sesion,
      `update pilas set fecha_cierre = $2::date, estado = 'madurando'
        where id = $1 and estado = 'en_formacion'
        returning codigo`,
      [id, fechaCierre],
    )
    if (!filas.length) throw new ErrorDePila('No se pudo cerrar la pila. Recargá la pantalla.')
    detalle = filas[0].codigo
    refrescar(id)
  } catch (e) {
    aviso = 'error'
    detalle = e instanceof ErrorDePila ? e.message : traducir(e)
  }

  volver(id, aviso, detalle)
}

/**
 * Mueve la pila por el ciclo. El estado llega del formulario: puede ser el
 * paso siguiente de un botón o una corrección elegida a mano.
 */
export async function cambiarEstado(id: string, datos: FormData): Promise<void> {
  const sesion = await exigirAdmin().catch(() => null)
  if (!sesion) redirect('/ingresar')
  if (!UUID.test(id)) redirect('/pilas')

  const estado = String(datos.get('estado') ?? '').trim() as EstadoPila
  if (!ESTADOS.includes(estado)) volver(id, 'error', 'Ese estado no existe.')

  let aviso = 'estado'
  let detalle = ''
  try {
    const [pila] = await consultarConSesion<{ estado: EstadoPila; fecha_cierre: unknown }>(
      sesion,
      'select estado, fecha_cierre from pilas where id = $1',
      [id],
    )
    if (!pila) throw new ErrorDePila('Esa pila ya no existe.')
    if (pila.estado === estado) throw new ErrorDePila('La pila ya estaba en ese estado.')
    if (estado !== 'en_formacion' && !pila.fecha_cierre) {
      throw new ErrorDePila(
        'Primero cerrá la pila: sin fecha de cierre no se pueden contar los meses de maduración.',
      )
    }

    // Volver a formación es volver a recibir material, así que la fecha de
    // cierre deja de valer: si se mantuviera, la maduración seguiría contando
    // desde un cierre que ya no ocurrió.
    const filas = await consultarConSesion<{ codigo: string }>(
      sesion,
      `update pilas
          set estado = $2,
              fecha_cierre = case when $2 = 'en_formacion' then null else fecha_cierre end
        where id = $1
        returning codigo`,
      [id, estado],
    )
    if (!filas.length) throw new ErrorDePila('No se pudo cambiar el estado. Recargá la pantalla.')
    detalle = filas[0].codigo
    refrescar(id)
  } catch (e) {
    aviso = 'error'
    detalle = e instanceof ErrorDePila ? e.message : traducir(e)
  }

  volver(id, aviso, detalle)
}
