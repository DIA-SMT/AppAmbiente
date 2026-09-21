/**
 * El freno entre un comando y la base de la Secretaría.
 *
 * POR QUÉ EXISTE. `.env.local` puede tener una DATABASE_URL puesta de antes, y
 * casi todos estos comandos son inofensivos contra la base local y no lo son
 * contra la de verdad. El 18/09/2026 `npm run db:verificar` corrió así y dejó
 * cuatro perfiles de prueba, un movimiento y una entidad adentro de la base en
 * uso; el total de movimientos pasó a decir 514 donde había 513, y en este
 * sistema nada se borra, así que hubo que ir a sacarlos a mano.
 *
 * La otra solución era acordarse de comentar esa línea. Acordarse no es una
 * solución: el día que no te acordás es justo el día que estás apurado.
 *
 * QUÉ HACE Y QUÉ NO. Contra PGlite no dice nada: ahí no hay nada que cuidar.
 * Contra cualquier Postgres muestra a qué base le va a escribir —con el host a
 * la vista, que es lo que hace obvio el error— y pide una variable escrita a
 * propósito. No es seguridad: es el pulgar que frena la mano. Quien la escribe
 * ya sabe lo que está haciendo, y ése es todo el punto.
 *
 * Cada comando trae su propia variable para que el mensaje se pueda copiar tal
 * cual, sin tener que recordar ninguna.
 */
import { describirMotor } from '../client'

/** Los comandos que sólo leen no llaman a esto. */
export interface Aviso {
  /** La variable que destraba, en mayúsculas. Ej.: 'CONFIRMO_VERIFICAR'. */
  variable: string
  /** Qué le haría a esa base, en una línea y sin vueltas. */
  que: string
  /** Cómo se llama el comando, para que el mensaje se pueda copiar. */
  comando: string
}

/**
 * Corta el proceso si hay una base remota configurada y nadie lo confirmó.
 * Se llama ANTES de abrir la conexión: si va a frenar, que frene sin tocar nada.
 */
export function exigirConfirmacionSiEsRemota({ variable, que, comando }: Aviso): void {
  if (!process.env.DATABASE_URL?.trim()) return
  if (process.env[variable] === 'si') return

  console.error(`
  ⚠ Esto no es la base local.

    ${describirMotor()}

  ${que}

  Si es lo que querés:

    ${variable}=si ${comando}

  Si no era la idea, esa base sale de DATABASE_URL en .env.local. Para trabajar
  contra la local, pasala vacía en la misma línea:

    DATABASE_URL= ${comando}
`)
  process.exit(1)
}
