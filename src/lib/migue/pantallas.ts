/**
 * Lo que se ve de Migue fuera de la conversación: lo que recuerda, el
 * vocabulario que va aprendiendo, lo que gasta y cuántas veces se cortó una
 * charla en cada punto.
 *
 * Todo con la sesión de quien mira, por conSesion, así que RLS filtra igual
 * que en cualquier otra pantalla. Y además, a mano, lo que las políticas dejan
 * ver de más a propósito: la coordinación puede LEER el vocabulario aprobado
 * y los recuerdos de los puntos, y eso no quiere decir que cada consulta de
 * acá tenga que traerlos.
 *
 * Nada de este archivo nombra migue_conversaciones ni migue_mensajes. La
 * coordinación no lee las charlas de nadie —ni las de los puntos ni las de la
 * otra coordinadora—, y la forma más segura de que ninguna de estas pantallas
 * se las muestre es que ninguna consulta de acá las toque. Lo único que pasa
 * por ellas es app.migue_vencer(), que vacía lo vencido y no devuelve texto.
 *
 * Estas pantallas se muestran con Migue apagado —sin clave, sin tope, con el
 * tope del mes alcanzado—: lo que recuerda se tiene que poder ver y olvidar
 * también el día que no contesta. Lo único que piden es la migración 0025, y
 * sin ella cada función devuelve null en vez de nombrar tablas que no existen.
 */
import 'server-only'

import type { Conexion } from '@db/client'
import { conSesion, type Sesion } from '@db/sesion'
import { fecha, mesLargo } from '@/lib/formato'

import { leerConfiguracion, migueEstaInstalado, topeDiarioUsd, type ConfiguracionDeMigue } from './configuracion'

// ── Lo que se muestra ───────────────────────────────────────────────────

export interface Recuerdo {
  id: string
  texto: string
  /**
   * Sólo el día, nunca la hora. En un punto hay un vigilador por turno, y la
   * hora exacta en que se le pidió a Migue que recordara algo ya dice quién
   * fue: es lo mismo que migue_eventos evita guardando semanas.
   */
  desde: string
}

export interface RecuerdosDeUnPunto {
  codigo: string
  nombre: string
  recuerdos: Recuerdo[]
}

export type EstadoDeExpresion = 'propuesta' | 'aprobada' | 'descartada'

export interface Expresion {
  id: string
  expresion: string
  /** Lo que Migue cree que significa, con sus palabras. */
  significado: string
  /** «el punto PV-05 · Punto Verde Garcilazo», «el material Cartón», «otra cosa». */
  seRefiereA: string
  /**
   * false cuando lo que nombra no está en la lista de hoy: un material dado de
   * baja, un código de punto que el modelo entendió mal. Así la aprobaran, no
   * entraría en ninguna conversación, porque leerCatalogo() la deja afuera.
   */
  llegaAMigue: boolean
  veces: number
  /** «en PV-05 · Punto Verde Garcilazo» o «en coordinación»: dónde se la escuchó la primera vez. */
  dondeSeEscucho: string
  primeraVez: string
  ultimaVez: string
}

export interface GastoDeUnDueno {
  /** «Coordinación», o el nombre del punto. */
  rotulo: string
  codigo: string | null
  gastadoUsd: number
  preguntas: number
  /** null sin preguntas: un promedio de cero preguntas no es cero. */
  promedioUsd: number | null
}

export interface GastoDelMes {
  /** «Septiembre de 2026». */
  mes: string
  gastadoUsd: number
  topeUsd: number | null
  /** Lo gastado sobre el tope, en por ciento. Pasa de 100 si una pregunta cruzó el tope a mitad de camino. */
  porcentaje: number | null
  preguntas: number
  promedioUsd: number | null
  topeDiarioDeUnPuntoUsd: number | null
  topeDiarioDeCoordinacionUsd: number | null
  coordinacion: GastoDeUnDueno
  /** Sólo los puntos que preguntaron algo este mes, en el orden de siempre. */
  puntos: GastoDeUnDueno[]
}

export interface SemanaDeEventos {
  /** El lunes, aaaa-mm-dd. */
  lunes: string
  /** «14/09». */
  rotulo: string
  /** Es la de ahora: todavía puede crecer. */
  enCurso: boolean
}

