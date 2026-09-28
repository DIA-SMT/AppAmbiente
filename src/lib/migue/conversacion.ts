/**
 * Guardar y volver a leer una conversación.
 *
 * Todo pasa por las funciones app.migue_* de la 0025 o por lo que RLS deja
 * leer; acá no hay un solo `comoServicio`. Y todo con la sesión de quien
 * pregunta: una conversación ajena no se encuentra, no se «rechaza».
 *
 * La regla que manda sobre este archivo es que la historia vuelve IDÉNTICA a
 * como se mandó. Cada mensaje se serializa una sola vez, se guarda ese texto, y
 * lo que se le manda al modelo es siempre el texto guardado vuelto a leer.
 */
import 'server-only'

import type { Conexion } from '@db/client'

import type { DefinicionDeHerramienta, EnlaceConAlcance, MensajeDelModelo, RolDeMigue } from './tipos'

export type EstadoDelReclamo = 'libre' | 'hecha' | 'en_curso' | 'ocupada' | 'cerrada'

export interface ConversacionCargada {
  id: string
  rol: RolDeMigue
  modelo: string
  dispositivoId: string | null
  /** El sistema tal como se guardó. */
  sistema: string
  herramientas: DefinicionDeHerramienta[]
  /** La historia, en orden, lista para mandar. */
  mensajes: MensajeDelModelo[]
  /** Todos los números que salieron de consultas en esta conversación. */
  numeros: number[]
  turnos: number
  cerrada: boolean
}

/** Una fila de un turno, antes de guardarla. `contenido` es el mensaje ya serializado. */
export interface FilaDeTurno {
  rol: 'user' | 'assistant' | 'system' | 'tool'
  tipo: 'pregunta' | 'intermedio' | 'resultado' | 'control' | 'respuesta'
  contenido: string
  textoVisible: string | null
  enlaces: EnlaceConAlcance[] | null
  numeros: number[] | null
}

export async function abrirConversacion(
  tx: Conexion,
  datos: {
    rol: RolDeMigue
    perfilId: string
    sitioId: string | null
    dispositivoId: string | null
    modelo: string
    sistema: string
    herramientas: string
    recuerdosIncluidos: string[]
  },
): Promise<string> {
  const [fila] = await tx.consultar<{ id: string }>(
    `insert into migue_conversaciones
       (rol, perfil_id, sitio_id, dispositivo_id, abierta_por_id, modelo, sistema, herramientas, recuerdos_incluidos)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[])
     returning id`,
    [
      datos.rol,
      datos.rol === 'admin' ? datos.perfilId : null,
      datos.rol === 'vigilador' ? datos.sitioId : null,
      datos.rol === 'vigilador' ? datos.dispositivoId : null,
      datos.perfilId,
      datos.modelo,
      datos.sistema,
      datos.herramientas,
      datos.recuerdosIncluidos,
    ],
  )
  return fila.id
}

/**
 * La conversación con su historia. Null si no existe o no es de quien
 * pregunta: RLS la esconde y para acá son lo mismo.
 */
export async function cargarConversacion(tx: Conexion, id: string): Promise<ConversacionCargada | null> {
  const [c] = await tx.consultar<{
    id: string
    rol: RolDeMigue
    modelo: string
    dispositivo_id: string | null
    sistema: string
    herramientas: string
    turnos: number
    cerrada_en: string | null
  }>(
    `select id, rol, modelo, dispositivo_id, sistema, herramientas, turnos, cerrada_en
       from migue_conversaciones where id = $1`,
    [id],
  )
  if (!c) return null

  const filas = await tx.consultar<{ contenido: string; numeros: string | null }>(
    `select contenido, numeros from migue_mensajes where conversacion_id = $1 order by orden`,
    [id],
  )

  const numeros = new Set<number>()
  for (const f of filas) {
    if (!f.numeros) continue
    for (const n of JSON.parse(f.numeros) as number[]) numeros.add(n)
  }

  return {
    id: c.id,
    rol: c.rol,
    modelo: c.modelo,
    dispositivoId: c.dispositivo_id,
    sistema: c.sistema,
    // Una conversación vaciada tiene el texto en blanco: se da por cerrada y
    // nunca se intenta parsear.
    herramientas: c.herramientas ? (JSON.parse(c.herramientas) as DefinicionDeHerramienta[]) : [],
    mensajes: filas.filter((f) => f.contenido).map((f) => JSON.parse(f.contenido) as MensajeDelModelo),
    numeros: [...numeros],
    turnos: c.turnos,
    cerrada: c.cerrada_en !== null || !c.sistema,
  }
}

export async function reclamar(tx: Conexion, conversacionId: string, preguntaId: string): Promise<EstadoDelReclamo> {
  const [fila] = await tx.consultar<{ estado: EstadoDelReclamo }>(
    'select app.migue_reclamar($1, $2) as estado',
    [conversacionId, preguntaId],
  )
  return fila.estado
}

export async function soltar(tx: Conexion, conversacionId: string, preguntaId: string): Promise<void> {
  await tx.consultar('select app.migue_soltar($1, $2)', [conversacionId, preguntaId])
}

