/**
 * Lo que Migue lee del entorno, y cuándo se apaga solo.
 *
 * Migue es lo único del sistema que puede faltar sin que falte nada: el día
 * que se acabe el crédito, que el proveedor se caiga o que alguien borre la
 * clave, el vigilador tiene que seguir cargando exactamente igual. Por eso
 * todo lo que sale mal acá APAGA a Migue con un motivo escrito, y nunca
 * rompe una pantalla.
 *
 * Hay dos preguntas distintas, y separarlas no es un detalle:
 *
 *   ¿se puede conversar?  Hace falta la clave, el modelo, el tope y la
 *                         migración 0025, y que no se haya llegado al tope.
 *   ¿hay que mostrarlo?   Alcanza con la 0025. Apagado por el tope o sin
 *                         clave, «Lo que Migue recuerda» tiene que seguir a
 *                         la vista: todo lo que recuerda se ve y se olvida
 *                         desde una pantalla, también el día que no contesta.
 */
import 'server-only'

import type { Conexion } from '@db/client'

/**
 * El modelo si ASISTENTE_MODELO está vacío.
 *
 * La Dirección de IA pidió gpt-4o-mini «o, a lo sumo, uno más arriba», y se
 * midió antes de elegir: 38 preguntas reales —las del relevamiento, con errores
 * de tipeo y todo— corridas por el orquestador de verdad contra una copia de la
 * base local, tres vueltas, el 28/09/2026. En la última, gpt-4o-mini presentó
 * los conteos de su propio punto como si fueran de Lamadrid, eligió una de las
 * dos Huertas sin decirlo y terminó una respuesta en el control de números;
 * gpt-4.1-mini dijo en cada caso que el otro punto lo ve la coordinación,
 * consultó las dos Huertas por separado y no se equivocó en ninguna. Cuesta
 * casi el doble —0,0015 USD por pregunta contra 0,0009—, que con el tope de 20
 * USD son unas 13.000 preguntas por mes contra 22.000: la diferencia no se va a
 * notar en la cuenta y sí en las respuestas.
 */
export const MODELO_POR_DEFECTO = 'openai/gpt-4.1-mini'

/** Qué parte del tope mensual puede gastar en un día un punto, y una coordinadora. */
export const PARTE_DIARIA_DE_UN_PUNTO = 0.1
export const PARTE_DIARIA_DE_COORDINACION = 0.25

export type Esfuerzo = 'minimal' | 'low' | 'medium' | 'high'
const ESFUERZOS: Esfuerzo[] = ['minimal', 'low', 'medium', 'high']

export interface ConfiguracionDeMigue {
  clave: string | null
  modelo: string
  /** Sólo para los modelos que razonan. Vacío = no se manda. */
  esfuerzo: Esfuerzo | null
  topeMensualUsd: number | null
  /** Frases para la pantalla y para /api/salud. Vacío = se puede conversar. */
  problemas: string[]
}

/**
 * Lee el entorno cada vez. No se guarda en una variable del módulo: en Vercel
 * cambiar una variable obliga a volver a desplegar de todos modos, y en
 * desarrollo así no hace falta reiniciar para probar otro modelo.
 */
export function leerConfiguracion(): ConfiguracionDeMigue {
  const problemas: string[] = []

  const clave = process.env.OPENROUTER_API_KEY?.trim() || null
  if (!clave) {
    problemas.push('Falta la clave de OpenRouter (OPENROUTER_API_KEY).')
  } else if (!clave.startsWith('sk-or-')) {
    problemas.push('La clave de OPENROUTER_API_KEY no tiene la forma de una clave de OpenRouter (empieza con sk-or-).')
  }

  const modelo = process.env.ASISTENTE_MODELO?.trim() || MODELO_POR_DEFECTO
  if (!/^[a-z0-9-]+\/[a-z0-9.:-]+$/i.test(modelo)) {
    problemas.push(`ASISTENTE_MODELO dice «${modelo}», que no es un modelo de OpenRouter (se escriben como openai/gpt-4o-mini).`)
  }

  const esfuerzoBruto = process.env.ASISTENTE_ESFUERZO?.trim().toLowerCase() || ''
  let esfuerzo: Esfuerzo | null = null
  if (esfuerzoBruto) {
    if ((ESFUERZOS as string[]).includes(esfuerzoBruto)) esfuerzo = esfuerzoBruto as Esfuerzo
    else problemas.push(`ASISTENTE_ESFUERZO dice «${esfuerzoBruto}»: va vacío, o minimal, low, medium o high.`)
  }

  // Vacío NO es «sin tope». Al principio lo era, y para un organismo público
  // una variable olvidada en Vercel no puede querer decir gastar sin límite:
  // sin un tope que se pueda leer, Migue no contesta. Se acepta la coma
  // decimal, que es como lo escribe cualquiera acá.
  const topeBruto = process.env.ASISTENTE_TOPE_MENSUAL_USD?.trim() ?? ''
  const tope = Number(topeBruto.replace(',', '.'))
  let topeMensualUsd: number | null = null
  if (!topeBruto) {
    problemas.push('Falta el tope de gasto del mes (ASISTENTE_TOPE_MENSUAL_USD).')
  } else if (!Number.isFinite(tope) || tope <= 0) {
    problemas.push(`ASISTENTE_TOPE_MENSUAL_USD dice «${topeBruto}»: tiene que ser un número de dólares mayor que cero.`)
  } else {
    topeMensualUsd = tope
  }

  return { clave, modelo, esfuerzo, topeMensualUsd, problemas }
}

export function topeDiarioUsd(config: ConfiguracionDeMigue, rol: 'admin' | 'vigilador'): number | null {
  if (config.topeMensualUsd === null) return null
  return config.topeMensualUsd * (rol === 'admin' ? PARTE_DIARIA_DE_COORDINACION : PARTE_DIARIA_DE_UN_PUNTO)
}

// ── ¿Está la migración? ─────────────────────────────────────────────────
// Mismo patrón que tieneCorreo() en src/lib/acceso.ts: se pregunta al catálogo
// y se recuerda sólo el sí. Una tabla que existe no desaparece; el no dura
// hasta que alguien pegue la 0025 en Supabase, y ahí tiene que enterarse sin
// que haga falta volver a desplegar. pg_class lo puede leer cualquier rol.

let estaInstalado = false

export async function migueEstaInstalado(tx: Conexion): Promise<boolean> {
  if (estaInstalado) return true
  const filas = await tx.consultar<{ hay: boolean }>(
    `select exists (
       select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'migue_mensajes'
     ) as hay`,
  )
  estaInstalado = Boolean(filas[0]?.hay)
  return estaInstalado
}