export interface EventosDeUnPunto {
  /** null es coordinación. */
  codigo: string | null
  nombre: string
  /** Una cifra por semana, en el orden de `semanas`. */
  cortes: number[]
  sinRespaldo: number[]
}

export interface EventosRecientes {
  semanas: SemanaDeEventos[]
  /** Sólo quien tuvo algo en esas cuatro semanas. */
  filas: EventosDeUnPunto[]
}

export type EstadoDeMigue =
  | { estado: 'encendido' }
  | { estado: 'apagado'; motivos: string[] }
  | { estado: 'tope' }

export interface PantallaDeCoordinacion {
  estado: EstadoDeMigue
  propios: Recuerdo[]
  puntos: RecuerdosDeUnPunto[]
  propuestas: Expresion[]
  aprobadas: Expresion[]
  gasto: GastoDelMes
  eventos: EventosRecientes
}

export interface PantallaDelPunto {
  punto: { codigo: string; nombre: string }
  recuerdos: Recuerdo[]
}

// ── Si Migue contesta ───────────────────────────────────────────────────

/**
 * Encendido, apagado con su motivo, o en el tope del mes.
 *
 * Lo usan esta pantalla y /api/salud, para que las dos digan lo mismo. La
 * migración no entra acá: quien pregunta ya la miró antes, porque sin ella no
 * hay gasto que leer.
 */
export function estadoDeMigue(config: ConfiguracionDeMigue, gastadoUsd: number): EstadoDeMigue {
  if (config.problemas.length) return { estado: 'apagado', motivos: config.problemas }
  if (config.topeMensualUsd !== null && gastadoUsd >= config.topeMensualUsd) return { estado: 'tope' }
  return { estado: 'encendido' }
}

// ── Si hay que mostrarlo ────────────────────────────────────────────────

let seSabeInstalado = false

/**
 * Si la entrada «Migue» va en la barra del panel.
 *
 * migueEstaInstalado ya recuerda el sí, pero para preguntárselo hace falta
 * una transacción abierta, y el layout del panel no tiene ninguna a mano: abrir
 * una sólo para enterarse de algo que ya se sabe son cuatro viajes a la base
 * en cada pantalla que se carga entera. Acá se recuerda el sí antes de abrirla.
 *
 * Si la base no contesta, no se muestra: la barra no es el lugar donde
 * enterarse de que la base está caída, y sin base Migue tampoco anda.
 */
export async function migueSeMuestra(sesion: Sesion): Promise<boolean> {
  if (seSabeInstalado) return true
  seSabeInstalado = await conSesion(sesion, (tx) => migueEstaInstalado(tx)).catch(() => false)
  return seSabeInstalado
}

// ── Coordinación ────────────────────────────────────────────────────────

interface FilaRecuerdo {
  id: string
  texto: string
  creado_en: Date | string
  sitio_id: string | null
  codigo: string | null
  nombre: string | null
}

interface FilaExpresion {
  id: string
  expresion: string
  significado: string
  tipo: 'punto' | 'material' | 'recipiente' | 'otro'
  referencia: string
  estado: EstadoDeExpresion
  veces: number
  rol: 'admin' | 'vigilador'
  creada_en: Date | string
  ultima_vez_en: Date | string
  punto_referido: string | null
  material_referido: string | null
  recipiente_referido: string | null
  punto_codigo: string | null
  punto_nombre: string | null
}

interface FilaGasto {
  rol: 'admin' | 'vigilador'
  codigo: string | null
  nombre: string | null
  gastado: string
  preguntas: number
}

interface FilaEvento {
  semana: string
  tipo: 'maltrato' | 'numero_sin_respaldo'
  codigo: string | null
  nombre: string | null
  orden: number | null
  cuantos: number
}

/**
 * El principio del mes y de la semana en Tucumán, escritos a mano. Es lo mismo
 * que hacen app.migue_gasto_del_mes() y app.migue_cortar_por_maltrato(): el
 * corte no puede depender de la zona que traiga la sesión, o el gasto del mes
 * daría distinto según quién lo mire.
 */
const PRINCIPIO_DEL_MES = `(date_trunc('month', now() at time zone 'America/Argentina/Tucuman')
                            at time zone 'America/Argentina/Tucuman')`
