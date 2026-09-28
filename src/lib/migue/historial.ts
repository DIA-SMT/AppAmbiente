/**
 * Lo que las pantallas de Migue muestran de una conversación: la que está en
 * curso, lo que se dijo en ella y las anteriores.
 *
 * Sólo lee, y con la sesión de quien pide: RLS deja ver a cada dueño lo suyo y
 * nada más (0025, `migue_conversaciones_leer`). Lo que se le manda al modelo
 * —el sistema, las herramientas, el resultado de cada consulta— no sale de
 * acá: la pantalla dibuja la pregunta tal como se escribió y la respuesta ya
 * verificada, que son las dos únicas filas de cada turno con `texto_visible`.
 *
 * ── Por qué se filtra por dispositivo si RLS ya filtra ──────────────────
 *
 * En el celular, RLS deja leer TODAS las conversaciones del punto, de
 * cualquier teléfono: la política compara el sitio y nada más, porque la
 * cuenta es una sola y la comparten los que rotan. La conversación, en cambio,
 * es del punto Y del teléfono (encabezado de la 0025, punto 3), así que acá se
 * pide la de este dispositivo. No es una barrera: el uuid lo manda el
 * navegador, y cualquiera con la cuenta del punto podría pedir el de otro
 * teléfono. Es lo que evita que dos celulares del mismo punto vean el hilo del
 * otro mezclado con el suyo. Por eso el aviso de la pantalla dice lo que dice:
 * lo que se escribe lo ve cualquiera que use la cuenta del punto.
 *
 * ── Por qué las ventanas de tiempo están acá también ────────────────────
 *
 * Lo que vence lo vacía app.migue_vencer, pero esa función corre al principio
 * de cada pregunta, de a cincuenta, y una pantalla no escribe. Si la charla
 * del turno de anteayer quedó sin vaciar porque nadie volvió a preguntar
 * nada, igual no se muestra: se pide lo de las últimas 48 horas en el punto y
 * lo de los últimos 90 días en coordinación, con las cifras de
 * src/lib/reglas.ts. La ventana va por mensaje y no sólo por conversación: una
 * charla que nunca estuvo dos horas quieta puede arrancar hace más de dos
 * días. No es lo común, pero «lo ve cualquiera durante 48 horas» tiene que ser
 * cierto al pie de la letra, y cuesta una condición.
 */
import 'server-only'

import type { Conexion } from '@db/client'
import { conSesion, type Sesion } from '@db/sesion'
import {
  DIAS_DE_CONVERSACION_DE_COORDINACION,
  HORAS_DE_CONVERSACION_DEL_PUNTO,
  HORAS_PARA_CERRAR_QUIETA,
} from '@/lib/reglas'

import { migueEstaInstalado } from './configuracion'
import type { Enlace, EnlaceConAlcance, MensajeVisible } from './tipos'

// ── Lo que se devuelve ──────────────────────────────────────────────────

/** Los valores de `migue_conversaciones.cerrada_por`. */
export type MotivoDeCierre = 'nueva' | 'larga' | 'quieta' | 'maltrato' | 'olvido' | 'vencida' | 'error'

/**
 * Los cierres que la pantalla tiene que explicar al volver a abrirla.
 *
 * Los demás no piden explicación, piden empezar de cero: la persona tocó
 * «Empezar de nuevo», la charla quedó quieta hasta el turno siguiente, venció,
 * o la olvidó ella misma. Mostrarle al que entra a las dos de la tarde «esta
 * conversación se olvidó» sería contarle algo que hizo otro.
 */
export type CierreQueSeExplica = 'larga' | 'maltrato' | 'error'
const CIERRES_QUE_SE_EXPLICAN = new Set<string>(['larga', 'maltrato', 'error'])

export interface ConversacionAnterior {
  id: string
  /** La primera pregunta, recortada: es por lo que la persona la reconoce. */
  titulo: string
  creadaEn: string
  actualizadaEn: string
  turnos: number
  /**
   * Null si nunca se cerró. En el punto eso casi siempre es una charla quieta
   * que app.migue_vencer todavía no marcó: para la pantalla es lo mismo.
   */
  cerradaPor: MotivoDeCierre | null
  /**
   * Sólo en el celular, que las trae enteras: son las de hoy de un teléfono,
   * unas pocas, y abrir una no puede depender de que vuelva la señal. En el
   * panel son de 90 días y se abren de a una (conversacionGuardadaEnTx).
   */
  mensajes: MensajeVisible[] | null
}

/** Lo que devuelve GET /api/migue/conversacion, y lo que el panel le pasa armado al chat. */
export interface EstadoDeLaConversacion {
  /** La que está en pantalla: abierta, o recién cerrada por algo que se explica. */
  conversacionId: string | null
  cerrada: null | { motivo: CierreQueSeExplica }
  mensajes: MensajeVisible[]
  anteriores: ConversacionAnterior[]
}

