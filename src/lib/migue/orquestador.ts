/**
 * Una pregunta, de punta a punta.
 *
 *   1. Se controla la pregunta, cuántas tiene en curso su dueño y el tope de
 *      gasto. Nada de esto le cuesta un centavo al municipio: si no se puede
 *      contestar, no se llama al modelo.
 *   2. Se abre o se retoma la conversación, y se la reclama para esta pregunta
 *      (una a la vez: dos respuestas intercaladas rompen la historia).
 *   3. El modelo pide consultas; el servidor las corre con la sesión de quien
 *      pregunta, en una transacción de sólo lectura, y le devuelve los
 *      resultados. Así hasta que contesta, con un máximo de vueltas.
 *   4. Cada número de la respuesta se controla contra los que salieron de las
 *      consultas. Si alguno no tiene respaldo, se le pide una vez que la
 *      reescriba; si tampoco, se muestra una respuesta sin números y los botones.
 *   5. El turno entero se guarda de una vez, y recién ahí se muestra.
 *
 * Lo que se gasta se anota apenas vuelve cada llamada, no al final: si algo se
 * corta a mitad de camino, lo gastado igual queda contado para el tope.
 *
 * Sobre el paso 3: acá NO hay una sola escritura en el dominio. Las consultas
 * corren en `set transaction read only`, y aunque una herramienta tuviera un
 * insert escrito por error, la base lo rechazaría. Las únicas escrituras son
 * las de Migue en sus propias tablas, y todas pasan por funciones app.migue_*.
 */
import 'server-only'

import { conSesion, type Sesion } from '@db/sesion'
import type { Conexion } from '@db/client'
import { HORAS_VISIBLES_EN_EL_CELULAR } from '@/lib/reglas'

import { leerCatalogo } from './catalogo'
import { leerConfiguracion, migueEstaInstalado, topeDiarioUsd } from './configuracion'
import {
  abrirConversacion,
  anotarGasto,
  anotarNumeroSinRespaldo,
  buscarPregunta,
  cargarConversacion,
  cerrar,
  gastoDelMesYDeHoy,
  guardarTurno,
  preguntasEnCursoDelDueno,
  reclamar,
  soltar,
  vencer,
  type ConversacionCargada,
  type FilaDeTurno,
} from './conversacion'
import { buscarHerramienta, definiciones, herramientasPara } from './herramientas'
import { LARGO_MAXIMO_PREGUNTA, tieneDatoPersonal } from './limites'
import { ErrorDelProveedor, preguntarAlModelo } from './openrouter'
import { armarSistema, mensajeDeControl, prefijoDeLaPregunta, respuestaSegura } from './sistema'
import type {
  Catalogo,
  ContextoDeHerramienta,
  DefinicionDeHerramienta,
  EnlaceConAlcance,
  EventoDeMigue,
  Herramienta,
  LlamadaDeHerramienta,
  MensajeDelModelo,
  PedidoAMigue,
  PuntoDeLaSesion,
  Resultado,
} from './tipos'
import { sinLoNegadoDeLaPregunta, verificarNumeros } from './verificador'

// ── Límites ─────────────────────────────────────────────────────────────

/** Vueltas con el modelo por pregunta, contando el reintento del control. */
const VUELTAS_MAXIMAS = 6
/**
 * La pregunta entera, desde que llega hasta que se guarda. La función tiene 60 s
 * (maxDuration en route.ts) y lo que sobra es para guardar el turno o soltar
 * el reclamo: si Vercel la corta antes, ninguna de las dos cosas pasa. Cada
 * llamada al modelo, con sus reintentos, termina adentro de este plazo.
 */
const PLAZO_DE_LA_PREGUNTA_MS = 52_000
/**
 * Con menos que esto por delante no se empieza otra vuelta: una llamada con dos
 * o tres consultas tarda eso, y cortarla a la mitad es pagarla sin respuesta.
 */
