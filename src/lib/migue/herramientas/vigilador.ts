/**
 * Lo que Migue puede consultar desde el celular de un punto.
 *
 * Cada herramienta es una pantalla del celular dicha en voz alta: corre la
 * misma consulta que esa pantalla, con la sesión del punto, y devuelve lo que
 * esa pantalla dibuja. Ni una cuenta más. Si /hoy lista filas y no suma
 * cantidades, lo_de_hoy tampoco las suma: un «hoy entraron 14 m³» que ninguna
 * pantalla muestra es un número que el vigilador no puede ir a mirar.
 *
 * El punto sale SIEMPRE del contexto, que sale de la sesión. Ninguna recibe un
 * punto por parámetro: «¿cuánto cargó Italia?» desde PV-01 no tiene que llegar
 * a una consulta que devuelva cero filas —RLS no da error, recorta—, porque un
 * «Italia no cargó nada» es falso y encima suena a acusación.
 *
 * Y nada de personas: v_movimientos trae chofer, autorizante, vigilador y
 * quién cargó, y ninguno sale de acá. La cuenta del punto es compartida entre
 * quienes rotan, así que «lo cargó Punto Verde Italia» no dice quién fue, y
 * decirlo como si dijera es inventar un responsable. Tampoco van los nombres de
 * las entidades de origen o destino (ver DISENO-v2, regla 3): esos son de
 * coordinación.
 */
import 'server-only'

import type { Conexion } from '@db/client'
import type { Sesion } from '@db/sesion'
import {
  contenedoresDelSitioEnTx, conteosRecientesEnTx, movimientoPorIdEnTx, movimientosDelTurnoEnTx,
  pedidosDeRecambioEnTx, pilasEnTx,
} from '@/lib/datos'
import {
  ETIQUETA_TIPO, ETIQUETA_VALORIZACION, cantidad, cantidadDeMovimiento, claveDeCalendario,
  desdeInputFechaHora, diaSemana, fecha, fechaDeCalendario, fechaHora, paraInputFechaHora,
} from '@/lib/formato'
import {
  DIAS_DE_CONTEO_PARA_ATRAS, DIAS_PARA_PEDIDO_DEMORADO, HORAS_PARA_CANCELAR_PEDIDO,
  HORAS_VISIBLES_EN_EL_CELULAR, MINUTOS_PARA_DESHACER,
} from '@/lib/reglas'
import type { EstadoPila, FilaPila, ItemListado, MovimientoListado, PedidoRecambio } from '@/lib/tipos'

import type {
  ContextoDeHerramienta, EsquemaDeParametros, Herramienta, PuntoDeLaSesion, TipoDeSitio, Validacion,
} from '../tipos'
import { Numeros, aMano, alcanceDelCelular, enlace, hoyEnTucuman, recortar } from './comunes'

// ── Lo que comparten las cinco ──────────────────────────────────────────

/**
 * La lista mezcla herramientas con entradas de tipos distintos —nada, un
 * número—, y un Herramienta<number> no entra en un Herramienta[] porque
 * `estado` y `ejecutar` reciben la entrada. El orquestador las usa siempre en
 * el mismo orden: lo que devolvió validar() es lo que les pasa a las otras
 * dos, así que la entrada nunca llega con otro tipo.
 */
function definir<E>(herramienta: Herramienta<E>): Herramienta {
  return herramienta as unknown as Herramienta
}

const SIN_PARAMETROS: EsquemaDeParametros = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
}

const NOMBRE_DEL_SITIO: Record<TipoDeSitio, string> = {
  planta: 'la Planta',
  punto_verde: 'un punto verde',
}

/**
 * El punto del contexto, o por qué no. Las herramientas del vigilador sólo
 * existen en el celular de un punto, pero una sesión de coordinación escribiendo
 * la dirección a mano no tiene punto, y el orquestador filtra por tipo de sitio
 * de afuera: si alguna vez se le escapa una, la respuesta tiene que ser un
 * error que el modelo entienda y no una consulta sobre todos los puntos.
 */
function exigirPunto(
  contexto: ContextoDeHerramienta,
  tipos: TipoDeSitio[] = ['planta', 'punto_verde'],
): Validacion<PuntoDeLaSesion> {
  const punto = contexto.punto
  if (contexto.rol !== 'vigilador' || !punto) {
    return { ok: false, error: 'Esta consulta es sólo del celular de un punto.' }
  }
  if (!tipos.includes(punto.tipo)) {
    const donde = tipos.map((t) => NOMBRE_DEL_SITIO[t]).join(' o ')
    return { ok: false, error: `Esta consulta es de ${donde}, y ${punto.nombre} no lo es.` }
  }
  return { ok: true, valor: punto }
}