/** Una conversación vieja, para leerla. */
export interface ConversacionGuardada {
  id: string
  creadaEn: string
  actualizadaEn: string
  turnos: number
  cerradaPor: MotivoDeCierre | null
  mensajes: MensajeVisible[]
}

// ── De quién es ─────────────────────────────────────────────────────────

/** Coordinación: la persona. Punto: el sitio y el teléfono (ver arriba). */
export type DuenoDeLaConversacion =
  | { rol: 'admin'; perfilId: string }
  | { rol: 'vigilador'; sitioId: string; dispositivoId: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function esUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID.test(valor)
}

/**
 * El dueño sale de la sesión; del navegador, sólo el teléfono. Null cuando no
 * se puede saber: un celular que no mandó su uuid, o una cuenta de punto sin
 * punto, que no debería existir y que acá no ve nada en vez de ver de más.
 */
export function duenoDeLaSesion(sesion: Sesion, dispositivoId: string | null): DuenoDeLaConversacion | null {
  if (sesion.rol === 'admin') return { rol: 'admin', perfilId: sesion.perfilId }
  if (!sesion.sitioId || !esUuid(dispositivoId)) return null
  return { rol: 'vigilador', sitioId: sesion.sitioId, dispositivoId }
}

/** Cuántas horas para atrás se muestra: 48 en el punto, 90 días en coordinación. */
function horasVisibles(dueno: DuenoDeLaConversacion): number {
  return dueno.rol === 'admin' ? DIAS_DE_CONVERSACION_DE_COORDINACION * 24 : HORAS_DE_CONVERSACION_DEL_PUNTO
}

interface Filtro {
  donde: string
  parametros: unknown[]
}

/**
 * Las conversaciones del dueño que todavía se pueden mostrar.
 *
 * El `perfil_id = $1` de coordinación repite lo que ya hace RLS, y está igual:
 * es la condición del índice migue_conversaciones_perfil_idx, y así la
 * consulta dice lo que pide sin que haya que ir a leer la política.
 */
function delDueno(dueno: DuenoDeLaConversacion): Filtro {
  if (dueno.rol === 'admin') {
    return {
      donde: `c.rol = 'admin' and c.perfil_id = $1
              and c.actualizada_en > now() - make_interval(hours => $2::int)`,
      parametros: [dueno.perfilId, horasVisibles(dueno)],
    }
  }
  return {
    donde: `c.rol = 'vigilador' and c.sitio_id = $1 and c.dispositivo_id = $2
            and c.actualizada_en > now() - make_interval(hours => $3::int)`,
    parametros: [dueno.sitioId, dueno.dispositivoId, horasVisibles(dueno)],
  }
}

// ── Los mensajes ────────────────────────────────────────────────────────

const RESPALDOS = new Set<string>(['numero', 'filas', 'regla'])

/** Una dirección de adentro de la app. `//otro.sitio` y `/\otro.sitio` los navegadores los leen como de afuera. */
const DE_ADENTRO = /^\/(?![/\\])/

/**
 * Los botones de una respuesta, leídos con desconfianza.
 *
 * Los arma el servidor, no el modelo, así que un enlace roto sería un error
 * nuestro y no un ataque. Pero un JSON mal guardado no puede romper la
 * pantalla entera durante 48 horas, y un botón que saca de la app no tiene que
 * dibujarse aunque algún día una herramienta arme mal una dirección con un
 * texto que cargó alguien: se descarta ese enlace y la respuesta sigue.
 */
function leerEnlaces(texto: string | null): EnlaceConAlcance[] {
  if (!texto) return []
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    return []
  }
  if (!Array.isArray(crudo)) return []

  return crudo.flatMap((valor): EnlaceConAlcance[] => {
    if (typeof valor !== 'object' || valor === null) return []
    const { rotulo, href, respalda, alcance } = valor as Record<string, unknown>
    if (typeof rotulo !== 'string' || typeof href !== 'string' || typeof alcance !== 'string') return []
    if (typeof respalda !== 'string' || !RESPALDOS.has(respalda)) return []
    if (!DE_ADENTRO.test(href)) return []
    return [{ rotulo, href, alcance, respalda: respalda as Enlace['respalda'] }]
  })
}

/** Los dos drivers devuelven un Date para timestamptz; por las dudas, también se acepta el texto. */
function instante(valor: Date | string): string {
  return (valor instanceof Date ? valor : new Date(valor)).toISOString()
}

interface FilaDeMensaje {
  conversacion_id: string
  pregunta_id: string
  tipo: 'pregunta' | 'respuesta'
  texto_visible: string
  enlaces: string | null
  creado_en: Date | string
}

