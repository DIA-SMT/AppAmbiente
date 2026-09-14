'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { consultarConSesion } from '@db/sesion'
import { mensajeDeError } from '@/lib/datos'
import { exigirAdmin } from '@/lib/sesion'
import {
  UUID, identificador, recursoPorClave,
  type Campo, type Recurso,
} from '@/lib/recursos'

export interface EstadoGuardado {
  error?: string
  /** Nombre de campo → qué le falta o qué está mal. */
  errores?: Record<string, string>
}

// ── Validación armada desde la definición ───────────────────────────────

/**
 * Todo lo que llega del formulario es texto (o lista de textos, o casilla
 * marcada). Cada esquema valida ese texto y devuelve ya el valor que va a la
 * base. Los mensajes son propios: los de zod están en inglés.
 */
function esquemaDeCampo(campo: Campo) {
  const falta = `Falta ${campo.etiqueta.toLowerCase()}.`

  switch (campo.tipo) {
    case 'multi': {
      const validos = (campo.opciones ?? []).map((o) => o.valor)
      const limpiar = (v: string[]) => [...new Set(v.filter((x) => validos.includes(x)))]
      return z.array(z.string())
        .superRefine((v, ctx) => {
          if (campo.obligatorio && limpiar(v).length === 0) {
            ctx.addIssue({ code: 'custom', message: 'Elegí al menos una opción.' })
          }
        })
        .transform(limpiar)
    }

    case 'booleano':
      return z.boolean()

    case 'select': {
      const validos = campo.opciones?.map((o) => o.valor)
      return z.string().trim().superRefine((v, ctx) => {
        if (!v) {
          if (campo.obligatorio) ctx.addIssue({ code: 'custom', message: falta })
          return
        }
        if (validos && !validos.includes(v)) {
          ctx.addIssue({ code: 'custom', message: 'Esa opción no existe.' })
        }
        if (campo.origen && !UUID.test(v)) {
          ctx.addIssue({ code: 'custom', message: 'Elegí una opción de la lista.' })
        }
      }).transform((v) => v || null)
    }

    case 'color':
      return z.string().trim().superRefine((v, ctx) => {
        if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) {
          ctx.addIssue({ code: 'custom', message: 'El color tiene que ser un código como #126ff5.' })
        }
      }).transform((v) => v.toLowerCase() || null)

    case 'numero':
      return z.string().trim().superRefine((v, ctx) => {
        if (!v) {
          if (campo.obligatorio) ctx.addIssue({ code: 'custom', message: falta })
          return
        }
        const n = Number(v.replace(',', '.'))
        if (!Number.isFinite(n)) {
          ctx.addIssue({ code: 'custom', message: 'Tiene que ser un número.' })
          return
        }
        if (campo.entero && !Number.isInteger(n)) {
          ctx.addIssue({ code: 'custom', message: 'Tiene que ser un número entero.' })
        }
        if (campo.min !== undefined && n < campo.min) {
          ctx.addIssue({ code: 'custom', message: `No puede ser menor que ${campo.min}.` })
        }
        if (campo.max !== undefined && n > campo.max) {
          ctx.addIssue({ code: 'custom', message: `No puede ser mayor que ${campo.max}.` })
        }
      }).transform((v) => (v ? Number(v.replace(',', '.')) : null))

    case 'numeros':
      return z.string().trim().superRefine((v, ctx) => {
        if (!v) return
        const partes = v.split(',').map((p) => p.trim()).filter(Boolean)
        if (partes.some((p) => !Number.isFinite(Number(p)) || Number(p) <= 0)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Escribí solo números mayores que cero, separados por coma: 5, 10, 15.',
          })
        }
        if (partes.length > 8) {
          ctx.addIssue({ code: 'custom', message: 'Como mucho ocho, si no no entran en la pantalla.' })
        }
      }).transform((v) =>
        v.split(',').map((p) => p.trim()).filter(Boolean).map(Number).filter(Number.isFinite),
      )

    default:
      return z.string().trim().superRefine((v, ctx) => {
        if (!v && campo.obligatorio) {
          ctx.addIssue({ code: 'custom', message: falta })
        }
        if (campo.maxLargo && v.length > campo.maxLargo) {
          ctx.addIssue({ code: 'custom', message: `No puede pasar de ${campo.maxLargo} caracteres.` })
        }
      }).transform((v) => v || null)
  }
}

function esquemaDeRecurso(recurso: Recurso) {
  const forma: Record<string, z.ZodTypeAny> = {}
  for (const campo of recurso.campos) forma[campo.nombre] = esquemaDeCampo(campo)
  return z.object(forma)
}

/** Lee del formulario solo los campos de la definición. Nada más entra. */
function crudoDelFormulario(recurso: Recurso, datos: FormData): Record<string, unknown> {
  const crudo: Record<string, unknown> = {}
  for (const campo of recurso.campos) {
    if (campo.tipo === 'multi') {
      crudo[campo.nombre] = datos.getAll(campo.nombre).map(String)
    } else if (campo.tipo === 'booleano') {
      crudo[campo.nombre] = datos.get(campo.nombre) === 'si'
    } else {
      const texto = String(datos.get(campo.nombre) ?? '').trim()
      crudo[campo.nombre] = texto === '' && campo.predeterminado !== undefined
        ? String(campo.predeterminado)
        : texto
    }
  }
  return crudo
}