const ESTE_LUNES = `date_trunc('week', now() at time zone 'America/Argentina/Tucuman')::date`

/** Cuántas semanas de cortes se muestran, contando la de ahora. */
const SEMANAS_DE_EVENTOS = 4

/**
 * Todo «Lo que Migue recuerda» de la coordinación, en una sola transacción.
 *
 * Null si la base todavía no tiene la 0025.
 */
export async function pantallaDeCoordinacion(sesion: Sesion): Promise<PantallaDeCoordinacion | null> {
  return conSesion(sesion, (tx) => pantallaDeCoordinacionEnTx(tx, sesion))
}

export async function pantallaDeCoordinacionEnTx(
  tx: Conexion,
  sesion: Sesion,
): Promise<PantallaDeCoordinacion | null> {
  // Las políticas ya dejarían a un vigilador sin gasto ni eventos, pero la
  // pantalla entera es de coordinación, y que eso esté escrito acá también
  // evita que alguien la reuse desde el celular creyendo que filtra sola.
  if (sesion.rol !== 'admin') throw new Error('Esta pantalla es de la coordinación.')
  if (!(await migueEstaInstalado(tx))) return null

  const config = leerConfiguracion()

  // Primero lo que vence. En este sistema no hay tareas programadas: las
  // charlas vencidas se vacían cuando alguien le pregunta algo a Migue o abre
  // esta pantalla. La semana que nadie pregunta nada —Migue apagado, en el
  // tope—, ésta es la puerta que sigue vaciando lo que ya pasó su plazo. Va
  // en el mismo viaje que las lecturas; la base las corre en orden.
  const [, recuerdos, expresiones, [total], gastos, [semana], eventos] = await Promise.all([
    tx.consultar('select app.migue_vencer()'),
    // Los suyos y los de cada punto. Los de la otra coordinadora ya los tapa
    // RLS; el `perfil_id = $1` lo dice también acá, por si algún día la
    // política se afloja para otra cosa.
    tx.consultar<FilaRecuerdo>(
      `select r.id, r.texto, r.creado_en, r.sitio_id, s.codigo, s.nombre
         from migue_recuerdos r
         left join sitios s on s.id = r.sitio_id
        where r.olvidado_en is null
          and (r.perfil_id = $1 or r.sitio_id is not null)
        order by s.orden nulls first, r.creado_en`,
      [sesion.perfilId],
    ),
    tx.consultar<FilaExpresion>(
      `select e.id, e.expresion, e.significado, e.tipo, e.referencia, e.estado, e.veces, e.rol,
              e.creada_en, e.ultima_vez_en,
              -- Lo que nombra, buscado como lo busca leerCatalogo() al abrir
              -- cada conversación: si acá no aparece, allá tampoco, y la
              -- expresión no le llega a Migue aunque esté aprobada.
              (select nombre from sitios
                where e.tipo = 'punto' and activo and codigo = e.referencia limit 1) as punto_referido,
              (select nombre from materiales
                where e.tipo = 'material' and activo and lower(nombre) = lower(e.referencia)
                limit 1) as material_referido,
              (select nombre from unidades
                where e.tipo = 'recipiente' and activo and (codigo = e.referencia or nombre = e.referencia)
                limit 1) as recipiente_referido,
              s.codigo as punto_codigo, s.nombre as punto_nombre
         from migue_expresiones e
         left join sitios s on s.id = e.sitio_id
        where e.estado in ('propuesta', 'aprobada')
        order by e.veces desc, e.ultima_vez_en desc`,
    ),
    // El total contra el tope es el de la función, no una suma de acá: es el
    // mismo número que mira Migue antes de cada pregunta para saber si puede
    // contestar, y la pantalla no puede decir «te queda» cuando él ya cortó.
    tx.consultar<{ gastado: string }>('select app.migue_gasto_del_mes()::text as gastado'),
    // Una pregunta es un pregunta_id distinto: cada llamada al proveedor deja
    // su fila, y una pregunta suele hacer dos o tres. Un pregunta_id es de un
    // solo dueño —lo genera el celular o el navegador para esa pregunta—, así
    // que sumar las preguntas de cada fila da las del mes sin contar ninguna
    // dos veces.
    tx.consultar<FilaGasto>(
      `select g.rol, s.codigo, s.nombre,
              sum(g.costo_usd)::text as gastado,
              count(distinct g.pregunta_id)::int as preguntas
         from migue_gasto g
         left join sitios s on s.id = g.sitio_id
        where g.creado_en >= ${PRINCIPIO_DEL_MES}
        group by g.rol, g.sitio_id, s.codigo, s.nombre, s.orden
        order by s.orden nulls first`,
    ),
    tx.consultar<{ lunes: string }>(`select to_char(${ESTE_LUNES}, 'YYYY-MM-DD') as lunes`),
    tx.consultar<FilaEvento>(
      `select to_char(e.semana, 'YYYY-MM-DD') as semana, e.tipo, s.codigo, s.nombre, s.orden,
              count(*)::int as cuantos
         from migue_eventos e
         left join sitios s on s.id = e.sitio_id
        where e.semana >= ${ESTE_LUNES} - ${(SEMANAS_DE_EVENTOS - 1) * 7}
        group by e.semana, e.tipo, e.sitio_id, s.codigo, s.nombre, s.orden`,
    ),
  ])

  const gastadoUsd = Number(total?.gastado ?? 0)

  return {
    estado: estadoDeMigue(config, gastadoUsd),
    propios: recuerdos.filter((r) => r.sitio_id === null).map(comoRecuerdo),
    puntos: agruparPorPunto(recuerdos.filter((r) => r.sitio_id !== null)),
    propuestas: expresiones.filter((e) => e.estado === 'propuesta').map(comoExpresion),
    aprobadas: expresiones.filter((e) => e.estado === 'aprobada').map(comoExpresion),
    gasto: armarGasto(config, gastadoUsd, gastos),
    eventos: armarEventos(semana?.lunes ?? '', eventos),
  }
}