const TIEMPO_MINIMO_PARA_UNA_VUELTA_MS = 12_000
/** Una conversación más larga que esto se cierra: se pone lenta y cara, y el modelo chico se pierde. */
const TURNOS_MAXIMOS = 20
const TOKENS_PARA_CERRAR = 60_000
/**
 * Preguntas a la vez por dueño —una coordinadora, o un punto con todos sus
 * celulares—, y lo que se aparta del tope por cada una que está en curso. Ver
 * app.migue_tomar_lugar en la 0025: sin esto, veinte pedidos simultáneos leían
 * el mismo gasto y pasaban todos el tope. La reserva es lo que cuesta una
 * pregunta larga con gpt-4o-mini, redondeado para arriba.
 */
const PREGUNTAS_EN_CURSO_MAXIMAS = 2
const RESERVA_POR_PREGUNTA_EN_CURSO_USD = 0.02

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Las pantallas del celular. Un vigilador que toca un botón del panel rebota a
 * /turno, así que un enlace fuera de esta lista no se le muestra aunque una
 * herramienta lo haya devuelto por error.
 */
const PANTALLAS_DEL_CELULAR = new Set(['/hoy', '/contenedores', '/conteo', '/pila', '/turno', '/preguntar'])
// Las que llevan algo después de la barra. Van aparte y con la barra final:
// comparar por prefijo sin ella dejaría pasar /pilas —del panel— por empezar
// igual que /pila.
const CARPETAS_DEL_CELULAR = ['/listo/', '/cargar/', '/preguntar/']

type Emitir = (evento: EventoDeMigue) => void

// ── La pregunta ─────────────────────────────────────────────────────────