/**
 * contenedoresDelSitioEnTx y conteosRecientesEnTx piden una Sesion y no un
 * punto: la usan para decidir de qué punto se habla y, en /contenedores, para
 * saber si el pedido lo hizo esta cuenta. El filtro de verdad lo pone RLS con
 * la identidad que ya tiene la transacción; ésta se arma con esa misma
 * identidad (app.uid()) y el punto del contexto, así que dice lo mismo que la
 * sesión que abrió la pantalla.
 */
async function sesionDelPunto(tx: Conexion, punto: PuntoDeLaSesion): Promise<Sesion> {
  const [fila] = await tx.consultar<{ cuenta: string | null }>('select app.uid()::text as cuenta')
  return { perfilId: fila?.cuenta ?? '', rol: 'vigilador', sitioId: punto.id, nombre: punto.nombre }
}

/**
 * Los números que trae un nombre del catálogo: «tambor de 200 L», «Italia
 * 2800». No es texto libre —lo escribió la coordinación en Listas, no alguien
 * en la calle—, y si una respuesta dice «3 tambores de 200 L» el 200 tiene que
 * poder pasar el control.
 */
function cifras(texto: string | null | undefined): string[] {
  return texto?.match(/\d+/g) ?? []
}

function plural(cuantos: number, uno: string, varios: string): string {
  return `${cuantos} ${cuantos === 1 ? uno : varios}`
}

// ── Un movimiento, dicho para el celular ────────────────────────────────

/**
 * De dónde vino o a dónde fue, sin el nombre de la entidad. Los sitios sí se
 * nombran: son los diez del sistema y están en el catálogo que ya tiene el
 * modelo. Lo escrito a mano tampoco se repite: es texto libre.
 */
function lugarSinNombres(m: MovimientoListado): string {
  if (m.tipo === 'ingreso') {
    switch (m.origen_clase) {
      case 'vecino': return 'de un vecino'
      case 'sitio': return `de ${m.origen_nombre ?? 'otro sitio'}`
      case 'entidad': return 'de una procedencia de la lista'
      default: return 'de una procedencia escrita a mano'
    }
  }
  switch (m.destino_clase) {
    case 'vecino': return 'se lo llevó un vecino'
    case 'sitio': return `a ${m.destino_nombre ?? 'otro sitio'}`
    case 'entidad': return 'a un destino de la lista'
    default: return 'a un destino escrito a mano'
  }
}

/** Lo que /hoy dibuja de cada fila, en palabras. */
function filaDeHoy(m: MovimientoListado, numeros: Numeros) {
  const anulado = m.estado === 'anulado'
  const cuando = fechaHora(m.ocurrido_en)
  const cuanto = cantidadDeMovimiento(m)
  const valorizacion =
    m.flujo === 'punto_verde' && m.tipo === 'salida' && m.tipo_valorizacion
      ? ETIQUETA_VALORIZACION[m.tipo_valorizacion] ?? null
      : null

  numeros.agregar(m.numero).fecha(cuando)
  if (m.unidad_plural === null) numeros.agregar(m.items)
  else numeros.cantidad(m.cantidad_total, m.unidad_decimales ?? 0)
  numeros.agregar(...cifras(m.materiales), ...cifras(m.unidad_plural), ...cifras(m.unidad_nombre))
  numeros.agregar(...cifras(m.origen_clase === 'sitio' ? m.origen_nombre : null))
  numeros.agregar(...cifras(m.destino_clase === 'sitio' ? m.destino_nombre : null))

  return {
    numero: m.numero,
    cuando,
    tipo: ETIQUETA_TIPO[m.tipo] ?? m.tipo,
    estado: anulado ? 'anulado' : 'vigente',
    // La pantalla muestra el chip sólo en los vigentes: en uno anulado ya no importa.
    cargado_despues: m.carga_diferida && !anulado,
    materiales: m.materiales ?? 'sin material',
    cantidad: cuanto,
    lugar: lugarSinNombres(m),
    ...(valorizacion ? { para_que: valorizacion } : {}),
    ...(m.vecino_sin_datos ? { vecino_sin_datos: true } : {}),
  }
}

/**
 * Cuántos movimientos guarda el teléfono sin subir. Si los hay, el modelo lo
 * tiene que decir siempre, aunque no se lo pregunten: el error que se repite
 * es ver que en «Lo de hoy» falta lo que se cargó sin señal y cargarlo de
 * nuevo, y ahí queda dos veces.
 */