function comoRecuerdo(r: FilaRecuerdo): Recuerdo {
  return { id: r.id, texto: r.texto, desde: fecha(r.creado_en) }
}

/** Ya vienen en el orden de los puntos: alcanza con cortar cuando cambia. */
function agruparPorPunto(filas: FilaRecuerdo[]): RecuerdosDeUnPunto[] {
  const grupos: RecuerdosDeUnPunto[] = []
  for (const r of filas) {
    let grupo = grupos[grupos.length - 1]
    // El left join siempre encuentra el punto: sitios no se borra (la clave
    // foránea es restrict). El ?? es para TypeScript, no para un caso real.
    if (!grupo || grupo.codigo !== r.codigo) {
      grupo = { codigo: r.codigo ?? '', nombre: r.nombre ?? '', recuerdos: [] }
      grupos.push(grupo)
    }
    grupo.recuerdos.push(comoRecuerdo(r))
  }
  return grupos
}

/**
 * «A qué se refiere», con el nombre de hoy. La referencia se guarda como
 * código o como nombre —es lo que el modelo tiene en su catálogo—, y un código
 * suelto no le dice nada a quien tiene que decidir si la aprueba.
 */
function seRefiereA(e: FilaExpresion): string {
  switch (e.tipo) {
    case 'punto':
      return e.punto_referido ? `el punto ${e.referencia} · ${e.punto_referido}` : `el punto «${e.referencia}»`
    case 'material':
      return `el material ${e.material_referido ?? `«${e.referencia}»`}`
    case 'recipiente':
      return `el recipiente ${e.recipiente_referido ?? `«${e.referencia}»`}`
    default:
      return 'otra cosa: no nombra un punto, un material ni un recipiente'
  }
}

function referenciaExiste(e: FilaExpresion): boolean {
  switch (e.tipo) {
    case 'punto': return e.punto_referido !== null
    case 'material': return e.material_referido !== null
    case 'recipiente': return e.recipiente_referido !== null
    default: return true
  }
}

function comoExpresion(e: FilaExpresion): Expresion {
  return {
    id: e.id,
    expresion: e.expresion,
    significado: e.significado,
    seRefiereA: seRefiereA(e),
    llegaAMigue: referenciaExiste(e),
    veces: Number(e.veces),
    dondeSeEscucho: e.rol === 'admin' ? 'en coordinación' : `en ${e.punto_codigo} · ${e.punto_nombre}`,
    primeraVez: fecha(e.creada_en),
    ultimaVez: fecha(e.ultima_vez_en),
  }
}