export async function guardarTurno(
  tx: Conexion,
  conversacionId: string,
  preguntaId: string,
  filas: FilaDeTurno[],
): Promise<void> {
  const aTexto = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v))
  await tx.consultar(
    `select app.migue_guardar_turno($1, $2, $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[])`,
    [
      conversacionId,
      preguntaId,
      filas.map((f) => f.rol),
      filas.map((f) => f.tipo),
      filas.map((f) => f.contenido),
      filas.map((f) => f.textoVisible),
      filas.map((f) => aTexto(f.enlaces)),
      filas.map((f) => aTexto(f.numeros)),
    ],
  )
}

export async function cerrar(tx: Conexion, conversacionId: string, motivo: 'nueva' | 'larga' | 'error'): Promise<void> {
  await tx.consultar('select app.migue_cerrar($1, $2)', [conversacionId, motivo])
}

export type PreguntaEncontrada =
  | { estado: 'hecha'; conversacionId: string; texto: string; enlaces: EnlaceConAlcance[] }
  | { estado: 'en_curso'; conversacionId: string }

/**
 * Dónde está una pregunta, por su id, en CUALQUIER conversación de quien
 * pregunta: RLS ya deja ver sólo las suyas. Sirve para un reintento y para
 * recuperarla después de un corte.
 *
 * No se busca sólo en la conversación que manda el navegador porque el
 * servidor puede haberla pasado a otra sin que el navegador se entere. El caso:
 * el celular vuelve a las dos horas y media con la conversación X en pantalla,
 * pregunta, el servidor cierra X por quieta, abre Y y arranca el modelo, y la
 * señal se corta antes de que llegue el aviso de Y. El chat pregunta por X, no
 * la encuentra, la vuelve a mandar con X, y el servidor abría Z y pagaba la
 * misma pregunta dos veces.
 *
 * `dispositivoId`, en el celular: la del mismo teléfono. La cuenta del punto
 * ve las conversaciones de todos sus celulares, y una de otro teléfono no se le
 * puede seguir desde éste.
 */
export async function buscarPregunta(
  tx: Conexion,
  preguntaId: string,
  dispositivoId: string | null,
): Promise<PreguntaEncontrada | null> {
  const [hecha] = await tx.consultar<{ conversacion_id: string; texto_visible: string; enlaces: string | null }>(
    `select m.conversacion_id, m.texto_visible, m.enlaces
       from migue_mensajes m join migue_conversaciones c on c.id = m.conversacion_id
      where m.pregunta_id = $1 and m.tipo = 'respuesta' and m.texto_visible is not null
        and ($2::uuid is null or c.dispositivo_id = $2::uuid)
      order by m.creado_en desc
      limit 1`,
    [preguntaId, dispositivoId],
  )
  if (hecha) {
    return {
      estado: 'hecha',
      conversacionId: hecha.conversacion_id,
      texto: hecha.texto_visible,
      enlaces: hecha.enlaces ? (JSON.parse(hecha.enlaces) as EnlaceConAlcance[]) : [],
    }
  }

  // Los mismos cuatro minutos que usa app.migue_reclamar para dar un reclamo
  // por muerto.
  const [enCurso] = await tx.consultar<{ id: string }>(
    `select id from migue_conversaciones
      where pregunta_en_curso = $1 and pregunta_en_curso_desde > now() - interval '4 minutes'
        and ($2::uuid is null or dispositivo_id = $2::uuid)
      limit 1`,
    [preguntaId, dispositivoId],
  )
  return enCurso ? { estado: 'en_curso', conversacionId: enCurso.id } : null
}

/**
 * Cuántas preguntas tiene en curso ahora el dueño de la sesión, contando
 * todas sus conversaciones. Toma el bloqueo del dueño hasta que termine la
 * transacción: ver app.migue_tomar_lugar en la 0025.
 */
export async function preguntasEnCursoDelDueno(tx: Conexion): Promise<number> {
  const [fila] = await tx.consultar<{ en_curso: number }>('select app.migue_tomar_lugar() as en_curso')
  return Number(fila.en_curso)
}

export async function vencer(tx: Conexion): Promise<void> {
  await tx.consultar('select app.migue_vencer()')
}

export async function anotarGasto(
  tx: Conexion,
  datos: {
    conversacionId: string | null
    preguntaId: string
    modeloPedido: string
    modeloServido: string
    proveedor: string
    uso: unknown
    costoUsd: number
  },
): Promise<void> {
  await tx.consultar('select app.migue_anotar_gasto($1, $2, $3, $4, $5, $6, $7)', [
    datos.conversacionId,
    datos.preguntaId,
    datos.modeloPedido,
    datos.modeloServido,
    datos.proveedor,
    JSON.stringify(datos.uso ?? null),
    // numeric(12,6): un costo con más decimales entra redondeado.
    Math.max(0, Math.min(datos.costoUsd, 49)),
  ])
}

export async function gastoDelMesYDeHoy(tx: Conexion): Promise<{ mes: number; hoy: number }> {
  const [fila] = await tx.consultar<{ mes: string | number; hoy: string | number }>(
    'select app.migue_gasto_del_mes() as mes, app.migue_gasto_de_hoy() as hoy',
  )
  return { mes: Number(fila.mes), hoy: Number(fila.hoy) }
}

export async function anotarNumeroSinRespaldo(tx: Conexion): Promise<void> {
  await tx.consultar(`select app.migue_anotar_evento('numero_sin_respaldo')`)
}