/**
 * Lo que se dibuja de varias conversaciones, en una sola consulta.
 *
 * Una conversación vaciada tiene `texto_visible` en null en todas sus filas,
 * así que de ésas no vuelve nada y no hace falta preguntar si lo está.
 */
async function mensajesVisiblesEnTx(
  tx: Conexion,
  dueno: DuenoDeLaConversacion,
  ids: string[],
): Promise<Map<string, MensajeVisible[]>> {
  const porConversacion = new Map<string, MensajeVisible[]>()
  if (ids.length === 0) return porConversacion

  const filas = await tx.consultar<FilaDeMensaje>(
    `select conversacion_id, pregunta_id, tipo, texto_visible, enlaces, creado_en
       from migue_mensajes
      where conversacion_id = any($1::uuid[])
        and tipo in ('pregunta', 'respuesta')
        and texto_visible is not null
        and creado_en > now() - make_interval(hours => $2::int)
      order by conversacion_id, orden`,
    [ids, horasVisibles(dueno)],
  )

  for (const f of filas) {
    const lista = porConversacion.get(f.conversacion_id) ?? []
    lista.push({
      preguntaId: f.pregunta_id,
      quien: f.tipo === 'pregunta' ? 'persona' : 'migue',
      texto: f.texto_visible,
      enlaces: f.tipo === 'respuesta' ? leerEnlaces(f.enlaces) : [],
      creadoEn: instante(f.creado_en),
    })
    porConversacion.set(f.conversacion_id, lista)
  }
  return porConversacion
}

// ── La conversación de ahora y las anteriores ───────────────────────────

/** Cuántas anteriores se listan. En el punto son las de hoy de un teléfono: más de diez no pasa. */
const ANTERIORES_DEL_PANEL = 30
const ANTERIORES_DEL_PUNTO = 10

/** Largo del título de una anterior: lo que entra en un renglón de la columna. */
const LARGO_DEL_TITULO = 90

function titular(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  return limpio.length > LARGO_DEL_TITULO ? `${limpio.slice(0, LARGO_DEL_TITULO - 1).trimEnd()}…` : limpio
}

interface FilaDeLaUltima {
  id: string
  cerrada_por: MotivoDeCierre | null
  recien_cerrada: boolean
  quieta: boolean
}

interface FilaDeAnterior {
  id: string
  creada_en: Date | string
  actualizada_en: Date | string
  turnos: number
  cerrada_por: MotivoDeCierre | null
  titulo: string | null
}

/**
 * Qué conversación va en pantalla, sacado de la más nueva del dueño.
 *
 * Abierta, es la que sigue. Recién cerrada por algo que se explica —se hizo
 * demasiado larga, se cortó por maltrato, hubo un error—, se muestra con el
 * cierre para que la persona entienda por qué no puede seguir escribiendo ahí.
 * Cualquier otra cosa es empezar de cero.
 *
 * «Recién» y «quieta» son la misma cifra, las dos horas de
 * HORAS_PARA_CERRAR_QUIETA: pasado ese rato, en el punto ya es otro turno y el
 * que entra no tiene por qué heredar el cierre del anterior. En el panel se
 * usa igual para no inventar una segunda regla.
 */
function queVaEnPantalla(ultima: FilaDeLaUltima | undefined): Pick<EstadoDeLaConversacion, 'conversacionId' | 'cerrada'> {
  if (!ultima) return { conversacionId: null, cerrada: null }
  if (ultima.cerrada_por === null) {
    return ultima.quieta ? { conversacionId: null, cerrada: null } : { conversacionId: ultima.id, cerrada: null }
  }
  if (ultima.recien_cerrada && CIERRES_QUE_SE_EXPLICAN.has(ultima.cerrada_por)) {
    return { conversacionId: ultima.id, cerrada: { motivo: ultima.cerrada_por as CierreQueSeExplica } }
  }
  return { conversacionId: null, cerrada: null }
}