function dueno(rotulo: string, codigo: string | null, gastadoUsd: number, preguntas: number): GastoDeUnDueno {
  return { rotulo, codigo, gastadoUsd, preguntas, promedioUsd: preguntas ? gastadoUsd / preguntas : null }
}

function armarGasto(config: ConfiguracionDeMigue, gastadoUsd: number, filas: FilaGasto[]): GastoDelMes {
  let coordinacion = dueno('Coordinación', null, 0, 0)
  const puntos: GastoDeUnDueno[] = []
  for (const f of filas) {
    if (f.rol === 'admin') coordinacion = dueno('Coordinación', null, Number(f.gastado), Number(f.preguntas))
    else puntos.push(dueno(f.nombre ?? '', f.codigo, Number(f.gastado), Number(f.preguntas)))
  }

  const preguntas = coordinacion.preguntas + puntos.reduce((suma, p) => suma + p.preguntas, 0)
  const tope = config.topeMensualUsd

  return {
    mes: mesLargo(new Date()),
    gastadoUsd,
    topeUsd: tope,
    porcentaje: tope ? (gastadoUsd / tope) * 100 : null,
    preguntas,
    // Sobre el total de la función, que cuenta también una llamada que
    // hubiera quedado sin pregunta. Hoy no hay ninguna —el chat siempre manda
    // la suya—, y si algún día la hubiera, el promedio sale un poco más alto,
    // que para un tope público es el lado seguro de equivocarse.
    promedioUsd: preguntas ? gastadoUsd / preguntas : null,
    topeDiarioDeUnPuntoUsd: topeDiarioUsd(config, 'vigilador'),
    topeDiarioDeCoordinacionUsd: topeDiarioUsd(config, 'admin'),
    coordinacion,
    puntos,
  }
}

/** aaaa-mm-dd más o menos días, en UTC, que no tiene horario de verano. */
function sumarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function armarEventos(esteLunes: string, filas: FilaEvento[]): EventosRecientes {
  if (!esteLunes) return { semanas: [], filas: [] }

  const semanas: SemanaDeEventos[] = []
  for (let i = SEMANAS_DE_EVENTOS - 1; i >= 0; i--) {
    const lunes = sumarDias(esteLunes, -7 * i)
    semanas.push({ lunes, rotulo: `${lunes.slice(8, 10)}/${lunes.slice(5, 7)}`, enCurso: i === 0 })
  }
  const columna = new Map(semanas.map((s, i) => [s.lunes, i]))

  const porDueno = new Map<string, EventosDeUnPunto>()
  const orden = new Map<string, number>()
  for (const f of filas) {
    const i = columna.get(f.semana)
    if (i === undefined) continue
    const clave = f.codigo ?? ''
    let fila = porDueno.get(clave)
    if (!fila) {
      fila = {
        codigo: f.codigo,
        nombre: f.codigo ? f.nombre ?? f.codigo : 'Coordinación',
        cortes: semanas.map(() => 0),
        sinRespaldo: semanas.map(() => 0),
      }
      porDueno.set(clave, fila)
      // La coordinación va al final: lo que se lee acá son los puntos.
      orden.set(clave, f.orden ?? Number.MAX_SAFE_INTEGER)
    }
    if (f.tipo === 'maltrato') fila.cortes[i] += Number(f.cuantos)
    else fila.sinRespaldo[i] += Number(f.cuantos)
  }

  return {
    semanas,
    filas: [...porDueno.entries()]
      .sort(([a], [b]) => (orden.get(a) ?? 0) - (orden.get(b) ?? 0))
      .map(([, fila]) => fila),
  }
}

// ── El punto ────────────────────────────────────────────────────────────

/**
 * «Lo que Migue recuerda de este punto». Null si la base no tiene la 0025 o
 * si la sesión no tiene punto.
 */
export async function pantallaDelPunto(sesion: Sesion): Promise<PantallaDelPunto | null> {
  return conSesion(sesion, (tx) => pantallaDelPuntoEnTx(tx, sesion))
}