function notaDePendientes(contexto: ContextoDeHerramienta, numeros: Numeros): string | null {
  const cuantos = contexto.pendientesEnElCelular
  if (!cuantos || cuantos <= 0) return null
  numeros.agregar(cuantos)
  return cuantos === 1
    ? 'Hay 1 movimiento guardado en este teléfono que todavía no subió: sube solo cuando vuelva la señal. No hay que cargarlo de nuevo.'
    : `Hay ${cuantos} movimientos guardados en este teléfono que todavía no subieron: suben solos cuando vuelva la señal. No hay que cargarlos de nuevo.`
}

// ── lo_de_hoy ───────────────────────────────────────────────────────────

/** El tope de /hoy. movimientosDelTurnoEnTx no pasa de esto aunque se le pida más. */
const FILAS_DE_HOY = 100
/** Lo que viaja al modelo; el resto está en la pantalla. */
const FILAS_PARA_EL_MODELO = 15

const loDeHoy = definir<null>({
  nombre: 'lo_de_hoy',
  clase: 'lectura',
  roles: ['vigilador'],
  descripcion: () =>
    'Lo cargado hoy en este punto desde la medianoche, vigente y anulado, igual que la pantalla «Lo de hoy»: ' +
    'número de movimiento, hora, tipo, materiales, cantidad de cada uno, si quedó «cargado después», y cuántos hay ' +
    'vigentes, anulados y cargados después. NO trae un total de cantidades, porque la pantalla no lo muestra: si ' +
    'preguntan «cuánto entró hoy», decí movimiento por movimiento lo que se cargó, sin sumarlo, y mandá a la ' +
    'pantalla. No sirve para días anteriores ni para otro punto.',
  parametros: () => SIN_PARAMETROS,
  validar: (_entrada, contexto) => {
    const punto = exigirPunto(contexto)
    return punto.ok ? { ok: true, valor: null } : punto
  },
  estado: () => 'Mirando lo cargado hoy en tu punto…',
  ejecutar: async (tx, _entrada, contexto) => {
    const punto = contexto.punto!
    const filas = await movimientosDelTurnoEnTx(tx, FILAS_DE_HOY)
    const numeros = new Numeros()

    const vigentes = filas.filter((m) => m.estado === 'vigente')
    const anulados = filas.length - vigentes.length
    const cargadosDespues = vigentes.filter((m) => m.carga_diferida).length
    // Cuántos ingresos y cuántas salidas, contados acá. Es lo primero que se
    // pregunta —«cuánto cargué hoy»— y, sin esto, el modelo los contaba mirando
    // la lista: un número que no sale de ninguna consulta, y el control lo
    // rechazaba con razón (pasó en la primera prueba con gpt-4o-mini).
    const ingresos = vigentes.filter((m) => m.tipo === 'ingreso').length
    const salidas = vigentes.filter((m) => m.tipo === 'salida').length
    numeros.agregar(filas.length, vigentes.length, anulados, cargadosDespues, ingresos, salidas)

    const { filas: aMostrar, nota: recorte } = recortar(filas, FILAS_PARA_EL_MODELO)
    if (recorte) numeros.agregar(FILAS_PARA_EL_MODELO)
    const movimientos = aMostrar.map((m) => filaDeHoy(m, numeros))

    const alcance = alcanceDelCelular(punto.nombre, 'lo cargado hoy desde la medianoche, vigente y anulado; el día todavía no terminó')
    numeros.sumar(alcance.numeros)

    const notas = [
      filas.length >= FILAS_DE_HOY
        ? `La pantalla muestra hasta ${FILAS_DE_HOY} movimientos del día: puede haber más.`
        : null,
      notaDePendientes(contexto, numeros),
    ].filter(Boolean)
    if (filas.length >= FILAS_DE_HOY) numeros.agregar(FILAS_DE_HOY)

    return {
      alcance: alcance.frase,
      datos: {
        total: filas.length,
        vigentes: vigentes.length,
        ingresos_vigentes: ingresos,
        salidas_vigentes: salidas,
        anulados,
        cargados_despues: cargadosDespues,
        movimientos,
        ...(recorte ? { recorte } : {}),
        pendientes_en_el_celular: contexto.pendientesEnElCelular,
      },
      enlaces: [enlace('Lo de hoy', '/hoy', {}, 'filas')],
      numeros: numeros.agregar(contexto.pendientesEnElCelular).lista(),
      ...(notas.length ? { nota: notas.join(' ') } : {}),
    }
  },
})

// ── buscar_movimiento ───────────────────────────────────────────────────

/** Como /listo: un número entero tiene 0 decimales y uno partido, 2. */
function textoDelItem(i: ItemListado, numeros: Numeros): string {
  const n = Number(i.cantidad)
  const decimales = Number.isInteger(n) ? 0 : 2
  numeros.cantidad(n, decimales).agregar(...cifras(i.material_nombre), ...cifras(i.unidad_plural), ...cifras(i.unidad_nombre))
  return `${i.material_nombre}: ${cantidad(n, { nombre: i.unidad_nombre, nombre_plural: i.unidad_plural, decimales })}`
}