export async function responder(pedido: PedidoAMigue, sesion: Sesion, emitir: Emitir): Promise<void> {
  const config = leerConfiguracion()
  if (config.problemas.length || !config.clave || config.topeMensualUsd === null) {
    emitir({ tipo: 'error', texto: `Migue está apagado: ${config.problemas.join(' ')}`, reintentar: false })
    return
  }

  const pregunta = (pedido.pregunta ?? '').replace(/\s+/g, ' ').trim()
  if (!UUID.test(pedido.preguntaId ?? '')) {
    emitir({ tipo: 'error', texto: 'La pregunta llegó sin su identificador. Recargá la página.', reintentar: false })
    return
  }
  if (!pregunta) {
    emitir({ tipo: 'error', texto: 'Escribí la pregunta.', reintentar: false })
    return
  }
  if (pregunta.length > LARGO_MAXIMO_PREGUNTA) {
    emitir({ tipo: 'error', texto: `La pregunta es muy larga: hasta ${LARGO_MAXIMO_PREGUNTA} letras.`, reintentar: false })
    return
  }
  // Una pregunta con un teléfono, un documento o un correo no se guarda ni se
  // manda afuera: el dato de un vecino no tiene por qué viajar al proveedor ni
  // quedar en la conversación que lee el turno siguiente. La forma está en
  // limites.ts, y es la misma que rechaza app.migue_recordar.
  if (tieneDatoPersonal(pregunta)) {
    emitir({
      tipo: 'error',
      texto: 'No escribas teléfonos, documentos ni correos acá: esto lo lee el proveedor y queda en la conversación. Si es de un vecino, va en su pantalla.',
      reintentar: false,
    })
    return
  }
  const dispositivoId = sesion.rol === 'vigilador' ? pedido.dispositivoId : null
  if (sesion.rol === 'vigilador' && !UUID.test(dispositivoId ?? '')) {
    emitir({ tipo: 'error', texto: 'No se pudo identificar este celular. Recargá la página.', reintentar: false })
    return
  }
  const pendientes = Math.max(0, Math.min(999, Math.trunc(Number(pedido.pendientesEnElCelular) || 0)))

  const ahora = new Date()
  const empezo = Date.now()

  // ── Paso 1 y 2: tope, conversación, reclamo ──────────────────────────
  // `conversacionId` en 'hecha' y en 'no': dónde está la pregunta, que puede no
  // ser la conversación que mandó el navegador (ver buscarPregunta).
  type Preparado =
    | { tipo: 'listo'; conversacion: ConversacionCargada; catalogo: Catalogo; punto: PuntoDeLaSesion | null; nueva: boolean }
    | { tipo: 'hecha'; conversacionId: string; texto: string; enlaces: EnlaceConAlcance[] }
    | { tipo: 'no'; evento: EventoDeMigue; conversacionId?: string }

  let preparado: Preparado
  try {
    preparado = await conSesion(sesion, async (tx): Promise<Preparado> => {
      if (!(await migueEstaInstalado(tx))) {
        return { tipo: 'no', evento: { tipo: 'error', texto: 'Migue todavía no está instalado en esta base.', reintentar: false } }
      }
      // Antes que nada, y en particular antes de leer el gasto: toma el
      // bloqueo del dueño hasta el final de esta transacción, así el pedido
      // siguiente del mismo dueño espera a ver el reclamo de éste.
      const enCurso = await preguntasEnCursoDelDueno(tx)
      await vencer(tx)

      const punto = sesion.rol === 'vigilador' ? await puntoDeLaSesion(tx, sesion) : null
      if (sesion.rol === 'vigilador' && !punto) {
        return { tipo: 'no', evento: { tipo: 'error', texto: 'Tu usuario no tiene un punto asignado.', reintentar: false } }
      }

      // Una respuesta ya dada se devuelve aunque se haya llegado al tope o
      // haya otras en curso: no cuesta nada, y es la que la persona estaba
      // esperando. Se busca en todas sus conversaciones, antes de abrir otra.
      const encontrada = await buscarPregunta(tx, pedido.preguntaId, dispositivoId)
      if (encontrada?.estado === 'hecha') {
        return { tipo: 'hecha', conversacionId: encontrada.conversacionId, texto: encontrada.texto, enlaces: encontrada.enlaces }
      }
      if (encontrada?.estado === 'en_curso') {
        return {
          tipo: 'no',
          conversacionId: encontrada.conversacionId,
          evento: { tipo: 'error', texto: 'Todavía estoy contestando esa pregunta. Esperá un momento.', reintentar: true },
        }
      }

      if (enCurso >= PREGUNTAS_EN_CURSO_MAXIMAS) {
        return {
          tipo: 'no',
          evento: {
            tipo: 'error',
            texto:
              sesion.rol === 'vigilador'
                ? 'Estoy contestando otras preguntas de este punto. Esperá un momento y probá de nuevo.'
                : 'Estoy contestando otras preguntas tuyas. Esperá un momento y probá de nuevo.',
            reintentar: true,
          },
        }
      }

      let conversacion = pedido.conversacionId && UUID.test(pedido.conversacionId)
        ? await cargarConversacion(tx, pedido.conversacionId)
        : null
      if (conversacion && sesion.rol === 'vigilador' && conversacion.dispositivoId !== dispositivoId) conversacion = null

      // Lo que ya se gastó más lo que pueden gastar las que están en curso,
      // que todavía no anotaron todo.
      const gasto = await gastoDelMesYDeHoy(tx)
      const reservado = enCurso * RESERVA_POR_PREGUNTA_EN_CURSO_USD
      if (gasto.mes + reservado >= config.topeMensualUsd!) {
        return {
          tipo: 'no',
          evento: {
            tipo: 'error',
            texto: 'Migue llegó al tope de gasto del mes que fijó la Secretaría. Vuelve a contestar el 1°.',
            reintentar: false,
          },
        }
      }
      const topeDeHoy = topeDiarioUsd(config, sesion.rol)
      if (topeDeHoy !== null && gasto.hoy + reservado >= topeDeHoy) {
        return {
          tipo: 'no',
          evento: {
            tipo: 'error',
            texto:
              sesion.rol === 'vigilador'
                ? 'Este punto ya usó lo que le toca de Migue por hoy. Mañana vuelve a contestar.'
                : 'Ya usaste lo que te toca de Migue por hoy. Mañana vuelve a contestar.',
            reintentar: false,
          },
        }
      }

      const catalogo = await leerCatalogo(tx, { rol: sesion.rol, perfilId: sesion.perfilId, punto })

      let nueva = false
      if (!conversacion || conversacion.cerrada) {
        conversacion = await abrirNueva(tx, sesion, punto, dispositivoId, config.modelo, catalogo)
        nueva = true
      }

      let estado = await reclamar(tx, conversacion.id, pedido.preguntaId)
      if (estado === 'cerrada') {
        conversacion = await abrirNueva(tx, sesion, punto, dispositivoId, config.modelo, catalogo)
        nueva = true
        estado = await reclamar(tx, conversacion.id, pedido.preguntaId)
      }
      if (estado === 'hecha') {
        // Sólo si otro pedido con el mismo id guardó el turno entre la
        // búsqueda de arriba y el reclamo. Nunca se sigue de acá sin reclamo:
        // guardarTurno fallaría después de haber pagado las llamadas.
        const ya = await buscarPregunta(tx, pedido.preguntaId, dispositivoId)
        if (ya?.estado === 'hecha') {
          return { tipo: 'hecha', conversacionId: ya.conversacionId, texto: ya.texto, enlaces: ya.enlaces }
        }
        return { tipo: 'no', evento: { tipo: 'error', texto: 'Esa pregunta ya no está. Escribila de nuevo.', reintentar: false } }
      }
      if (estado === 'en_curso') {
        return { tipo: 'no', evento: { tipo: 'error', texto: 'Todavía estoy contestando esa pregunta. Esperá un momento.', reintentar: true } }
      }
      if (estado === 'ocupada') {
        return {
          tipo: 'no',
          evento: { tipo: 'error', texto: 'Estoy contestando otra pregunta en esta conversación. Esperá a que termine.', reintentar: true },
        }
      }
      return { tipo: 'listo', conversacion, catalogo, punto, nueva }
    })
  } catch (e) {
    console.error('[migue] no se pudo preparar la pregunta', e)
    emitir({ tipo: 'error', texto: 'No pude leer la base. Probá de nuevo en un rato.', reintentar: true })
    return
  }

  // Primero dónde está, después la respuesta: si no, el chat sumaría la
  // respuesta de Y a la pantalla de X, y la pregunta siguiente saldría a X.
  if (preparado.tipo === 'no') {
    if (preparado.conversacionId) emitir({ tipo: 'conversacion', conversacionId: preparado.conversacionId })
    emitir(preparado.evento)
    return
  }
  if (preparado.tipo === 'hecha') {
    emitir({ tipo: 'conversacion', conversacionId: preparado.conversacionId })
    emitir({ tipo: 'respuesta', preguntaId: pedido.preguntaId, texto: preparado.texto, enlaces: preparado.enlaces })
    return
  }

  const { conversacion, catalogo, punto } = preparado
  if (preparado.nueva) emitir({ tipo: 'conversacion', conversacionId: conversacion.id })

  // ── Paso 3 y 4: el bucle ─────────────────────────────────────────────
  const contexto: ContextoDeHerramienta = {
    rol: sesion.rol,
    punto,
    ahora,
    catalogo,
    pendientesEnElCelular: pendientes,
    conversacionId: conversacion.id,
    pregunta,
  }

  // Cada mensaje se serializa UNA vez: lo que se guarda y lo que se manda es
  // ese mismo texto (ver conversacion.ts).
  const filas: FilaDeTurno[] = []
  const agregar = (mensaje: MensajeDelModelo, fila: Omit<FilaDeTurno, 'contenido' | 'rol'>) => {
    const contenido = JSON.stringify(mensaje)
    filas.push({ rol: mensaje.role, contenido, ...fila })
    return JSON.parse(contenido) as MensajeDelModelo
  }

  const historia: MensajeDelModelo[] = [{ role: 'system', content: conversacion.sistema }, ...conversacion.mensajes]
  historia.push(
    agregar(
      { role: 'user', content: `${prefijoDeLaPregunta(ahora, pendientes)}\n${pregunta}` },
      { tipo: 'pregunta', textoVisible: pregunta, enlaces: null, numeros: null },
    ),
  )

  // Más la cifra con que el vigilador entiende por qué no ve el mes. Es una
  // regla del sistema, no un dato, y el sistema se la dice: sin esto, «desde el
  // celular se ven las últimas 48 horas» caía en el control cada vez que se la
  // explicaba antes de consultar nada (pasó en la primera prueba).
  const numerosPermitidos = new Set<number>([
    ...conversacion.numeros,
    ...(sesion.rol === 'vigilador' ? [HORAS_VISIBLES_EN_EL_CELULAR] : []),
  ])
  const enlaces: EnlaceConAlcance[] = []
  const nombresOfrecidos = new Set(conversacion.herramientas.map((d) => d.function.name))
  let yaSeControlo = false
  let respuestaFinal: { mensaje: MensajeDelModelo; texto: string } | null = null
  let ultimosTokens = 0

  emitir({ tipo: 'estado', texto: 'Leyendo tu pregunta…' })

  const plazo = empezo + PLAZO_DE_LA_PREGUNTA_MS

  try {
    for (let vuelta = 0; vuelta < VUELTAS_MAXIMAS && !respuestaFinal; vuelta++) {
      if (plazo - Date.now() < TIEMPO_MINIMO_PARA_UNA_VUELTA_MS) {
        throw new ErrorDelProveedor(0, 'Tardé demasiado en armar la respuesta. Probá preguntarlo más simple.', false, 'tiempo agotado')
      }

      const respuesta = await preguntarAlModelo({
        clave: config.clave,
        modelo: conversacion.modelo,
        mensajes: historia,
        herramientas: conversacion.herramientas,
        esfuerzo: config.esfuerzo,
        maxTokens: config.esfuerzo ? 6000 : 1500,
        plazo,
      })
      ultimosTokens = respuesta.tokensDeEntrada

      await conSesion(sesion, (tx) =>
        anotarGasto(tx, {
          conversacionId: conversacion.id,
          preguntaId: pedido.preguntaId,
          modeloPedido: conversacion.modelo,
          modeloServido: respuesta.modeloServido,
          proveedor: respuesta.proveedor,
          uso: respuesta.uso,
          costoUsd: respuesta.costoUsd,
        }),
      ).catch((e) => console.error('[migue] no se pudo anotar el gasto', e))

      if (respuesta.fin === 'content_filter') {
        throw new ErrorDelProveedor(0, 'Eso no lo puedo contestar.', false, 'content_filter')
      }
      if (respuesta.fin === 'length') {
        throw new ErrorDelProveedor(0, 'La respuesta me quedó demasiado larga. Preguntámelo más acotado.', false, 'length')
      }

      // ── El modelo pide consultas ──
      if (respuesta.llamadas.length) {
        historia.push(
          agregar(
            { role: 'assistant', content: respuesta.contenido, tool_calls: respuesta.llamadas },
            { tipo: 'intermedio', textoVisible: null, enlaces: null, numeros: null },
          ),
        )
        const resultados = await correrLlamadas(respuesta.llamadas, nombresOfrecidos, sesion, contexto, emitir)
        if (resultados.cortar) {
          // La base ya cerró y vació la conversación y soltó el reclamo.
          emitir({
            tipo: 'cerrada',
            motivo: 'maltrato',
            texto: 'Corté esta conversación. Cuando quieras, empezá otra y seguimos con lo de trabajo.',
          })
          return
        }
        for (const r of resultados.mensajes) {
          const numeros = r.resultado ? r.resultado.numeros : r.numerosDelRechazo
          for (const n of numeros) numerosPermitidos.add(n)
          if (r.resultado) {
            for (const e of filtrarEnlaces(r.resultado, sesion.rol)) {
              if (!enlaces.some((x) => x.href === e.href)) enlaces.push(e)
            }
          }
          historia.push(
            agregar(r.mensaje, {
              tipo: 'resultado',
              textoVisible: null,
              enlaces: null,
              // En la fila también, para que valgan en las preguntas siguientes
              // de la conversación, igual que los de un resultado.
              numeros: r.resultado || numeros.length ? numeros : null,
            }),
          )
        }
        continue
      }

      // ── El modelo contesta ──
      const texto = (respuesta.contenido ?? '').trim()
      if (!texto) {
        throw new ErrorDelProveedor(502, 'Me quedé sin palabras esta vez. Probá de nuevo.', true, 'respuesta vacía')
      }

      const veredicto = verificarNumeros(sinLoNegadoDeLaPregunta(texto, pregunta), [...numerosPermitidos], ahora)
      if (veredicto.ok) {
        respuestaFinal = { mensaje: { role: 'assistant', content: texto }, texto }
        break
      }

      if (!yaSeControlo) {
        // El borrador NO entra en la historia: se descarta, y se le pide de
        // nuevo con el control agregado al final. Lo que se manda después es lo
        // que se mandó antes más un mensaje: la historia sigue sin editarse.
        yaSeControlo = true
        emitir({ tipo: 'estado', texto: 'Revisando los números…' })
        historia.push(
          agregar(
            { role: 'system', content: mensajeDeControl(veredicto.sinRespaldo) },
            { tipo: 'control', textoVisible: null, enlaces: null, numeros: null },
          ),
        )
        continue
      }

      // Tampoco el reintento: se muestra una respuesta sin números propios.
      console.warn('[migue] respuesta sin respaldo después del control:', veredicto.sinRespaldo.join(', '))
      await conSesion(sesion, anotarNumeroSinRespaldo).catch(() => {})
      const segura = respuestaSegura(enlaces)
      respuestaFinal = { mensaje: { role: 'assistant', content: segura }, texto: segura }
    }

    if (!respuestaFinal) {
      throw new ErrorDelProveedor(0, 'No llegué a una respuesta. Probá preguntarlo de otra forma.', false, 'sin respuesta final')
    }

    // ── Paso 5: se guarda el turno entero, y recién ahí se muestra ──
    agregar(respuestaFinal.mensaje, {
      tipo: 'respuesta',
      textoVisible: respuestaFinal.texto,
      enlaces,
      numeros: null,
    })
    await conSesion(sesion, (tx) => guardarTurno(tx, conversacion.id, pedido.preguntaId, filas))
    emitir({ tipo: 'respuesta', preguntaId: pedido.preguntaId, texto: respuestaFinal.texto, enlaces })

    if (conversacion.turnos + 1 >= TURNOS_MAXIMOS || ultimosTokens >= TOKENS_PARA_CERRAR) {
      await conSesion(sesion, (tx) => cerrar(tx, conversacion.id, 'larga')).catch(() => {})
      emitir({
        tipo: 'cerrada',
        motivo: 'larga',
        texto: 'Esta conversación ya es larga. La próxima pregunta empieza una nueva, para que no me confunda.',
      })
    }
  } catch (e) {
    await conSesion(sesion, (tx) => soltar(tx, conversacion.id, pedido.preguntaId)).catch(() => {})
    if (e instanceof ErrorDelProveedor) {
      if (e.estado !== 0 || e.message !== 'tiempo agotado') console.error('[migue]', e.estado, e.message)

      // Un 404 o un 400 dependen de lo que la conversación tiene congelado: el
      // modelo con que se abrió, o la historia que se reenvía. Si OpenRouter da
      // de baja el modelo y la Dirección de IA cambia ASISTENTE_MODELO, la
      // conversación de coordinación —que no se cierra por quieta— seguía
      // pidiendo el viejo y recibiendo el mismo 404 en cada pregunta, con la
      // configuración ya corregida. Cerrada, la próxima abre una nueva con la
      // de hoy. Un 401, 402 o 403 no: la clave y el crédito son de todas.
      if (e.estado === 404 || (e.estado === 400 && !e.reintentable)) {
        const cerro = await conSesion(sesion, (tx) => cerrar(tx, conversacion.id, 'error')).then(
          () => true,
          () => false,
        )
        if (cerro) {
          emitir({
            tipo: 'cerrada',
            motivo: 'error',
            texto: `${e.paraLaPersona} La próxima pregunta empieza una conversación nueva.`,
          })
          return
        }
      }

      emitir({ tipo: 'error', texto: e.paraLaPersona, reintentar: e.reintentable })
      return
    }
    console.error('[migue] falló la pregunta', e)
    emitir({ tipo: 'error', texto: 'Algo falló de mi lado. Probá de nuevo.', reintentar: true })
  }
}