export async function pantallaDelPuntoEnTx(tx: Conexion, sesion: Sesion): Promise<PantallaDelPunto | null> {
  if (sesion.rol !== 'vigilador' || !sesion.sitioId) return null
  if (!(await migueEstaInstalado(tx))) return null

  // Lo mismo que en coordinación: sin tareas programadas, vencer es cosa de
  // cada pregunta y de cada vez que alguien abre esto. Del punto importa más,
  // porque dura 48 horas y el turno que entra no tiene por qué heredar la
  // charla del anterior.
  const [, [punto], recuerdos] = await Promise.all([
    tx.consultar('select app.migue_vencer()'),
    tx.consultar<{ codigo: string; nombre: string }>(
      'select codigo, nombre from sitios where id = $1',
      [sesion.sitioId],
    ),
    tx.consultar<FilaRecuerdo>(
      `select r.id, r.texto, r.creado_en, r.sitio_id, null::text as codigo, null::text as nombre
         from migue_recuerdos r
        where r.olvidado_en is null and r.sitio_id = $1
        order by r.creado_en`,
      [sesion.sitioId],
    ),
  ])

  if (!punto) return null
  return { punto, recuerdos: recuerdos.map(comoRecuerdo) }
}

// ── Lo que se cambia desde acá ──────────────────────────────────────────

/**
 * Los errores de las funciones de la 0025 ya vienen escritos para una
 * persona —«Ese recuerdo ya no está. Actualizá la pantalla.»—, así que esos se
 * muestran tal cual. Todo lo demás es un problema nuestro y no de lo que tocó.
 */
function mensajeDeMigue(e: unknown, sesion: Sesion): string {
  const texto = e instanceof Error ? e.message : String(e)
  const propios = ['ya no está', 'Se cerró la sesión', 'Solo la coordinación']
  if (propios.some((p) => texto.includes(p))) return texto
  if (texto.includes('permission denied')) return 'No tenés permiso para hacer eso.'
  return sesion.rol === 'admin'
    ? 'No se pudo. Probá de nuevo; si sigue fallando, avisale a la Dirección de IA.'
    : 'No se pudo. Probá de nuevo; si sigue fallando, avisale a la coordinadora.'
}

/**
 * Olvidar un recuerdo. La base lo vacía y cierra, vaciándola, cada
 * conversación que lo tuvo presente: si no, el recuerdo «olvidado» seguiría
 * viajando al proveedor en cada turno de esas charlas. Por eso la pantalla lo
 * avisa antes del botón.
 */
export async function olvidarRecuerdo(
  sesion: Sesion,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await conSesion(sesion, (tx) => tx.consultar('select app.migue_olvidar_recuerdo($1::uuid)', [id]))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: mensajeDeMigue(e, sesion) }
  }
}

/**
 * Aprobar, descartar o devolver a revisión una expresión. Las aprobadas entran
 * en las conversaciones que se abran de acá en adelante; las que ya están
 * abiertas siguen con el vocabulario con que empezaron.
 */
export async function revisarExpresion(
  sesion: Sesion,
  id: string,
  estado: EstadoDeExpresion,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await conSesion(sesion, (tx) =>
      tx.consultar('select app.migue_revisar_expresion($1::uuid, $2)', [id, estado]),
    )
    return { ok: true }
  } catch (e) {
    return { ok: false, error: mensajeDeMigue(e, sesion) }
  }
}

// ── Para /api/salud ─────────────────────────────────────────────────────

/**
 * Lo gastado este mes, leído sin sesión.
 *
 * /api/salud no tiene quién pregunte y corre con comoServicio, y
 * app.migue_gasto_del_mes() arranca rechazando a quien no tiene sesión. Es la
 * misma suma con el mismo corte en hora de Tucumán; si una cambia, cambia la
 * otra.
 */
export async function gastoDelMesSinSesionEnTx(tx: Conexion): Promise<number> {
  const [fila] = await tx.consultar<{ gastado: string }>(
    `select coalesce(sum(costo_usd), 0)::text as gastado
       from migue_gasto
      where creado_en >= ${PRINCIPIO_DEL_MES}`,
  )
  return Number(fila?.gastado ?? 0)
}