const buscarMovimiento = definir<number>({
  nombre: 'buscar_movimiento',
  clase: 'lectura',
  roles: ['vigilador'],
  descripcion: () =>
    'La ficha de un movimiento de este punto por su número, igual que el comprobante del celular: qué se cargó, ' +
    'cuánto, cuándo pasó, cuándo se cargó, si está anulado y si todavía se puede deshacer. Sólo encuentra lo cargado ' +
    `en este punto en las últimas ${HORAS_VISIBLES_EN_EL_CELULAR} horas: si no aparece, NO digas que no existe.`,
  parametros: () => ({
    type: 'object',
    properties: {
      numero: { type: 'integer', description: 'El número de movimiento, el que aparece grande en el comprobante.' },
    },
    required: ['numero'],
    additionalProperties: false,
  }),
  validar: (entrada, contexto) => {
    const punto = exigirPunto(contexto)
    if (!punto.ok) return punto
    const numero = (entrada as { numero?: unknown } | null)?.numero
    if (typeof numero !== 'number' || !Number.isInteger(numero) || numero <= 0 || numero > 2_000_000_000) {
      return { ok: false, error: 'El número de movimiento es un entero mayor que cero.' }
    }
    return { ok: true, valor: numero }
  },
  estado: (numero) => `Buscando el movimiento ${numero}…`,
  ejecutar: async (tx, numero, contexto) => {
    const punto = contexto.punto!
    const numeros = new Numeros().agregar(numero)

    // Lo mismo que /listo/[numero]: primero el id por número, con RLS, y
    // después la ficha. Si RLS no lo deja ver, la primera no devuelve nada.
    const [fila] = await tx.consultar<{ id: string }>('select id from v_movimientos where numero = $1', [numero])
    const detalle = fila ? await movimientoPorIdEnTx(tx, fila.id) : null

    if (!detalle) {
      // No se puede distinguir «no existe» de «es de otro punto» o «se cargó
      // hace más de 48 horas»: las tres le devuelven cero filas al celular. Y
      // aunque se pudiera, decir cuál sería contarle algo que no puede ver.
      const alcance = alcanceDelCelular(punto.nombre, `el movimiento ${numero}`)
      return {
        alcance: alcance.frase,
        datos: {
          encontrado: false,
          numero,
          explicacion:
            `El ${numero} no está entre lo cargado en ${punto.nombre} en las últimas ${HORAS_VISIBLES_EN_EL_CELULAR} horas. ` +
            'Puede ser de antes, o de otro punto: eso lo ve la coordinación.',
        },
        enlaces: [enlace('Lo de hoy', '/hoy', {}, 'filas')],
        numeros: numeros.sumar(alcance.numeros).lista(),
      }
    }

    const { movimiento: m, items } = detalle
    const anulado = m.estado === 'anulado'
    const sesion = await sesionDelPunto(tx, punto)

    // La misma cuenta que hace /listo para mostrar «Deshacer». La base repite
    // la regla en movimientos_deshacer, así que un sí de acá no deshace nada:
    // sólo dice si el botón está.
    const minutos = (contexto.ahora.getTime() - new Date(m.creado_en).getTime()) / 60_000
    const esDeEstaCuenta = m.cargado_por_id === sesion.perfilId
    const sePuedeDeshacer = !anulado && esDeEstaCuenta && minutos < MINUTOS_PARA_DESHACER
    const quedan = sePuedeDeshacer ? Math.max(1, Math.floor(MINUTOS_PARA_DESHACER - minutos)) : null

    const cuando = fechaHora(m.ocurrido_en)
    const cargado = fechaHora(m.creado_en)
    numeros.fecha(cuando).fecha(cargado).agregar(MINUTOS_PARA_DESHACER, quedan)
    numeros.agregar(...cifras(m.origen_clase === 'sitio' ? m.origen_nombre : null))
    numeros.agregar(...cifras(m.destino_clase === 'sitio' ? m.destino_nombre : null))

    const porQueNo = sePuedeDeshacer
      ? null
      : anulado
        ? 'ya está anulado'
        : !esDeEstaCuenta
          ? 'no lo cargó esta cuenta'
          : `pasaron más de ${MINUTOS_PARA_DESHACER} minutos desde que se cargó: la anulación la hace la coordinación, con el número de movimiento`

    const alcance = alcanceDelCelular(punto.nombre, `el movimiento ${m.numero}`)
    return {
      alcance: alcance.frase,
      datos: {
        encontrado: true,
        numero: m.numero,
        tipo: ETIQUETA_TIPO[m.tipo] ?? m.tipo,
        estado: anulado ? 'anulado' : 'vigente',
        que: items.map((i) => textoDelItem(i, numeros)),
        lugar: lugarSinNombres(m),
        cuando_paso: cuando,
        cuando_se_cargo: cargado,
        cargado_despues: m.carga_diferida && !anulado,
        se_puede_deshacer: sePuedeDeshacer,
        ...(quedan !== null ? { minutos_que_quedan_para_deshacer: quedan } : {}),
        ...(porQueNo ? { por_que_no_se_puede_deshacer: porQueNo } : {}),
        ...(anulado && m.motivo_anulacion ? { motivo_de_la_anulacion: aMano(m.motivo_anulacion) } : {}),
        ...(m.observaciones ? { observaciones: aMano(m.observaciones) } : {}),
      },
      enlaces: [enlace(`Movimiento ${m.numero}`, `/listo/${m.numero}`, {}, 'filas')],
      numeros: numeros.sumar(alcance.numeros).lista(),
    }
  },
})