// ── Piezas ──────────────────────────────────────────────────────────────


async function puntoDeLaSesion(tx: Conexion, sesion: Sesion): Promise<PuntoDeLaSesion | null> {
  if (!sesion.sitioId) return null
  const [fila] = await tx.consultar<{
    id: string
    codigo: string
    nombre: string
    tipo: 'planta' | 'punto_verde'
    carga_detallada: boolean
  }>('select id, codigo, nombre, tipo, carga_detallada from sitios where id = $1', [sesion.sitioId])
  return fila
    ? { id: fila.id, codigo: fila.codigo, nombre: fila.nombre, tipo: fila.tipo, cargaDetallada: fila.carga_detallada }
    : null
}

async function abrirNueva(
  tx: Conexion,
  sesion: Sesion,
  punto: PuntoDeLaSesion | null,
  dispositivoId: string | null,
  modelo: string,
  catalogo: Catalogo,
): Promise<ConversacionCargada> {
  const herramientas: DefinicionDeHerramienta[] = definiciones(herramientasPara(sesion.rol, punto), catalogo)
  const id = await abrirConversacion(tx, {
    rol: sesion.rol,
    perfilId: sesion.perfilId,
    sitioId: punto?.id ?? null,
    dispositivoId,
    modelo,
    sistema: armarSistema(sesion.rol, punto, catalogo),
    herramientas: JSON.stringify(herramientas),
    recuerdosIncluidos: catalogo.recuerdos.map((r) => r.id),
  })
  // Se vuelve a leer de la base en vez de usar lo que está en memoria, para
  // que la primera pregunta mande exactamente lo mismo que las siguientes.
  const cargada = await cargarConversacion(tx, id)
  if (!cargada) throw new Error('La conversación recién abierta no se pudo leer.')
  return cargada
}