export async function estadoDeLaConversacionEnTx(
  tx: Conexion,
  dueno: DuenoDeLaConversacion,
): Promise<EstadoDeLaConversacion> {
  const filtro = delDueno(dueno)
  const siguiente = filtro.parametros.length + 1
  const esPunto = dueno.rol === 'vigilador'

  // Las dos consultas no dependen una de la otra: las anteriores se piden con
  // una de más y la que va en pantalla se saca después, en JS. Sobre el mismo
  // `tx` viajan encauzadas, como en las pantallas del celular.
  const [[ultima], anterioresCrudas] = await Promise.all([
    tx.consultar<FilaDeLaUltima>(
      `select c.id, c.cerrada_por,
              coalesce(c.cerrada_en > now() - make_interval(hours => $${siguiente}::int), false)
                as recien_cerrada,
              (c.rol = 'vigilador' and c.cerrada_en is null and c.pregunta_en_curso is null
                and c.actualizada_en < now() - make_interval(hours => $${siguiente}::int))
                as quieta
         from migue_conversaciones c
        where ${filtro.donde}
        order by c.creada_en desc
        limit 1`,
      [...filtro.parametros, HORAS_PARA_CERRAR_QUIETA],
    ),
    // En el punto, las de hoy y nada más: es lo que un turno puede querer
    // volver a mirar. El corte del día es el mismo de /hoy, en hora de Tucumán
    // escrita a mano y no con la zona de la sesión.
    tx.consultar<FilaDeAnterior>(
      `select c.id, c.creada_en, c.actualizada_en, c.turnos, c.cerrada_por,
              (select m.texto_visible from migue_mensajes m
                where m.conversacion_id = c.id and m.tipo = 'pregunta' and m.texto_visible is not null
                  and m.creado_en > now() - make_interval(hours => $${siguiente}::int)
                order by m.orden limit 1) as titulo
         from migue_conversaciones c
        where ${filtro.donde}
          and c.vaciada_en is null
          and c.turnos > 0
          ${esPunto
            ? `and c.actualizada_en >= date_trunc('day', now() at time zone 'America/Argentina/Tucuman')
                                       at time zone 'America/Argentina/Tucuman'`
            : ''}
        order by c.actualizada_en desc
        limit $${siguiente + 1}::int`,
      [...filtro.parametros, horasVisibles(dueno), (esPunto ? ANTERIORES_DEL_PUNTO : ANTERIORES_DEL_PANEL) + 1],
    ),
  ])

  const enPantalla = queVaEnPantalla(ultima)
  const anteriores = anterioresCrudas
    .filter((a): a is FilaDeAnterior & { titulo: string } => a.id !== enPantalla.conversacionId && a.titulo !== null)
    .slice(0, esPunto ? ANTERIORES_DEL_PUNTO : ANTERIORES_DEL_PANEL)

  const ids = [
    ...(enPantalla.conversacionId ? [enPantalla.conversacionId] : []),
    ...(esPunto ? anteriores.map((a) => a.id) : []),
  ]
  const mensajes = await mensajesVisiblesEnTx(tx, dueno, ids)

  return {
    ...enPantalla,
    mensajes: enPantalla.conversacionId ? mensajes.get(enPantalla.conversacionId) ?? [] : [],
    anteriores: anteriores.map((a) => ({
      id: a.id,
      titulo: titular(a.titulo),
      creadaEn: instante(a.creada_en),
      actualizadaEn: instante(a.actualizada_en),
      turnos: a.turnos,
      cerradaPor: a.cerrada_por,
      mensajes: esPunto ? mensajes.get(a.id) ?? [] : null,
    })),
  }
}

/**
 * Lo mismo con su propia transacción, para la ruta del celular. Null si la
 * 0025 todavía no está en la base: el build puede llegar antes que el SQL.
 */
export async function estadoDeLaConversacion(
  sesion: Sesion,
  dueno: DuenoDeLaConversacion,
): Promise<EstadoDeLaConversacion | null> {
  return conSesion(sesion, async (tx) => {
    if (!(await migueEstaInstalado(tx))) return null
    return estadoDeLaConversacionEnTx(tx, dueno)
  })
}

// ── Una conversación vieja ──────────────────────────────────────────────

/**
 * Una anterior entera, para leerla en el panel. Null si no es del dueño, si
 * se olvidó o si ya venció: para la pantalla son lo mismo, y el uuid de una
 * ajena no tiene que servir para averiguar que existe.
 */
export async function conversacionGuardadaEnTx(
  tx: Conexion,
  dueno: DuenoDeLaConversacion,
  id: string,
): Promise<ConversacionGuardada | null> {
  if (!esUuid(id)) return null

  const filtro = delDueno(dueno)
  const [fila] = await tx.consultar<Omit<FilaDeAnterior, 'titulo'>>(
    `select c.id, c.creada_en, c.actualizada_en, c.turnos, c.cerrada_por
       from migue_conversaciones c
      where ${filtro.donde}
        and c.id = $${filtro.parametros.length + 1}::uuid
        and c.vaciada_en is null`,
    [...filtro.parametros, id],
  )
  if (!fila) return null

  const mensajes = await mensajesVisiblesEnTx(tx, dueno, [fila.id])
  return {
    id: fila.id,
    creadaEn: instante(fila.creada_en),
    actualizadaEn: instante(fila.actualizada_en),
    turnos: fila.turnos,
    cerradaPor: fila.cerrada_por,
    mensajes: mensajes.get(fila.id) ?? [],
  }
}