function erroresPorCampo(error: z.ZodError): Record<string, string> {
  const errores: Record<string, string> = {}
  for (const problema of error.issues) {
    const campo = String(problema.path[0] ?? '')
    if (campo && !errores[campo]) errores[campo] = problema.message
  }
  return errores
}

// ── Errores de la base, en castellano ───────────────────────────────────

function mensajeDeErrorDeLista(e: unknown, recurso: Recurso): string {
  const m = e instanceof Error ? e.message : String(e)
  const cosa = recurso.singular.toLowerCase()

  if (m.includes('_nombre_idx') || (m.includes('nombre') && m.includes('duplicate'))) {
    return `Ya hay ${recurso.articulo} ${cosa} con ese nombre. Si está desactivado, tocá "Mostrar también lo desactivado" y reactivalo en vez de crearlo de nuevo.`
  }
  if (m.includes('_patente_idx')) {
    return 'Ya hay un vehículo con esa patente, aunque esté escrita distinto.'
  }
  if (m.includes('codigo_key') || m.includes('codigo_idx')) {
    return 'Ese código ya está usado. Los códigos no se repiten.'
  }
  if (m.includes('entidad_sirve_para_algo')) {
    return 'Marcá al menos una casilla: la entidad tiene que servir como origen, como destino, o como las dos.'
  }
  if (m.includes('material_tipos_validos')) {
    return 'Elegí si el material entra, sale o las dos cosas.'
  }
  if (m.includes('material_flujos_validos')) {
    return 'Alguno de los flujos elegidos no existe.'
  }
  if (m.includes('duplicate key')) {
    return 'Ya existe una fila con esos datos.'
  }
  if (m.includes('check constraint')) {
    return 'Alguno de los valores no está permitido para esta lista.'
  }
  if (m.includes('foreign key')) {
    return 'Estás apuntando a algo que ya no existe. Recargá la pantalla y probá de nuevo.'
  }
  return mensajeDeError(e)
}

// ── Guardar ─────────────────────────────────────────────────────────────

/**
 * Alta y edición de cualquiera de las listas. El nombre de la tabla y el de
 * cada columna salen de la definición, nunca del formulario; del formulario
 * salen los valores y van como $1, $2…
 */
export async function guardar(
  _previo: EstadoGuardado,
  datos: FormData,
): Promise<EstadoGuardado> {
  const sesion = await exigirAdmin()

  const recurso = recursoPorClave(String(datos.get('recurso') ?? ''))
  if (!recurso) return { error: 'Esa lista no existe.' }

  const id = String(datos.get('id') ?? '').trim()
  if (id && !UUID.test(id)) {
    return { error: 'No se pudo identificar la fila que estabas editando. Volvé a abrirla.' }
  }

  const analisis = esquemaDeRecurso(recurso).safeParse(crudoDelFormulario(recurso, datos))
  if (!analisis.success) {
    return { error: 'Revisá lo que está marcado en rojo.', errores: erroresPorCampo(analisis.error) }
  }
  const valores = analisis.data as Record<string, unknown>

  const tabla = identificador(recurso.tabla)
  const columnas = recurso.campos.map((c) => identificador(c.nombre))
  const parametros = recurso.campos.map((c) => valores[c.nombre])
  const marcador = (campo: Campo, i: number) => {
    const casteo = campo.tipo === 'multi' ? '::text[]' : campo.tipo === 'numeros' ? '::numeric[]' : ''
    return `$${i + 1}${casteo}`
  }

  try {
    if (id) {
      const asignaciones = recurso.campos
        .map((c, i) => `${identificador(c.nombre)} = ${marcador(c, i)}`)
        .join(', ')
      const filas = await consultarConSesion<{ id: string }>(
        sesion,
        `update ${tabla} set ${asignaciones} where id = $${parametros.length + 1} returning id`,
        [...parametros, id],
      )
      if (!filas.length) {
        return { error: 'Esa fila ya no existe o no tenés permiso para editarla.' }
      }
    } else {
      await consultarConSesion(
        sesion,
        `insert into ${tabla} (${columnas.join(', ')})
         values (${recurso.campos.map(marcador).join(', ')})`,
        parametros,
      )
    }
  } catch (e) {
    return { error: mensajeDeErrorDeLista(e, recurso) }
  }

  revalidatePath('/listas')
  revalidatePath(`/listas/${recurso.clave}`)

  const etiqueta = String(valores[recurso.campoEtiqueta] ?? recurso.singular)
  redirect(`/listas/${recurso.clave}?guardado=${encodeURIComponent(etiqueta)}`)
}

// ── Activar y desactivar ────────────────────────────────────────────────

/**
 * No hay borrado en el sistema: la base tiene revocado el DELETE. Desactivar
 * saca la fila de las listas del celular y deja intactos los movimientos que
 * ya la usaron.
 */
export async function cambiarEstado(datos: FormData): Promise<void> {
  const sesion = await exigirAdmin()

  const recurso = recursoPorClave(String(datos.get('recurso') ?? ''))
  if (!recurso) return

  const id = String(datos.get('id') ?? '').trim()
  if (!UUID.test(id)) redirect(`/listas/${recurso.clave}?problema=1`)

  const activo = datos.get('activo') === 'si'

  try {
    await consultarConSesion(
      sesion,
      `update ${identificador(recurso.tabla)} set activo = $2 where id = $1`,
      [id, activo],
    )
  } catch {
    redirect(`/listas/${recurso.clave}?problema=1`)
  }

  revalidatePath('/listas')
  revalidatePath(`/listas/${recurso.clave}`)
}