interface MensajeDeResultado {
  mensaje: MensajeDelModelo
  resultado: Resultado | null
  /**
   * Las cifras de un rechazo de validar(), que arma el servidor y no es texto
   * libre: «el tablero llega hasta 24 meses para atrás: lo más viejo es
   * 2024-10». Sin esto, el modelo que le explicaba ese límite a la persona
   * caía en el control por el 24 y el 2024, y si los repetía terminaba en la
   * respuesta segura, que para una pregunta sobre un límite del sistema engaña.
   * Vacío en cualquier otro error.
   */
  numerosDelRechazo: number[]
}

/**
 * Los números que trae un rechazo de validar(), si los trae. Sólo los que la
 * herramienta puso a mano en `numeros`, escritos con las constantes del
 * código: nunca se sacan del texto del error, que a veces repite lo que mandó
 * el modelo («La fecha hasta (30/09/2026) es posterior a hoy»), y sacándolos de
 * ahí el modelo podría respaldarse sus propios números inventados.
 */
function numerosDelRechazo(validacion: { error: string }): number[] {
  const numeros = (validacion as { numeros?: unknown }).numeros
  if (!Array.isArray(numeros)) return []
  return numeros.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
}

/**
 * Corre las consultas que pidió el modelo. Las de lectura van todas juntas en
 * una transacción de sólo lectura —en Vercel hay una sola conexión por
 * instancia, así que dos transacciones no se superponen igual—; las meta, en
 * otra, normal. Un error de una herramienta vuelve al modelo como resultado
 * con el error, para que lo diga o pruebe de otra forma: nunca tumba la
 * pregunta entera.
 */