// ── contenedores ────────────────────────────────────────────────────────
// Copia de lo que calcula src/app/(vigilador)/contenedores/page.tsx para
// dibujar cada tarjeta. Está copiado y no importado porque vive adentro de la
// página; si la página cambia cómo dice la espera o el último retiro, esto
// tiene que cambiar con ella.

/** «hace 4 horas», «hace 2 días»: de las horas que calculó la vista, como la pantalla. */
function esperaEscrita(horas: number, numeros: Numeros): string {
  if (!Number.isFinite(horas) || horas < 0) return 'sin hora de pedido'
  if (horas < 1) return 'recién'
  if (horas < 24) {
    const h = Math.floor(horas)
    numeros.agregar(h)
    return `hace ${plural(h, 'hora', 'horas')}`
  }
  const d = Math.floor(horas / 24)
  numeros.agregar(d)
  return `hace ${plural(d, 'día', 'días')}`
}

/**
 * Cuántos días pasaron desde una fecha de calendario, comparando las dos
 * puntas como aaaa-mm-dd. `ultima_retirada` es un `date`: restarlo como
 * instante lee un retiro de ayer como de hace dos días.
 */
function diasDesdeCalendario(valor: string | null, ahora: Date): number | null {
  const clave = claveDeCalendario(valor)
  if (!clave) return null
  const dia = Date.parse(`${clave}T00:00:00Z`)
  const hoy = Date.parse(`${paraInputFechaHora(ahora).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(dia) || Number.isNaN(hoy)) return null
  return Math.round((hoy - dia) / 86_400_000)
}

function ultimoRetiro(valor: string | null, ahora: Date, numeros: Numeros): string {
  if (!valor) return 'sin registro'
  const dias = diasDesdeCalendario(valor, ahora)
  const dia = fechaDeCalendario(valor)
  numeros.fecha(dia)
  if (dias === null || dias < 0) return dia
  if (dias === 0) return `${dia}, hoy`
  if (dias === 1) return `${dia}, ayer`
  numeros.agregar(dias)
  return `${dia}, hace ${dias} días`
}

/**
 * Las tres condiciones de pedidos_cancelar (0018), las mismas con que la
 * pantalla decide si muestra «Cancelar el pedido». Va el porqué cuando no se
 * puede: «¿puedo cancelar el de ayer?» casi siempre se contesta con la razón.
 */
function cancelacion(pedido: PedidoRecambio, cuenta: string, numeros: Numeros) {
  const horas = Number(pedido.horas_totales)
  if (pedido.estado !== 'pedido') {
    return { se_puede_cancelar: false, por_que_no: 'la coordinación ya avisó a la empresa' }
  }
  if (pedido.pedido_por_id !== cuenta) {
    return { se_puede_cancelar: false, por_que_no: 'lo cargó la coordinación para este punto' }
  }
  if (!Number.isFinite(horas) || horas >= HORAS_PARA_CANCELAR_PEDIDO) {
    numeros.agregar(HORAS_PARA_CANCELAR_PEDIDO)
    return { se_puede_cancelar: false, por_que_no: `pasaron más de ${HORAS_PARA_CANCELAR_PEDIDO} horas desde que se pidió` }
  }
  return { se_puede_cancelar: true }
}

const contenedores = definir<null>({
  nombre: 'contenedores',
  clase: 'lectura',
  roles: ['vigilador'],
  tiposDeSitio: ['punto_verde'],
  descripcion: () =>
    'Los contenedores de este punto, igual que la pantalla «Contenedores»: de qué corriente es cada uno, si tiene ' +
    'un pedido de recambio abierto (hace cuánto se pidió, si es urgente, si la coordinación ya avisó a la empresa, ' +
    'si está demorado y si todavía se puede cancelar) y cuándo fue el último retiro. Para «¿ya pedí el de cartón?», ' +
    '«¿ya avisaron?», «¿puedo cancelarlo?». No sirve para otro punto.',
  parametros: () => SIN_PARAMETROS,
  validar: (_entrada, contexto) => {
    const punto = exigirPunto(contexto, ['punto_verde'])
    return punto.ok ? { ok: true, valor: null } : punto
  },
  estado: () => 'Mirando los contenedores de tu punto…',
  ejecutar: async (tx, _entrada, contexto) => {
    const punto = contexto.punto!
    const sesion = await sesionDelPunto(tx, punto)
    const [lista, pedidos] = await Promise.all([
      contenedoresDelSitioEnTx(tx, sesion),
      pedidosDeRecambioEnTx(tx, { estado: 'abiertos', sitioId: punto.id }),
    ])
    const numeros = new Numeros()

    // Como la pantalla: si un contenedor tuviera dos abiertos, manda el
    // primero de la cola, que es el que la coordinación va a atender.
    const porContenedor = new Map<string, PedidoRecambio>()
    for (const p of pedidos) {
      if (p.contenedor_id && !porContenedor.has(p.contenedor_id)) porContenedor.set(p.contenedor_id, p)
    }

    const filas = lista.map((c) => {
      const pedido = porContenedor.get(c.id) ?? null
      const corriente = c.material ?? c.codigo
      numeros.agregar(...cifras(corriente))
      if (!pedido) {
        return { corriente, pedido_abierto: false, ultimo_retiro: ultimoRetiro(c.ultima_retirada, contexto.ahora, numeros) }
      }
      const pedidoEl = fechaHora(pedido.pedido_en)
      numeros.fecha(pedidoEl)
      if (pedido.demorado) numeros.agregar(DIAS_PARA_PEDIDO_DEMORADO)
      return {
        corriente,
        pedido_abierto: true,
        pedido: esperaEscrita(Number(pedido.horas_totales), numeros),
        pedido_el: pedidoEl,
        urgente: Boolean(pedido.urgente),
        aviso_a_la_empresa: pedido.estado === 'avisado' ? 'la coordinación ya avisó' : 'la coordinación todavía no avisó',
        demorado: Boolean(pedido.demorado),
        ...cancelacion(pedido, sesion.perfilId, numeros),
        ...(pedido.observaciones ? { nota_del_pedido: aMano(pedido.observaciones) } : {}),
        ultimo_retiro: ultimoRetiro(c.ultima_retirada, contexto.ahora, numeros),
      }
    })

    const { filas: aMostrar, nota: recorte } = recortar(filas, FILAS_PARA_EL_MODELO)
    const abiertos = filas.filter((f) => f.pedido_abierto).length
    numeros.agregar(filas.length, abiertos)
    if (recorte) numeros.agregar(FILAS_PARA_EL_MODELO)

    return {
      alcance: `${punto.nombre}, sus contenedores y los pedidos de recambio abiertos ahora`,
      datos: {
        contenedores: filas.length,
        con_pedido_abierto: abiertos,
        lista: aMostrar,
        ...(recorte ? { recorte } : {}),
        ...(filas.length === 0
          ? { explicacion: 'Este punto no tiene contenedores cargados. Los carga la coordinadora desde el panel.' }
          : {}),
      },
      enlaces: [enlace('Contenedores', '/contenedores', {}, 'filas')],
      numeros: numeros.lista(),
      ...(pedidos.some((p) => p.demorado)
        ? { nota: `«Demorado» quiere decir que el pedido está abierto hace más de ${DIAS_PARA_PEDIDO_DEMORADO} días.` }
        : {}),
    }
  },
})

// ── conteos_del_punto ───────────────────────────────────────────────────
// Los días que dibuja /conteo: hoy y la ventana para atrás en que el celular
// todavía puede cargar o corregir. Copia del armado de la página, que vive
// adentro de ella.

function conMayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

const conteosDelPunto = definir<null>({
  nombre: 'conteos_del_punto',
  clase: 'lectura',
  roles: ['vigilador'],
  tiposDeSitio: ['punto_verde'],
  descripcion: () =>
    `El conteo diario de vecinos de este punto, hoy y los ${DIAS_DE_CONTEO_PARA_ATRAS} días anteriores, igual que la ` +
    'pantalla «Conteo del día»: el total cargado de cada día, o que ese día está sin cargar (que no es lo mismo que ' +
    'cero). Para «¿cuántos vecinos vinieron ayer?», «¿cargué el conteo del martes?». Días más viejos y otros puntos, no.',
  parametros: () => SIN_PARAMETROS,
  validar: (_entrada, contexto) => {
    const punto = exigirPunto(contexto, ['punto_verde'])
    return punto.ok ? { ok: true, valor: null } : punto
  },
  estado: () => 'Mirando el conteo de vecinos de tu punto…',
  ejecutar: async (tx, _entrada, contexto) => {
    const punto = contexto.punto!
    const sesion = await sesionDelPunto(tx, punto)
    const conteos = await conteosRecientesEnTx(tx, sesion, { dias: DIAS_DE_CONTEO_PARA_ATRAS })
    const numeros = new Numeros().agregar(DIAS_DE_CONTEO_PARA_ATRAS)

    // Las columnas `date` vuelven como Date a medianoche UTC: la clave sale de
    // leerlas en UTC, no de formatearlas en hora de Tucumán.
    const cargados = new Map(conteos.map((c) => [claveDeCalendario(c.fecha), c]))
    const hoy = hoyEnTucuman(contexto.ahora)
    const mediodia = desdeInputFechaHora(`${hoy}T12:00`) ?? contexto.ahora

    const dias = []
    for (let atras = 0; atras <= DIAS_DE_CONTEO_PARA_ATRAS; atras++) {
      // Tucumán no cambia de hora: restarle un día al mediodía cae siempre al
      // mediodía del día anterior, lejos de cualquier borde.
      const cuando = new Date(mediodia.getTime() - atras * 86_400_000)
      const clave = paraInputFechaHora(cuando).slice(0, 10)
      const escrito = diaSemana(cuando).replace(',', '')
      const relativo = atras === 0 ? 'hoy' : atras === 1 ? 'ayer' : null
      const dia = fecha(cuando)
      numeros.fecha(dia).fecha(escrito)

      const cargado = cargados.get(clave)
      const vecinos = cargado ? Number(cargado.vecinos) : null
      if (vecinos !== null) numeros.agregar(vecinos)

      dias.push({
        dia: relativo ? `${relativo}, ${escrito}` : conMayuscula(escrito),
        fecha: dia,
        vecinos: vecinos === null ? 'sin cargar' : vecinos,
        ...(cargado?.observaciones ? { observaciones: aMano(cargado.observaciones) } : {}),
      })
    }

    const sinCargar = dias.filter((d) => d.vecinos === 'sin cargar').length
    numeros.agregar(sinCargar, dias.length)

    // El aviso de la pantalla, dicho para el modelo. En un punto que carga de a
    // un vecino, el conteo del día es sólo para el día que no se pudo: un «sin
    // cargar» ahí no quiere decir que no vino nadie.
    const nota = punto.cargaDetallada
      ? 'En este punto los vecinos se cargan de a uno. El conteo del día es sólo para el día que no se pudo: los vecinos cargados de a uno no están en estos totales, y un día «sin cargar» no quiere decir que no vino nadie.'
      : 'En este punto el conteo se lleva en papel y se carga una sola vez al cerrar el día. Un día «sin cargar» no es un cero: si no vino nadie, se carga un cero.'

    return {
      alcance: `${punto.nombre}, conteo diario de vecinos de hoy y los ${DIAS_DE_CONTEO_PARA_ATRAS} días anteriores; el de hoy todavía puede cambiar`,
      datos: { dias, dias_sin_cargar: sinCargar },
      enlaces: [enlace('Conteo del día', '/conteo', {}, 'filas')],
      numeros: numeros.lista(),
      nota,
    }
  },
})

// ── pilas_del_predio ────────────────────────────────────────────────────
// Lista cerrada de columnas. De v_pilas NO sale nada más: los m³ y la cantidad
// de ingresos y salidas se calculan desde movimientos, que el celular ve
// recortados a 48 horas, así que para el vigilador dan un número chico y
// falso; el responsable es una persona; y los volteos, riegos y el último
// volteo salen de pila_controles_proceso, mientras que /pila anota en
// pila_controles (ver «Defectos» en DISENO-v2). Esos tres dirían «nunca se
// volteó» de una pila que el vigilador volteó ayer.

const ETIQUETA_ESTADO: Record<EstadoPila, string> = {
  en_formacion: 'en formación',
  madurando: 'madurando',
  lista: 'lista',
  despachada: 'despachada',
}

/** El orden del trabajo, como /pila: primero lo que todavía se trabaja. */
const ORDEN_ESTADO: Record<EstadoPila, number> = {
  en_formacion: 0,
  madurando: 1,
  lista: 2,
  despachada: 3,
}

/**
 * «madura en 14 días», «lista hace 2 meses». Copia de rotuloMadurez en
 * src/app/(vigilador)/cargar/[tipo]/FormularioMovimiento.tsx, que es como el
 * celular ya lo dice al elegir la pila de un ingreso.
 */
function madurezEscrita(p: FilaPila, numeros: Numeros): string {
  if (p.dias_para_madurez === null || p.dias_para_madurez === undefined) return 'sin fecha de madurez'
  const dias = Number(p.dias_para_madurez)
  if (!Number.isFinite(dias)) return 'sin fecha de madurez'
  numeros.agregar(dias, Math.abs(dias))

  if (dias > 0) {
    if (dias >= 60) {
      const meses = Math.round(dias / 30)
      numeros.agregar(meses)
      return `madura en ${meses} meses`
    }
    return `madura en ${plural(dias, 'día', 'días')}`
  }
  const pasados = -dias
  if (pasados === 0) return 'lista hoy'
  if (pasados < 45) return `lista hace ${plural(pasados, 'día', 'días')}`
  const meses = Math.round(pasados / 30)
  numeros.agregar(meses)
  return `lista hace ${plural(meses, 'mes', 'meses')}`
}

const NOTA_DE_VOLTEOS =
  'Los volteos anotados desde el celular todavía no se reflejan en el tablero de pilas: por eso no digo cuántos ' +
  'volteos o riegos lleva cada una ni cuándo fue el último. Lo anotado quedó guardado y se ve en la ficha de cada pila.'

const pilasDelPredio = definir<null>({
  nombre: 'pilas_del_predio',
  clase: 'lectura',
  roles: ['vigilador'],
  tiposDeSitio: ['planta'],
  descripcion: () =>
    'Las pilas de compost activas de este predio: código, estado, fecha de armado, fecha de cierre, fecha de madurez ' +
    'y cuánto falta para que madure. NO trae volteos, riegos, temperaturas, m³ ni quién es responsable. Para «¿qué ' +
    'pilas están madurando?», «¿cuándo se cerró tal pila?», «¿cuánto le falta para madurar?».',
  parametros: () => SIN_PARAMETROS,
  validar: (_entrada, contexto) => {
    const punto = exigirPunto(contexto, ['planta'])
    return punto.ok ? { ok: true, valor: null } : punto
  },
  estado: () => 'Mirando las pilas del predio…',
  ejecutar: async (tx, _entrada, contexto) => {
    const punto = contexto.punto!
    const lista = await pilasEnTx(tx, { sitioId: punto.id })
    const numeros = new Numeros()

    const ordenadas = [...lista].sort(
      (a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || a.codigo.localeCompare(b.codigo, 'es'),
    )
    const pilas = ordenadas.map((p) => {
      const armado = p.fecha_armado ? fechaDeCalendario(p.fecha_armado) : null
      const cierre = p.fecha_cierre ? fechaDeCalendario(p.fecha_cierre) : null
      const madurez = p.madurez ? fechaDeCalendario(p.madurez) : null
      numeros.agregar(...cifras(p.codigo)).fecha(armado).fecha(cierre).fecha(madurez)
      return {
        codigo: p.codigo,
        estado: ETIQUETA_ESTADO[p.estado] ?? p.estado,
        fecha_armado: armado ?? 'sin fecha',
        fecha_cierre: cierre ?? 'sin cerrar',
        madurez: madurez ?? 'sin fecha de madurez',
        dias_para_madurez: madurezEscrita(p, numeros),
        // Sin cierre no hay madurez calculada ni aviso de volteo. Pasa con las
        // que creó la importación del histórico: quedaron madurando sin fecha.
        ...(!p.fecha_cierre && p.estado !== 'en_formacion'
          ? { falta: 'la fecha de cierre: hasta que la coordinación la cargue, no se puede calcular cuándo madura' }
          : {}),
      }
    })
    const { filas: aMostrar, nota: recorte } = recortar(pilas, FILAS_PARA_EL_MODELO)
    numeros.agregar(pilas.length)
    if (recorte) numeros.agregar(FILAS_PARA_EL_MODELO)

    return {
      alcance: `${punto.nombre}, las pilas activas del predio`,
      datos: {
        pilas: pilas.length,
        lista: aMostrar,
        ...(recorte ? { recorte } : {}),
        ...(pilas.length === 0
          ? { explicacion: 'Este predio no tiene pilas cargadas. Las abre la coordinadora desde el panel.' }
          : {}),
      },
      enlaces: [enlace('Control de las pilas', '/pila', {}, 'filas')],
      numeros: numeros.lista(),
      nota: NOTA_DE_VOLTEOS,
    }
  },
})

// ── Lo que se exporta ───────────────────────────────────────────────────

export const HERRAMIENTAS_DEL_VIGILADOR: Herramienta[] = [
  loDeHoy,
  buscarMovimiento,
  contenedores,
  conteosDelPunto,
  pilasDelPredio,
]