async function correrLlamadas(
  llamadas: LlamadaDeHerramienta[],
  nombresOfrecidos: Set<string>,
  sesion: Sesion,
  contexto: ContextoDeHerramienta,
  emitir: Emitir,
): Promise<{ mensajes: MensajeDeResultado[]; cortar: boolean }> {
  type Lista = { llamada: LlamadaDeHerramienta; herramienta: Herramienta; entrada: unknown }
  const porId = new Map<string, MensajeDeResultado>()
  const lectura: Lista[] = []
  const meta: Lista[] = []

  const error = (llamada: LlamadaDeHerramienta, texto: string, numeros: number[] = []) =>
    porId.set(llamada.id, {
      mensaje: { role: 'tool', tool_call_id: llamada.id, content: JSON.stringify({ error: texto }) },
      resultado: null,
      numerosDelRechazo: numeros,
    })

  for (const llamada of llamadas) {
    const herramienta = nombresOfrecidos.has(llamada.function.name)
      ? buscarHerramienta(llamada.function.name, contexto.rol, contexto.punto)
      : null
    if (!herramienta) {
      error(llamada, `No hay ninguna herramienta «${llamada.function.name}» para vos.`)
      continue
    }
    let argumentos: unknown
    try {
      argumentos = JSON.parse(llamada.function.arguments || '{}')
    } catch {
      error(llamada, 'Los argumentos no son JSON válido. Volvé a pedirla.')
      continue
    }
    const validacion = herramienta.validar(argumentos, contexto)
    if (!validacion.ok) {
      error(llamada, validacion.error, numerosDelRechazo(validacion))
      continue
    }
    ;(herramienta.clase === 'meta' ? meta : lectura).push({ llamada, herramienta, entrada: validacion.valor })
  }

  const correr = async (tx: Conexion, lista: Lista[]) => {
    for (const { llamada, herramienta, entrada } of lista) {
      emitir({ tipo: 'estado', texto: herramienta.estado(entrada) })
      try {
        const resultado = await herramienta.ejecutar(tx, entrada, contexto)
        porId.set(llamada.id, {
          mensaje: { role: 'tool', tool_call_id: llamada.id, content: paraElModelo(resultado) },
          resultado,
          numerosDelRechazo: [],
        })
      } catch (e) {
        console.error(`[migue] falló la herramienta ${herramienta.nombre}`, e)
        error(llamada, 'Esa consulta falló. Decile a la persona que no pudiste consultar eso ahora.')
        // Adentro de una transacción de Postgres, después de un error no corre
        // nada más: las que siguen se contestan con el mismo error.
        throw e
      }
    }
  }

  const tanda = async (lista: Lista[], soloLectura: boolean) => {
    if (!lista.length) return
    try {
      await conSesion(sesion, async (tx) => {
        if (soloLectura) await tx.consultar('set transaction read only')
        await correr(tx, lista)
      })
    } catch {
      for (const { llamada } of lista) {
        if (!porId.has(llamada.id)) error(llamada, 'Esa consulta no se pudo hacer ahora.')
      }
    }
  }

  await tanda(lectura, true)
  await tanda(meta, false)

  // En el orden en que los pidió el modelo: el formato exige un resultado por
  // cada pedido, y así se lee mejor la historia guardada.
  const mensajes = llamadas.map((l) => porId.get(l.id)!)
  const cortar = mensajes.some((m) => m.resultado?.cortar)
  return { mensajes, cortar }
}

/**
 * Lo que ve el modelo de un resultado. Los números sueltos no van —son para el
 * control, y al modelo sólo le harían ruido—; los enlaces van por el rótulo,
 * para que pueda decir «abajo tenés el botón del tablero» sin escribir URLs.
 */
function paraElModelo(r: Resultado): string {
  return JSON.stringify({
    alcance: r.alcance,
    ...(r.hayDatosEnElSistema === false ? { todavia_no_hay_nada_cargado_en_el_sistema: true } : {}),
    ...(r.nota ? { nota_que_hay_que_decir: r.nota } : {}),
    datos: r.datos,
    ...(r.enlaces.length ? { botones_debajo_de_la_respuesta: r.enlaces.map((e) => e.rotulo) } : {}),
  })
}

function filtrarEnlaces(r: Resultado, rol: 'admin' | 'vigilador'): EnlaceConAlcance[] {
  return r.enlaces
    .filter((e) => {
      if (rol === 'admin') return true
      const ruta = e.href.split('?')[0]
      return PANTALLAS_DEL_CELULAR.has(ruta) || CARPETAS_DEL_CELULAR.some((c) => ruta.startsWith(c))
    })
    .map((e) => ({ ...e, alcance: r.alcance }))
}
