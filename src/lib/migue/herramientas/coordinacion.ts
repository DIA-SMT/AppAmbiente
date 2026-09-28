/**
 * Las herramientas de la coordinación.
 *
 * Cada una es una pantalla del panel dicha en voz alta. No hay una sola que
 * calcule algo propio: cuentan y suman con la misma función que usa la
 * pantalla que enlazan, con los mismos filtros, y cuando la pantalla arma el
 * número en JavaScript la cuenta se copia tal cual, con el caso que la
 * explica. La razón es una sola: el enlace que va debajo de la respuesta
 * promete que ahí está ese número. Si la herramienta contara distinto —un
 * WHERE escrito de nuevo, un corte de fechas corrido una hora—, la
 * coordinadora abre la pantalla, ve otra cifra y deja de creerle a las dos.
 *
 * Tres cosas que valen para todas y que no se repiten en cada una:
 *
 *  · sin nombres de personas: ni chofer, ni autorizante, ni quién cargó,
 *    pidió, avisó o anotó. Las pantallas los muestran porque ahí se ven con
 *    contexto y quedan en la auditoría; un chat es una exportación con otro
 *    nombre. Los nombres de destinos y orígenes sí van: son la respuesta a
 *    «a quién le mandamos el compost»;
 *  · lo que alguien escribió a mano —observaciones, destinos que no estaban
 *    en la lista, motivos de anulación— va con aMano(), y sus números no se
 *    pueden citar;
 *  · cada número que aparece en `datos` o en `alcance` entra a `numeros` en el
 *    mismo momento en que se escribe, por las funciones de abajo. Juntarlos
 *    después, recorriendo el texto, es justamente lo que no hay que hacer.
 */
import 'server-only'

import type { Conexion } from '@db/client'
import type { Sesion } from '@db/sesion'
import {
  buscarMovimientosEnTx, contarMovimientosEnTx, conteosRecientesEnTx,
  destinosAFormalizarEnTx, entidadesPendientesEnTx, metrosCubicosPorTipo, movimientoPorIdEnTx,
  pedidosDeRecambioEnTx, pilaPorIdEnTx, pilasEnTx, puntosSinCargaEnTx, respuestaDeRecambioEnTx,
  resumenMensualEnTx, resumenVecinosEnTx, sitiosVisiblesEnTx, totalesDeMovimientosEnTx,
  trazaDeSalidaEnTx, trazabilidadDeSalidasEnTx,
} from '@/lib/datos'
import {
  ETIQUETA_ENTIDAD, ETIQUETA_FLUJO, ETIQUETA_TIPO, ETIQUETA_VALORIZACION,
  cantidad, cantidadDeMovimiento, claveDeCalendario, diaSemana, fecha, fechaDeCalendario, fechaHora, mesLargo, numero,
} from '@/lib/formato'
import {
  DIAS_PARA_PEDIDO_DEMORADO, DIAS_PARA_PUNTO_CALLADO as DIAS_DE_ALERTA, VECES_PARA_DESTINO_REPETIDO as SE_REPITE,
} from '@/lib/reglas'
import type {
  ConteoDiario, EstadoMovimiento, EstadoPila, FilaPila, FiltrosMovimientos, Flujo, PedidoRecambio,
  TipoControl, TrazaDeSalida,
} from '@/lib/tipos'

import type { Catalogo, EsquemaDeParametros, Herramienta, Resultado, Validacion } from '../tipos'
import {
  Numeros, PERIODOS, TODOS, aMano, enlace, enumCon, fechasDeMas, hayFechas, hoyEnTucuman, idDeMaterial, idDePunto,
  propiedadesDePeriodo, recortar, resolverPeriodo, type PeriodoResuelto,
} from './comunes'

/** Cuántas filas se le muestran al modelo. El resto está en la pantalla del enlace. */
const FILAS_MAXIMAS = 15

/**
 * Lo que puede ocupar un detalle en `datos`, en caracteres de JSON. El tope
 * del diseño es 8 KB para todo el resultado: esto deja lugar al resto.
 */
const LARGO_MAXIMO = 7_000

const DIA = 86_400_000

// ── Armado ──────────────────────────────────────────────────────────────

/**
 * Herramienta<E> no entra en una lista de Herramienta<unknown>: estado() y
 * ejecutar() reciben E, y una función que pide algo preciso no acepta
 * cualquier cosa. La lista es heterogénea a propósito —cada herramienta tiene
 * su entrada—, y lo que garantiza que a ejecutar() le llegue su E es que el
 * orquestador sólo le pasa lo que devolvió su propio validar().
 */
function definir<E>(herramienta: Herramienta<E>): Herramienta {
  return herramienta as unknown as Herramienta
}

function esquema(propiedades: Record<string, unknown>): EsquemaDeParametros {
  return {
    type: 'object',
    properties: propiedades,
    required: Object.keys(propiedades),
    additionalProperties: false,
  }
}

function campos(entrada: unknown): Record<string, unknown> {
  return entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada)
    ? (entrada as Record<string, unknown>)
    : {}
}

const cadena = (valor: unknown) => (typeof valor === 'string' ? valor.trim() : '')

function elegir<T extends string>(valor: unknown, opciones: readonly T[], campo: string): Validacion<T> {
  const texto = cadena(valor)
  if ((opciones as readonly string[]).includes(texto)) return { ok: true, valor: texto as T }
  return { ok: false, error: `«${texto}» no es un valor posible de ${campo}. Van: ${opciones.join(', ')}.` }
}

/** Una consulta que no llegó a hacerse: lo que se buscaba dejó de existir entre la pregunta y la consulta. */
function sinConsulta(mensaje: string, numeros: number[] = []): Resultado {
  return { alcance: mensaje, datos: { error: mensaje }, enlaces: [], numeros }
}

async function hay(tx: Conexion, subconsulta: string, parametros: unknown[] = []): Promise<boolean> {
  const [fila] = await tx.consultar<{ hay: boolean }>(`select exists (${subconsulta}) as hay`, parametros)
  return Boolean(fila?.hay)
}

// ── Lo que se dice, y sus números ───────────────────────────────────────
// Cada función de acá escribe un valor como lo dibuja la pantalla y, en el
// mismo paso, anota sus números. Así no hay manera de poner una cifra en
// `datos` y olvidarse de habilitarla.

/** Una cantidad con los decimales de la pantalla: «2.969,3». */
function cifra(numeros: Numeros, valor: number | string | null | undefined, decimales = 0): string {
  numeros.cantidad(valor, decimales)
  return numero(valor, decimales)
}

/** Una fecha ya formateada: «28/09/2026 · 14:32». */
function dicha(numeros: Numeros, formateada: string): string {
  numeros.fecha(formateada)
  return formateada
}

/**
 * Un nombre que sale de una lista —un punto, un material, un destino
 * habilitado, una patente—. Sus dígitos se pueden decir: «PV-03», «tambor de
 * 200 L», «Planta de transferencia 9 de Julio». fecha() junta cada grupo de
 * dígitos, que es lo mismo que hace falta acá. Nunca para texto libre.
 */
function nombrado(numeros: Numeros, nombre: string): string
function nombrado(numeros: Numeros, nombre: string | null): string | null
function nombrado(numeros: Numeros, nombre: string | null): string | null {
  if (nombre) numeros.fecha(nombre)
  return nombre
}

/** Kilos, bolsas y camiones son enteros; los m³ no. Como en la ficha del movimiento. */
const decimalesDe = (valor: number) => (Number.isInteger(valor) ? 0 : 2)

/** «12 bolsas», «4,50 m³»: la cantidad con su unidad, como la dibuja la ficha. */
function conUnidad(
  numeros: Numeros,
  valor: number | string,
  unidad: { nombre: string; plural: string },
): string {
  const n = Number(valor)
  const decimales = decimalesDe(n)
  numeros.cantidad(n, decimales)
  nombrado(numeros, unidad.plural)
  return cantidad(n, { nombre: unidad.nombre, nombre_plural: unidad.plural, decimales })
}

/**
 * La cantidad total de un movimiento como la dibuja la columna de la ficha de
 * la pila: con los decimales de la unidad, no con los de conUnidad. Una salida
 * de 4,25 m³ se ve «4,3 m³» en /pilas/<id>, porque el m³ tiene un decimal; si
 * Migue dijera «4,25» y la persona repitiera «la de 4,3» que ve en la pantalla
 * del enlace, el verificador la rechazaría. Se anotan las dos cifras, la cruda
 * y la redondeada, como en toda cantidad.
 */
function cantidadComoLaFicha(
  numeros: Numeros,
  c: {
    items: number | string
    cantidad_total: number | string | null
    unidad_nombre: string | null
    unidad_plural: string | null
    unidad_decimales: number | null
  },
): string {
  const items = Number(c.items)
  // Mezcla de unidades: la ficha dice «3 materiales», y el 3 es lo que se cita.
  if (c.unidad_plural === null) {
    numeros.agregar(items)
  } else {
    numeros.cantidad(c.cantidad_total, c.unidad_decimales ?? 0)
    nombrado(numeros, c.unidad_plural)
  }
  return cantidadDeMovimiento({
    items,
    cantidad_total: c.cantidad_total,
    unidad_nombre: c.unidad_nombre,
    unidad_plural: c.unidad_plural,
    unidad_decimales: c.unidad_decimales,
  })
}

function recortarContando<T>(numeros: Numeros, filas: T[]): { filas: T[]; nota: string | null } {
  const recorte = recortar(filas, FILAS_MAXIMAS)
  if (recorte.nota) numeros.agregar(FILAS_MAXIMAS, filas.length)
  return recorte
}

function codigosDePuntosVerdes(catalogo: Catalogo): string[] {
  return catalogo.puntos.filter((p) => p.tipo === 'punto_verde').map((p) => p.codigo)
}


/** El cierre de todo alcance que llega hasta hoy. */
const TODAVIA_PUEDE_CRECER = 'hoy todavía no terminó, así que puede crecer'

// ── Fechas de calendario ────────────────────────────────────────────────

/** Mediodía de Tucumán: ninguna conversión de zona corre el día ni el mes. */
const instanteDeDia = (clave: string) => `${clave}T12:00:00-03:00`
const instanteDeMes = (clave: string) => `${clave}-01T12:00:00-03:00`

function restarDias(clave: string, dias: number): string {
  const [a, m, d] = clave.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d) - dias * DIA).toISOString().slice(0, 10)
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA)
}

function restarMeses(clave: string, cantidadDeMeses: number): string {
  const [anio, mes] = clave.split('-').map(Number)
  const total = anio * 12 + (mes - 1) - cantidadDeMeses
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`
}

function mesesEntre(desde: string, hasta: string): number {
  const [a1, m1] = desde.split('-').map(Number)
  const [a2, m2] = hasta.split('-').map(Number)
  return (a2 * 12 + m2) - (a1 * 12 + m1)
}

/** «agosto de 2026», con sus números. */
function mesDicho(numeros: Numeros, clave: string): string {
  const [anio, mes] = clave.split('-').map(Number)
  numeros.agregar(anio, mes)
  return mesLargo(instanteDeMes(clave)).toLowerCase()
}

// ── Períodos con «todo» ─────────────────────────────────────────────────
// /movimientos y /trazabilidad se pueden mirar sin fechas: «¿cuántos anulados
// hay?» no tiene período. El resto de las herramientas no lo ofrece, porque
// sus pantallas siempre tienen uno.

const PERIODOS_CON_TODO = [...PERIODOS, 'todo'] as const

function propiedadesDePeriodoConTodo(): Record<string, unknown> {
  const propias = propiedadesDePeriodo()
  return {
    ...propias,
    periodo: {
      type: 'string',
      enum: [...PERIODOS_CON_TODO],
      description:
        'El período. Las semanas van de lunes a domingo. «todo» es sin límite de fechas: todo lo registrado. «rango» sólo si la persona dio fechas precisas o un mes con nombre; en ese caso completá desde y hasta.',
    },
  }
}

/** null es «todo lo registrado». */
function leerPeriodo(valores: Record<string, unknown>, ahora: Date): Validacion<PeriodoResuelto | null> {
  const periodo = cadena(valores.periodo)
  // «todo» con fechas es la misma confusión que mes_pasado con fechas (ver
  // resolverPeriodo): si se ignoraran, la respuesta sumaría todo lo registrado
  // y el modelo lo diría como el rango que pidió la persona.
  if (periodo === 'todo') {
    if (hayFechas(cadena(valores.desde), cadena(valores.hasta))) return { ok: false, error: fechasDeMas(periodo) }
    return { ok: true, valor: null }
  }
  return resolverPeriodo(periodo, cadena(valores.desde), cadena(valores.hasta), ahora)
}

function fraseDePeriodo(numeros: Numeros, periodo: PeriodoResuelto | null): string {
  if (!periodo) return 'todo lo registrado'
  numeros.sumar(periodo.numeros)
  return periodo.frase
}

// ── planta_por_mes ──────────────────────────────────────────────────────
// Lo que dibuja /tablero: el gráfico de m³ por mes y la tabla de cantidades
// por material. La consulta es resumenMensualEnTx, la misma de la pantalla; lo
// que sigue es el armado que la pantalla hace en JavaScript, copiado tal cual.
// Vive dentro de tablero/page.tsx, entre líneas de fechas que otro trabajo
// está tocando: cuando eso se integre, lo correcto es moverlo a datos.ts y que
// las dos lo usen.

/** Los tres largos que ofrece /tablero. Más atrás de 24 meses la pantalla no llega. */
const VENTANAS_DEL_TABLERO = [6, 12, 24] as const

interface EntradaPlantaPorMes {
  desde: string
  hasta: string
  meses: (typeof VENTANAS_DEL_TABLERO)[number]
  mesActual: string
}

const MES = /^(\d{4})-(0[1-9]|1[0-2])$/

/**
 * El mes llega como date y, según el motor, como texto o como Date. Igual que
 * en /tablero: se reduce a 'aaaa-mm' para usarlo de clave.
 */
function claveDeMes(valor: string | Date): string {
  const texto = valor instanceof Date ? valor.toISOString() : String(valor)
  const partes = /(\d{4})-(\d{2})/.exec(texto)
  return partes ? `${partes[1]}-${partes[2]}` : texto.slice(0, 7)
}

interface Par { ingreso: number; salida: number }

const plantaPorMes = definir<EntradaPlantaPorMes>({
  nombre: 'planta_por_mes',
  clase: 'lectura',
  roles: ['admin'],
  descripcion: () =>
    'Lo que muestra el tablero de la Planta de Valorización (los dos predios juntos, sólo movimientos vigentes): por cada mes, los m³ equivalentes que entraron y salieron (el gráfico), y la cantidad de cada material en su unidad, mes por mes. Usala para «cuánto entró en agosto», «cómo viene el compost este año», «comparame julio con agosto». Llega hasta 24 meses para atrás. El mes en curso viene marcado como parcial: no lo compares con un mes entero como si fuera una caída. Los m³ son una equivalencia estimada con el factor de cada recipiente; lo que se carga en kg o en bolsas no suma m³. NO contesta días sueltos ni semanas, ni la suma de un rango de meses que no sea la ventana entera del tablero, ni puntos verdes: para eso está buscar_movimientos (flujo planta y el rango de fechas), que sí suma cualquier período.',
  parametros: () =>
    esquema({
      desde_mes: { type: 'string', description: 'Primer mes, aaaa-mm.' },
      hasta_mes: { type: 'string', description: 'Último mes, aaaa-mm, incluido. Para «hasta ahora», el mes en curso.' },
    }),
  validar: (entrada, contexto) => {
    const valores = campos(entrada)
    const desde = cadena(valores.desde_mes)
    const hasta = cadena(valores.hasta_mes)
    if (!MES.test(desde) || !MES.test(hasta)) {
      return { ok: false, error: 'desde_mes y hasta_mes van como aaaa-mm, por ejemplo 2026-08.' }
    }
    if (desde > hasta) return { ok: false, error: 'desde_mes es posterior a hasta_mes.' }
    const mesActual = hoyEnTucuman(contexto.ahora).slice(0, 7)
    if (hasta > mesActual) {
      return { ok: false, error: `hasta_mes (${hasta}) es posterior al mes en curso (${mesActual}): no hay datos del futuro.` }
    }
    // Cuántos meses tiene que abarcar el tablero para llegar a `desde`,
    // contando el mes en curso: /tablero?meses=6 va del mes actual cinco
    // para atrás.
    const necesarios = mesesEntre(desde, mesActual) + 1
    const meses = VENTANAS_DEL_TABLERO.find((n) => n >= necesarios)
    if (!meses) {
      const primero = restarMeses(mesActual, 23)
      return {
        ok: false,
        error: `El tablero llega hasta 24 meses para atrás: el mes más viejo que se puede pedir es ${primero}. Para antes, la persona puede usar la exportación a Excel del listado de movimientos.`,
        numeros: [24, ...primero.split('-').map(Number)],
      }
    }
    return { ok: true, valor: { desde, hasta, meses, mesActual } }
  },
  estado: () => 'Mirando el tablero de la Planta…',
  ejecutar: async (tx, entrada) => {
    const numeros = new Numeros()
    const { desde, hasta, meses, mesActual } = entrada

    const [filas, hayMovimientos] = await Promise.all([
      resumenMensualEnTx(tx, { flujo: 'planta', meses }),
      hay(tx, "select 1 from movimientos where flujo = 'planta' and estado = 'vigente'"),
    ])

    // ── El mismo armado que /tablero ────────────────────────────────────
    const ventana: string[] = []
    for (let i = meses - 1; i >= 0; i--) ventana.push(restarMeses(mesActual, i))
    const claves = Array.from(new Set([...ventana, ...filas.map((f) => claveDeMes(f.mes))])).sort()

    const volumenPorMes = new Map<string, Par>()
    const materiales = new Map<string, {
      material: string
      unidad: string
      volumen: number
      porMes: Map<string, Par>
      total: Par
    }>()

    for (const f of filas) {
      if (f.tipo !== 'ingreso' && f.tipo !== 'salida') continue
      const mes = claveDeMes(f.mes)
      const cuanto = Number(f.cantidad) || 0
      const volumen = Number(f.equivalente_m3) || 0

      const totalMes = volumenPorMes.get(mes) ?? { ingreso: 0, salida: 0 }
      totalMes[f.tipo] += volumen
      volumenPorMes.set(mes, totalMes)

      const clave = `${f.material_id}|${f.unidad_codigo}`
      const fila = materiales.get(clave) ?? {
        material: f.material_nombre,
        unidad: f.unidad_plural,
        volumen: 0,
        porMes: new Map<string, Par>(),
        total: { ingreso: 0, salida: 0 },
      }
      const celda = fila.porMes.get(mes) ?? { ingreso: 0, salida: 0 }
      celda[f.tipo] += cuanto
      fila.porMes.set(mes, celda)
      fila.total[f.tipo] += cuanto
      fila.volumen += volumen
      materiales.set(clave, fila)
    }

    const porMaterial = [...materiales.values()].sort(
      (a, b) => b.volumen - a.volumen || a.material.localeCompare(b.material, 'es'),
    )

    // ── Lo que se dice ──────────────────────────────────────────────────
    // Sólo los meses pedidos. El total por material es el de la columna
    // «Total» de la pantalla, que suma la ventana entera: se da únicamente si
    // lo pedido ES esa ventana, porque para otro rango ninguna pantalla lo
    // dibuja.
    const pedidos = claves.filter((c) => c >= desde && c <= hasta)
    const esLaVentana = desde <= claves[0] && hasta === mesActual
    const enCurso = hasta === mesActual

    const porMes = pedidos.map((clave) => ({
      mes: mesDicho(numeros, clave),
      ...(clave === mesActual ? { parcial: true } : {}),
      volumen_que_entro: `${cifra(numeros, volumenPorMes.get(clave)?.ingreso ?? 0, 1)} m³`,
      volumen_que_salio: `${cifra(numeros, volumenPorMes.get(clave)?.salida ?? 0, 1)} m³`,
    }))

    // Un material que en los meses pedidos no movió nada no tiene qué decir,
    // salvo que vaya el total de la ventana, donde sí figura.
    const conAlgo = esLaVentana
      ? porMaterial
      : porMaterial.filter((fila) => pedidos.some((c) => (fila.porMes.get(c)?.ingreso ?? 0) + (fila.porMes.get(c)?.salida ?? 0) > 0))
    const recorte = recortarContando(numeros, conAlgo)
    const detalle = recorte.filas.map((fila) => {
      // Como en la pantalla: los decimales se deciden por fila, mirando todos
      // sus valores, para que una columna no mezcle «12» con «12,50».
      const valores = [
        ...claves.flatMap((c) => [fila.porMes.get(c)?.ingreso ?? 0, fila.porMes.get(c)?.salida ?? 0]),
        fila.total.ingreso,
        fila.total.salida,
      ]
      const decimales = valores.every((v) => Number.isInteger(v)) ? 0 : 2
      const entro: Record<string, string> = {}
      const salio: Record<string, string> = {}
      for (const clave of pedidos) {
        const celda = fila.porMes.get(clave)
        const rotulo = mesDicho(numeros, clave)
        if (celda && celda.ingreso > 0) entro[rotulo] = cifra(numeros, celda.ingreso, decimales)
        if (celda && celda.salida > 0) salio[rotulo] = cifra(numeros, celda.salida, decimales)
      }
      return {
        material: nombrado(numeros, fila.material),
        unidad: nombrado(numeros, fila.unidad),
        ...(Object.keys(entro).length ? { entro } : {}),
        ...(Object.keys(salio).length ? { salio } : {}),
        ...(esLaVentana
          ? {
              total_de_la_ventana: {
                entro: cifra(numeros, fila.total.ingreso, decimales),
                salio: cifra(numeros, fila.total.salida, decimales),
              },
            }
          : {}),
      }
    })

    numeros.agregar(meses)
    const desdeDicho = mesDicho(numeros, desde)
    const hastaDicho = mesDicho(numeros, hasta)
    const rango = desde === hasta ? desdeDicho : `de ${desdeDicho} a ${hastaDicho}`
    const alcance =
      `Planta de Valorización, los dos predios juntos, sólo movimientos vigentes, ${rango}` +
      (enCurso ? `; ${mesDicho(numeros, mesActual)} está en curso y todavía puede crecer` : '')

    const aclaraciones = recorte.nota ? [recorte.nota] : []

    // Veinticuatro meses de quince materiales son casi cuatrocientas celdas y
    // no entran en una respuesta. Se sacan los meses más viejos del detalle
    // —el gráfico por mes queda entero— hasta que entre, y se dice.
    const rotulosPedidos = pedidos.map((clave) => mesLargo(instanteDeMes(clave)).toLowerCase())
    let recortados = 0
    while (JSON.stringify({ porMes, detalle }).length > LARGO_MAXIMO && recortados < rotulosPedidos.length - 1) {
      const viejo = rotulosPedidos[recortados++]
      for (const fila of detalle) {
        delete fila.entro?.[viejo]
        delete fila.salio?.[viejo]
      }
    }
    if (recortados) {
      aclaraciones.push(`El detalle por material arranca en ${rotulosPedidos[recortados]}: los meses anteriores están en el tablero.`)
      mesDicho(numeros, pedidos[recortados])
    }

    const datos = {
      ventana_del_tablero: `últimos ${meses} meses`,
      por_mes: porMes,
      por_material: detalle,
      ...(aclaraciones.length ? { aclaraciones } : {}),
    }

    return {
      alcance,
      datos,
      enlaces: [
        enlace(`Tablero de la Planta · ${meses} meses`, '/tablero', { meses }, 'numero'),
        enlace('Exportar el resumen a Excel', '/api/exportar', { vista: 'resumen', flujo: 'planta', meses }, 'numero'),
      ],
      numeros: numeros.lista(),
      ...(enCurso
        ? { nota: 'El mes en curso todavía no terminó: comparado con un mes entero parece una caída que no existe.' }
        : {}),
      hayDatosEnElSistema: hayMovimientos,
    }
  },
})

// ── buscar_movimientos ──────────────────────────────────────────────────
// /movimientos con los mismos filtros, contados por armarFiltros: el total de
// acá es el «N movimientos» de la pantalla, y los totales por material son la
// tabla «Cuánto suman» que se dibuja arriba del listado.

const FLUJOS: Flujo[] = ['planta', 'punto_verde', 'gran_generador']
// 'contenedor' existe en la columna pero no lo escribe nadie: ofrecerlo sólo
// invitaría a una respuesta de «0 recambios» que no mide nada.
const TIPOS = ['ingreso', 'salida'] as const
const ESTADOS = ['vigente', 'anulado', 'todos'] as const

interface EntradaBuscarMovimientos {
  periodo: PeriodoResuelto | null
  flujo: Flujo | null
  tipo: (typeof TIPOS)[number] | null
  punto: string | null
  material: string | null
  estado: EstadoMovimiento | 'todos'
  patente: string
  texto: string
}

const buscarMovimientos = definir<EntradaBuscarMovimientos>({
  nombre: 'buscar_movimientos',
  clase: 'lectura',
  roles: ['admin'],
  descripcion: () =>
    'El listado de movimientos con filtros, igual que la pantalla Movimientos: cuántos hay, cuánto suman por tipo, material y unidad (y los m³ equivalentes de cada tipo), y los 15 más recientes con número, fecha, tipo, materiales, origen, destino y estado. Sirve para cualquier período, también días sueltos o varios meses: «cuánto entró ayer a la Planta», «qué salió de compost en agosto», «qué movió el AB 123 CD la semana pasada», «cuántos anulados hay este mes», «a quién le mandamos el cartón». Por defecto sólo vigentes, como la pantalla; los anulados no suman nunca en los totales. Con material, la suma es sólo de ese material aunque el movimiento traiga otros. NO contesta cuántos se cargaron tarde (la pantalla no filtra por eso), ni nada de vecinos, ni quién cargó, manejó o autorizó: los nombres de personas no se dan.',
  parametros: (catalogo) =>
    esquema({
      ...propiedadesDePeriodoConTodo(),
      flujo: { ...enumCon(FLUJOS), description: 'planta, punto_verde, gran_generador o todos.' },
      tipo: { ...enumCon([...TIPOS]), description: 'ingreso (entra), salida (sale) o todos.' },
      punto: {
        ...enumCon(catalogo.puntos.map((p) => p.codigo)),
        description:
          'Código del sitio, o todos. «La Huerta» sin aclarar puede ser PV-01 (el punto verde) o PVRV-HUE (el predio de la ' +
          'Planta): en ese caso NO elijas uno; preguntá cuál antes de consultar, o consultá los dos por separado y decí ' +
          'cada uno con su nombre. «La Planta» son los dos predios: usá todos con flujo planta.',
      },
      material: { ...enumCon(catalogo.materiales.map((m) => m.nombre)), description: 'Nombre del material, o todos.' },
      estado: {
        type: 'string',
        enum: [...ESTADOS],
        description: 'vigente (lo normal), anulado, o todos (vigentes y anulados).',
      },
      patente: { type: 'string', description: 'Parte de la patente, o texto vacío.' },
      texto: { type: 'string', description: 'Busca en materiales, origen y destino, como el buscador de la pantalla. Texto vacío si no.' },
    }),
  validar: (entrada, contexto) => {
    const valores = campos(entrada)
    const periodo = leerPeriodo(valores, contexto.ahora)
    if (!periodo.ok) return periodo
    const flujo = elegir(valores.flujo, [TODOS, ...FLUJOS], 'flujo')
    if (!flujo.ok) return flujo
    const tipo = elegir(valores.tipo, [TODOS, ...TIPOS], 'tipo')
    if (!tipo.ok) return tipo
    const punto = elegir(valores.punto, [TODOS, ...contexto.catalogo.puntos.map((p) => p.codigo)], 'punto')
    if (!punto.ok) return punto
    const material = elegir(valores.material, [TODOS, ...contexto.catalogo.materiales.map((m) => m.nombre)], 'material')
    if (!material.ok) return material
    const estado = elegir(valores.estado, ESTADOS, 'estado')
    if (!estado.ok) return estado

    // Los mismos topes que leerValores() en la pantalla: más largo, la
    // pantalla lo corta y el enlace mostraría otra búsqueda.
    const patente = cadena(valores.patente).toUpperCase()
    const texto = cadena(valores.texto)
    if (patente.length > 20) return { ok: false, error: 'La patente tiene más de 20 caracteres.' }
    if (texto.length > 80) return { ok: false, error: 'El texto a buscar tiene más de 80 caracteres.' }

    return {
      ok: true,
      valor: {
        periodo: periodo.valor,
        flujo: flujo.valor === TODOS ? null : (flujo.valor as Flujo),
        tipo: tipo.valor === TODOS ? null : (tipo.valor as (typeof TIPOS)[number]),
        punto: punto.valor === TODOS ? null : punto.valor,
        material: material.valor === TODOS ? null : material.valor,
        estado: estado.valor,
        patente,
        texto,
      },
    }
  },
  estado: (entrada) =>
    entrada.patente
      ? `Buscando lo que movió la patente ${entrada.patente}…`
      : 'Buscando en los movimientos…',
  ejecutar: async (tx, entrada) => {
    const numeros = new Numeros()

    const punto = entrada.punto ? await idDePunto(tx, entrada.punto) : null
    if (punto && !punto.ok) return sinConsulta(punto.error)
    const material = entrada.material ? await idDeMaterial(tx, entrada.material) : null
    if (material && !material.ok) return sinConsulta(material.error)

    // Idéntico a lo que arma la pantalla desde la URL: mismos campos, mismos
    // vacíos. Cualquier diferencia acá es un número que no coincide allá.
    const filtros: FiltrosMovimientos = {
      flujo: entrada.flujo ?? '',
      tipo: entrada.tipo ?? '',
      sitioId: punto?.valor.id,
      materialId: material?.valor.id,
      desde: entrada.periodo?.desde,
      hasta: entrada.periodo?.hasta,
      patente: entrada.patente || undefined,
      estado: entrada.estado,
      texto: entrada.texto || undefined,
    }

    const [{ filas, total }, totales, hayMovimientos] = await Promise.all([
      buscarMovimientosEnTx(tx, { ...filtros, pagina: 1, porPagina: FILAS_MAXIMAS }),
      totalesDeMovimientosEnTx(tx, filtros),
      entrada.flujo
        ? hay(tx, 'select 1 from movimientos where flujo = $1', [entrada.flujo])
        : hay(tx, 'select 1 from movimientos'),
    ])

    // Los materiales de cada fila, con su cantidad: la columna «Cantidad» del
    // listado dice «3 materiales» cuando mezclan unidades, y eso no se puede
    // decir en voz alta. Es la misma lectura que hace la ficha.
    const items = filas.length
      ? await tx.consultar<{
          movimiento_id: string
          material_nombre: string
          cantidad: string
          unidad_nombre: string
          unidad_plural: string
        }>(
          `select movimiento_id, material_nombre, cantidad, unidad_nombre, unidad_plural
             from v_movimiento_items
            where movimiento_id = any($1::uuid[])
            order by material_nombre`,
          [filas.map((f) => f.id)],
        )
      : []
    const pendientes = await extremosSinRevisar(tx, filas.map((f) => f.id))

    numeros.agregar(total)

    const lista = filas.map((m) => {
      numeros.agregar(m.numero)
      const delMovimiento = items
        .filter((i) => i.movimiento_id === m.id)
        .map((i) => `${conUnidad(numeros, i.cantidad, { nombre: i.unidad_nombre, plural: i.unidad_plural })} de ${nombrado(numeros, i.material_nombre)}`)
      const sinRevisar = pendientes.get(m.id)
      return {
        numero: m.numero,
        fecha: dicha(numeros, fechaHora(m.ocurrido_en)),
        tipo: ETIQUETA_TIPO[m.tipo] ?? m.tipo,
        punto: nombrado(numeros, m.sitio_nombre),
        materiales: delMovimiento,
        origen: extremo(numeros, m.origen_clase, m.origen_nombre, sinRevisar?.origen),
        destino: extremo(numeros, m.destino_clase, m.destino_nombre, sinRevisar?.destino),
        estado: m.estado === 'anulado' ? 'anulado' : 'vigente',
        ...(m.carga_diferida ? { carga_diferida: true } : {}),
      }
    })

    const sumas = totales.map((t) => {
      const convierte = t.factor_m3 !== null && t.unidad_codigo !== 'm3'
      numeros.agregar(t.movimientos)
      return {
        tipo: ETIQUETA_TIPO[t.tipo] ?? t.tipo,
        material: nombrado(numeros, t.material_nombre),
        cantidad: conUnidad(numeros, t.cantidad, { nombre: t.unidad_nombre, plural: t.unidad_plural }),
        ...(convierte ? { equivale_a: `${cifra(numeros, t.equivalente_m3, 1)} m³` } : {}),
        movimientos: t.movimientos,
      }
    })

    const m3 = metrosCubicosPorTipo(totales)
    const volumen: Record<string, string> = {}
    if (m3.ingreso !== null) volumen.entraron = `${cifra(numeros, m3.ingreso, 1)} m³`
    if (m3.salida !== null) volumen.salieron = `${cifra(numeros, m3.salida, 1)} m³`

    // ── Alcance ─────────────────────────────────────────────────────────
    const partes: string[] = [
      entrada.flujo ? `Movimientos de ${ETIQUETA_FLUJO[entrada.flujo]}` : 'Movimientos de todos los flujos',
    ]
    if (entrada.tipo) partes.push(entrada.tipo === 'ingreso' ? 'sólo ingresos' : 'sólo salidas')
    if (punto) partes.push(`en ${nombrado(numeros, punto.valor.nombre)}`)
    if (material) partes.push(`con ${nombrado(numeros, material.valor.nombre)}`)
    // La patente y el texto los escribió quien pregunta: sus dígitos ya están
    // en la pregunta y repetirlos no inventa nada.
    if (entrada.patente) partes.push(`patente que contiene «${nombrado(numeros, entrada.patente)}»`)
    if (entrada.texto) partes.push(`que mencionan «${nombrado(numeros, entrada.texto)}»`)
    partes.push(fraseDePeriodo(numeros, entrada.periodo))
    partes.push(
      entrada.estado === 'vigente' ? 'sólo vigentes'
        : entrada.estado === 'anulado' ? 'sólo anulados'
          : 'vigentes y anulados',
    )
    const alcance = partes.join(', ') + (entrada.periodo?.incluyeHoy ? `; ${TODAVIA_PUEDE_CRECER}` : '')

    const aclaraciones: string[] = []
    if (total > filas.length) {
      numeros.agregar(filas.length)
      aclaraciones.push(`Se muestran los ${filas.length} más recientes de ${total}; el resto está en la pantalla del enlace.`)
    }
    if (entrada.estado !== 'vigente') aclaraciones.push('Los anulados se cuentan en el listado pero no suman en los totales.')
    if (material && totales.length) {
      aclaraciones.push(`Los totales suman sólo ${material.valor.nombre}, aunque el movimiento traiga otros materiales.`)
    }
    if (totales.some((t) => t.factor_m3 === null)) {
      aclaraciones.push('Lo cargado en kg o en bolsas no se pasa a m³ y no entra en el volumen.')
    }

    // Exactamente lo que lee leerValores() de la pantalla, en su orden, y
    // sin el estado cuando es el de siempre: así el enlace es la misma URL que
    // arma la pantalla cuando se elige ese filtro a mano.
    const filtrosDeLaPantalla = {
      flujo: entrada.flujo ?? '',
      tipo: entrada.tipo ?? '',
      sitioId: punto?.valor.id ?? '',
      materialId: material?.valor.id ?? '',
      desde: entrada.periodo?.desde ?? '',
      hasta: entrada.periodo?.hasta ?? '',
      patente: entrada.patente,
      estado: entrada.estado === 'vigente' ? '' : entrada.estado,
      texto: entrada.texto,
    }

    return {
      alcance,
      datos: {
        movimientos: total,
        ...(Object.keys(volumen).length ? { volumen } : {}),
        totales: sumas,
        mas_recientes: lista,
        ...(aclaraciones.length ? { aclaraciones } : {}),
      },
      enlaces: [
        enlace('Ver en Movimientos', '/movimientos', filtrosDeLaPantalla, 'numero'),
        enlace('Exportar a Excel', '/api/exportar', { vista: 'movimientos', ...filtrosDeLaPantalla }, 'filas'),
      ],
      numeros: numeros.lista(),
      hayDatosEnElSistema: hayMovimientos,
    }
  },
})

/**
 * El origen o el destino de un movimiento. Cuando el vigilador lo escribió
 * porque no estaba en la lista, es texto libre y viaja marcado; si es un
 * sitio, una entidad revisada o «Vecino», es un nombre de lista.
 *
 * La entidad sin revisar es texto libre aunque la clase diga 'entidad': el
 * vigilador la dio de alta desde la calle escribiendo el nombre, como
 * «Carrero 4120 Villa Luján», y la coordinación todavía no la miró. Si pasara
 * por nombrado(), el 4120 quedaría habilitado para citarse, y
 * pendientes_de_revision ya trata ese mismo nombre como escrito a mano.
 */
function extremo(numeros: Numeros, clase: string, nombre: string | null, sinRevisar = false) {
  if (!nombre) return null
  if (clase === 'texto' || (clase === 'entidad' && sinRevisar)) return aMano(nombre)
  return nombrado(numeros, nombre)
}

/**
 * De cada movimiento, si su origen o su destino es una entidad pendiente de
 * revisión. v_movimientos no lo trae y es una vista de otra migración: se
 * pregunta aparte, por los mismos ids que ya se leyeron, con entidades_publicas
 * que es la que usa la vista para el nombre.
 */
async function extremosSinRevisar(
  tx: Conexion,
  ids: string[],
): Promise<Map<string, { origen: boolean; destino: boolean }>> {
  if (!ids.length) return new Map()
  const filas = await tx.consultar<{ id: string; origen: boolean | null; destino: boolean | null }>(
    `select m.id, oe.pendiente_revision as origen, de.pendiente_revision as destino
       from movimientos m
       left join entidades_publicas oe on oe.id = m.origen_entidad_id
       left join entidades_publicas de on de.id = m.destino_entidad_id
      where m.id = any($1::uuid[])`,
    [ids],
  )
  return new Map(filas.map((f) => [f.id, { origen: f.origen === true, destino: f.destino === true }]))
}

// ── movimiento ──────────────────────────────────────────────────────────
// La ficha de /movimientos/<id>, buscada por número. Los nombres de la ficha
// —chofer, autoriza, quién cargó, quién anuló, vigilador de turno— no viajan.

interface EntradaMovimiento { numero: number }

const movimiento = definir<EntradaMovimiento>({
  nombre: 'movimiento',
  clase: 'lectura',
  roles: ['admin'],
  descripcion: () =>
    'La ficha de un movimiento por su número: tipo, flujo, fecha, punto, materiales con cantidad y m³ equivalentes, origen y destino, patente, para qué se entregó, si está anulado (cuándo y el motivo), si fue carga diferida y, en una salida de compost, de qué pila salió. Usala para «qué es el 1502», «por qué se anuló el 1387», «de qué pila salió el camión del 1502». NO dice quién lo cargó, quién lo anuló, quién manejó ni quién autorizó: los nombres de personas no se dan; para eso está la ficha en la pantalla.',
  parametros: () =>
    esquema({
      numero: { type: 'integer', description: 'El número del movimiento, el que figura como Nº.' },
    }),
  validar: (entrada) => {
    const valor = campos(entrada).numero
    if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1 || valor > 999_999_999) {
      return { ok: false, error: 'El número de movimiento es un entero positivo, como 1502.' }
    }
    return { ok: true, valor: { numero: valor } }
  },
  estado: (entrada) => `Buscando el movimiento ${entrada.numero}…`,
  ejecutar: async (tx, entrada) => {
    const numeros = new Numeros().agregar(entrada.numero)

    const [fila] = await tx.consultar<{ id: string }>(
      'select id from v_movimientos where numero = $1',
      [entrada.numero],
    )
    if (!fila) {
      return {
        alcance: `No hay ningún movimiento con el número ${entrada.numero}`,
        datos: { encontrado: false },
        enlaces: [enlace('Ver el listado de movimientos', '/movimientos', {}, 'filas')],
        numeros: numeros.lista(),
        hayDatosEnElSistema: await hay(tx, 'select 1 from movimientos'),
      }
    }

    const ficha = await movimientoPorIdEnTx(tx, fila.id)
    if (!ficha) return sinConsulta(`El movimiento ${entrada.numero} ya no se puede leer.`, numeros.lista())
    const { movimiento: m, items } = ficha
    const anulado = m.estado === 'anulado'

    // Como en la ficha: la trazabilidad sólo existe para una salida vigente.
    const traza = m.tipo === 'salida' && !anulado ? await trazaDeSalidaEnTx(tx, m.id) : null
    const sinRevisar = (await extremosSinRevisar(tx, [m.id])).get(m.id)

    const materiales = items.map((i) => ({
      material: nombrado(numeros, i.material_nombre),
      cantidad: conUnidad(numeros, i.cantidad, { nombre: i.unidad_nombre, plural: i.unidad_plural }),
      ...(i.factor_m3 ? { equivale_a: `${cifra(numeros, i.equivalente_m3, 2)} m³` } : {}),
      ...(i.observacion ? { observacion: aMano(i.observacion) } : {}),
    }))

    const conVecino = m.origen_clase === 'vecino' || m.destino_clase === 'vecino'
    const datos = {
      numero: m.numero,
      tipo: ETIQUETA_TIPO[m.tipo] ?? m.tipo,
      flujo: ETIQUETA_FLUJO[m.flujo] ?? m.flujo,
      ocurrio: dicha(numeros, fechaHora(m.ocurrido_en)),
      punto: `${nombrado(numeros, m.sitio_nombre)} (${nombrado(numeros, m.sitio_codigo)})`,
      origen: extremo(numeros, m.origen_clase, m.origen_nombre, sinRevisar?.origen),
      destino: extremo(numeros, m.destino_clase, m.destino_nombre, sinRevisar?.destino),
      ...(m.destino_entidad_tipo
        ? { tipo_de_destino: ETIQUETA_ENTIDAD[m.destino_entidad_tipo] ?? m.destino_entidad_tipo }
        : {}),
      ...(conVecino && m.vecino_sin_datos ? { vecino_sin_datos: true } : {}),
      ...(m.patente ? { patente: nombrado(numeros, m.patente) } : {}),
      ...(m.tipo_valorizacion
        ? { para_que_se_entrego: ETIQUETA_VALORIZACION[m.tipo_valorizacion] ?? m.tipo_valorizacion }
        : {}),
      materiales,
      ...(m.observaciones ? { observaciones: aMano(m.observaciones) } : {}),
      estado: anulado ? 'anulado' : 'vigente',
      ...(anulado
        ? {
            anulacion: {
              cuando: dicha(numeros, fechaHora(m.anulado_en)),
              motivo: aMano(m.motivo_anulacion),
              aclaracion: 'Sigue registrado para consulta, pero no suma en los totales.',
            },
          }
        : {}),
      carga: {
        registrado: dicha(numeros, fechaHora(m.creado_en)),
        diferida: m.carga_diferida,
      },
      ...(m.tipo === 'salida' && !anulado ? { de_que_pila_salio: trazaDicha(numeros, traza) } : {}),
    }

    return {
      alcance: `Movimiento ${m.numero}, ${anulado ? 'anulado' : 'vigente'}`,
      datos,
      enlaces: [enlace(`Ficha del movimiento ${m.numero}`, `/movimientos/${m.id}`, {}, 'numero')],
      numeros: numeros.lista(),
    }
  },
})

/**
 * La pila de una salida, sin los volteos: v_trazabilidad_salidas los cuenta
 * de la planilla de proceso, y los que se anotan desde el celular van a otra
 * tabla. Dar ese número sería decir «nunca se volteó» de una pila que sí.
 */
function trazaDicha(numeros: Numeros, traza: TrazaDeSalida | null) {
  if (!traza) return 'Esta salida no dice de qué pila salió: la pila se elige al cargar el movimiento.'
  const m3 = Number(traza.m3_que_la_formaron)
  return {
    pila: nombrado(numeros, traza.pila),
    armada: traza.fecha_armado ? dicha(numeros, fechaDeCalendario(traza.fecha_armado)) : 'sin fecha de armado',
    cerrada: traza.fecha_cierre ? dicha(numeros, fechaDeCalendario(traza.fecha_cierre)) : 'todavía sin cerrar',
    ...(traza.madurez ? { madurez_estimada: dicha(numeros, fechaDeCalendario(traza.madurez)) } : {}),
    ...(Number.isFinite(m3) && m3 > 0
      ? { volumen_que_la_formo: `${cifra(numeros, m3, Number.isInteger(m3) ? 0 : 1)} m³` }
      : {}),
    ...(traza.procedencias ? { procedencias: aMano(traza.procedencias) } : {}),
  }
}

// ── puntos_sin_carga ────────────────────────────────────────────────────
// «Quién está cargando», arriba de /conteos.

/**
 * Los mismos tres días de /conteos. Es una constante de esa pantalla y no de
 * la base; si se mueve a reglas.ts, las dos tienen que leerla de ahí.
 */

/** La vista pone esta fecha cuando el punto no cargó nunca nada. */
const NUNCA = '1900-01-01'

const puntosSinCarga = definir<Record<string, never>>({
  nombre: 'puntos_sin_carga',
  clase: 'lectura',
  roles: ['admin'],
  descripcion: () =>
    `Qué puntos verdes están cargando y cuáles no, como «Quién está cargando» en Conteos: la última carga de cada punto activo (la más nueva entre un movimiento vigente y un conteo diario), cuántos días hace, y cuáles llevan más de ${DIAS_DE_ALERTA} días callados o nunca cargaron. Usala para «qué puntos no están cargando», «hace cuánto que Colón no manda nada». Un punto callado no es un punto sin gente: puede ser que nadie cargó. NO dice cuánta gente fue ni cuánto material entró (para eso vecinos_por_periodo y buscar_movimientos), ni quién estaba de turno.`,
  parametros: () => esquema({}),
  validar: () => ({ ok: true, valor: {} }),
  estado: () => 'Mirando qué puntos están cargando…',
  ejecutar: async (tx, _entrada, contexto) => {
    const numeros = new Numeros().agregar(DIAS_DE_ALERTA)
    const hoy = hoyEnTucuman(contexto.ahora)
    const filas = await puntosSinCargaEnTx(tx)

    // Igual que /conteos: días enteros entre fechas de calendario, y el 1900
    // es «nunca», no «hace 46 mil días».
    const puntos = filas.map((p) => {
      const clave = claveDeCalendario(p.ultima_carga)
      const dias = clave && clave > NUNCA ? diasEntre(clave, hoy) : null
      const callado = dias === null || dias > DIAS_DE_ALERTA
      return {
        punto: `${nombrado(numeros, p.codigo)} · ${nombrado(numeros, p.nombre)}`,
        ...(p.carga_detallada ? {} : { solo_conteo_diario: true }),
        ultima_carga: dias === null ? 'nunca cargó nada' : dicha(numeros, fechaDeCalendario(p.ultima_carga)),
        ...(dias === null ? {} : { hace: haceCuantosDias(numeros, dias) }),
        callado,
      }
    })
    const callados = puntos.filter((p) => p.callado).length
    const alDia = puntos.length - callados
    numeros.agregar(puntos.length, callados, alDia)

    return {
      alcance:
        `Los ${puntos.length} puntos verdes activos, al ${dicha(numeros, fechaDeCalendario(hoy))}; ` +
        'la última carga es la más nueva entre un movimiento vigente y un conteo diario',
      datos: {
        mandaron_algo_en_los_ultimos_tres_dias: `${alDia} de ${puntos.length}`,
        callados_hace_mas_de_tres_dias_o_nunca: callados,
        puntos,
        aclaracion:
          'Los de «solo conteo diario» no pueden usar el celular en la jornada: de ellos sólo viene el total del día.',
      },
      enlaces: [enlace('Ver quién está cargando', '/conteos', {}, 'numero')],
      numeros: numeros.lista(),
      hayDatosEnElSistema: filas.some((p) => (claveDeCalendario(p.ultima_carga) ?? NUNCA) > NUNCA),
    }
  },
})

function haceCuantosDias(numeros: Numeros, dias: number): string {
  if (dias <= 0) return 'cargó hoy'
  if (dias === 1) return 'ayer'
  return `hace ${cifra(numeros, dias)} días`
}

// ── vecinos_por_periodo ─────────────────────────────────────────────────
// /tablero/puntos-verdes: visitas, de conteo, identificados y sin datos. Son
// cuatro cuentas distintas y ninguna se suma con otra: «de conteo» es una
// parte de las visitas, e «identificados» son personas y no visitas.

/** Las columnas de la pantalla: ocho semanas son dos meses de tendencia. */
const COLUMNAS_DE_VECINOS = { semana: 8, mes: 6 } as const

interface EntradaVecinos {
  periodo: 'semana' | 'mes'
  punto: string | null
}

interface Cuentas { visitas: number; sinDatos: number; identificados: number; contadas: number }
const enCero = (): Cuentas => ({ visitas: 0, sinDatos: 0, identificados: 0, contadas: 0 })

function acumular(destino: Cuentas, origen: Cuentas) {
  destino.visitas += origen.visitas
  destino.sinDatos += origen.sinDatos
  destino.identificados += origen.identificados
  destino.contadas += origen.contadas
}

interface FilaDePunto {
  id: string
  codigo: string
  nombre: string
  soloConteo: boolean
  porPeriodo: Map<string, Cuentas>
  total: Cuentas
}

/** Lunes de esa semana, que es como agrupa date_trunc('week'). */
function lunesDe(clave: string): string {
  const [a, m, d] = clave.split('-').map(Number)
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay()
  return restarDias(clave, (dia + 6) % 7)
}

const vecinosPorPeriodo = definir<EntradaVecinos>({
  nombre: 'vecinos_por_periodo',
  clase: 'lectura',
  roles: ['admin'],
  descripcion: () =>
    'Lo que muestra el tablero de Puntos Verdes, por semana (las últimas 8) o por mes (los últimos 6): visitas (cada vez que alguien trajo material), de conteo (la parte de esas visitas que viene del conteo diario en papel), identificados (personas distintas que dejaron teléfono) y sin datos (visitas de quien no quiso dejarlos). Son cuatro números distintos: NUNCA los sumes entre sí. Un punto de sólo conteo diario aporta visitas y nunca identificados ni sin datos: ahí no es cero, es que no se sabe quién vino. El total de identificados de varios períodos es un techo, no una cuenta de personas. Usala para «cuántos vecinos fueron a Italia la semana pasada», «visitas contra identificados de septiembre». NO da nombres, teléfonos ni barrios de vecinos, ni material recirculado, ni semanas o meses más viejos que los de la pantalla.',
  parametros: (catalogo) =>
    esquema({
      periodo: { type: 'string', enum: ['semana', 'mes'], description: 'semana o mes.' },
      punto: { ...enumCon(codigosDePuntosVerdes(catalogo)), description: 'Código del punto verde, o todos.' },
    }),
  validar: (entrada, contexto) => {
    const valores = campos(entrada)
    const periodo = elegir(valores.periodo, ['semana', 'mes'] as const, 'periodo')
    if (!periodo.ok) return periodo
    const punto = elegir(valores.punto, [TODOS, ...codigosDePuntosVerdes(contexto.catalogo)], 'punto')
    if (!punto.ok) return punto
    return { ok: true, valor: { periodo: periodo.valor, punto: punto.valor === TODOS ? null : punto.valor } }
  },
  estado: (entrada) =>
    entrada.punto ? 'Mirando los vecinos de ese punto…' : 'Mirando los vecinos de los puntos verdes…',
  ejecutar: async (tx, entrada, contexto) => {
    const numeros = new Numeros()
    const { periodo } = entrada
    const columnas = COLUMNAS_DE_VECINOS[periodo]
    numeros.agregar(columnas)

    const punto = entrada.punto ? await idDePunto(tx, entrada.punto) : null
    if (punto && !punto.ok) return sinConsulta(punto.error)

    // ── Las mismas claves que la pantalla ───────────────────────────────
    const hoy = hoyEnTucuman(contexto.ahora)
    const claves: string[] = []
    if (periodo === 'semana') {
      const lunes = lunesDe(hoy)
      for (let i = columnas - 1; i >= 0; i--) claves.push(restarDias(lunes, i * 7))
    } else {
      for (let i = columnas - 1; i >= 0; i--) claves.push(restarMeses(hoy.slice(0, 7), i))
    }
    const desde = periodo === 'semana' ? claves[0] : `${claves[0]}-01`
    const enCurso = claves[claves.length - 1]
    const anterior = claves[claves.length - 2]

    const [filas, sitios, modalidades, hayVecinos] = await Promise.all([
      resumenVecinosEnTx(tx, { periodo, desde, sitioId: punto?.valor.id }),
      sitiosVisiblesEnTx(tx),
      tx.consultar<{ id: string; carga_detallada: boolean }>(
        "select id, carga_detallada from sitios where tipo = 'punto_verde'",
      ),
      hay(tx, 'select 1 from v_vecinos_por_periodo'),
    ])

    const soloCuenta = new Map(modalidades.map((s) => [s.id, !s.carga_detallada]))
    const puntos: FilaDePunto[] = sitios
      .filter((s) => s.tipo === 'punto_verde' && (!punto || s.id === punto.valor.id))
      .map((s) => ({
        id: s.id, codigo: s.codigo, nombre: s.nombre,
        soloConteo: soloCuenta.get(s.id) ?? false,
        porPeriodo: new Map<string, Cuentas>(), total: enCero(),
      }))
    const porPunto = new Map(puntos.map((p) => [p.id, p]))
    const totalPorPeriodo = new Map<string, Cuentas>(claves.map((c) => [c, enCero()]))
    const totalGeneral = enCero()

    for (const f of filas) {
      // La vista agrupa por semana y por mes a la vez: mirando meses, cada
      // punto trae una fila por semana y hay que juntarlas, como la pantalla.
      const clave = periodo === 'semana'
        ? claveDeCalendario(f.semana) ?? ''
        : (claveDeCalendario(f.mes) ?? '').slice(0, 7)
      const acumulado = totalPorPeriodo.get(clave)
      if (!acumulado) continue
      let fila = porPunto.get(f.sitio_id)
      if (!fila) {
        // Un punto dado de baja que igual tiene historia: se muestra, no se esconde.
        fila = {
          id: f.sitio_id, codigo: f.sitio_codigo, nombre: f.sitio_nombre,
          soloConteo: !f.carga_detallada, porPeriodo: new Map(), total: enCero(),
        }
        porPunto.set(f.sitio_id, fila)
        puntos.push(fila)
      }
      const valores: Cuentas = {
        visitas: Number(f.visitas) || 0,
        sinDatos: Number(f.sin_datos) || 0,
        identificados: Number(f.identificados) || 0,
        contadas: Number(f.contadas) || 0,
      }
      const celda = fila.porPeriodo.get(clave) ?? enCero()
      acumular(celda, valores)
      fila.porPeriodo.set(clave, celda)
      acumular(fila.total, valores)
      acumular(acumulado, valores)
      acumular(totalGeneral, valores)
    }

    const nombreDe = (clave: string) =>
      periodo === 'semana'
        ? `la semana del ${dicha(numeros, fecha(instanteDeDia(clave)))}`
        : mesDicho(numeros, clave)

    /** Las cuatro cuentas de una celda, cada una por su lado. */
    const cuentas = (t: Cuentas, soloConteo: boolean) => ({
      visitas: cifra(numeros, t.visitas),
      de_conteo: cifra(numeros, t.contadas),
      identificados: soloConteo ? 'no se sabe: sólo conteo diario' : cifra(numeros, t.identificados),
      sin_datos: soloConteo ? 'no se sabe: sólo conteo diario' : cifra(numeros, t.sinDatos),
    })

    let datos: Record<string, unknown>
    if (punto) {
      const fila = porPunto.get(punto.valor.id)
      const soloConteo = fila?.soloConteo ?? false
      datos = {
        punto: `${nombrado(numeros, entrada.punto ?? '')} · ${nombrado(numeros, punto.valor.nombre)}`,
        ...(soloConteo ? { solo_conteo_diario: true } : {}),
        por_periodo: claves.map((clave) => ({
          periodo: nombreDe(clave),
          ...(clave === enCurso ? { en_curso: true } : {}),
          ...cuentas(fila?.porPeriodo.get(clave) ?? enCero(), soloConteo),
        })),
        total_de_la_pantalla: cuentas(fila?.total ?? enCero(), soloConteo),
      }
    } else {
      // Con todos los puntos, la tabla entera no entra en una respuesta: van
      // los totales por período —el pie de la tabla—, los indicadores de
      // arriba y cada punto en el período en curso y el anterior.
      const actual = totalPorPeriodo.get(enCurso) ?? enCero()
      const visitasConDetalle = Math.max(actual.visitas - actual.contadas, 0)
      const porcentajeSinDatos = visitasConDetalle > 0
        ? Math.round((actual.sinDatos / visitasConDetalle) * 100)
        : null
      const conIngresos = puntos.filter((p) => (p.porPeriodo.get(enCurso)?.visitas ?? 0) > 0)
      numeros.agregar(conIngresos.length, puntos.length)
      const enCursoSeLlama = periodo === 'semana' ? 'semana_en_curso' : 'mes_en_curso'
      const anteriorSeLlama = periodo === 'semana' ? 'semana_anterior' : 'mes_anterior'

      datos = {
        todos_los_puntos_por_periodo: claves.map((clave) => ({
          periodo: nombreDe(clave),
          ...(clave === enCurso ? { en_curso: true } : {}),
          ...cuentas(totalPorPeriodo.get(clave) ?? enCero(), false),
        })),
        total_de_la_pantalla: cuentas(totalGeneral, false),
        indicadores_del_periodo_en_curso: {
          periodo: nombreDe(enCurso),
          visitas_sin_datos: porcentajeSinDatos === null
            ? 'todavía no hubo visitas con detalle'
            : `${cifra(numeros, porcentajeSinDatos)}% (${cifra(numeros, actual.sinDatos)} de ${cifra(numeros, visitasConDetalle)} visitas con detalle)`,
          puntos_con_ingresos: `${conIngresos.length} de ${puntos.length}`,
        },
        por_punto: puntos.map((p) => ({
          punto: `${nombrado(numeros, p.codigo)} · ${nombrado(numeros, p.nombre)}`,
          ...(p.soloConteo ? { solo_conteo_diario: true } : {}),
          [enCursoSeLlama]: cuentas(p.porPeriodo.get(enCurso) ?? enCero(), p.soloConteo),
          ...(anterior ? { [anteriorSeLlama]: cuentas(p.porPeriodo.get(anterior) ?? enCero(), p.soloConteo) } : {}),
        })),
      }
    }

    const quienes = punto ? nombrado(numeros, punto.valor.nombre) : 'Todos los puntos verdes'
    const ventana = periodo === 'semana' ? `las últimas ${columnas} semanas` : `los últimos ${columnas} meses`
    return {
      alcance:
        `${quienes}, ${ventana} (desde el ${dicha(numeros, fecha(instanteDeDia(desde)))}); ` +
        `${periodo === 'semana' ? 'la semana' : 'el mes'} en curso todavía no terminó`,
      datos: {
        ...datos,
        aclaracion:
          'Visitas, de conteo, identificados y sin datos cuentan cosas distintas y no se suman entre sí. En identificados, quien vino en dos períodos figura en los dos.',
      },
      enlaces: [enlace(`Tablero de Puntos Verdes · por ${periodo}`, '/tablero/puntos-verdes', { periodo }, 'numero')],
      numeros: numeros.lista(),
      hayDatosEnElSistema: hayVecinos,
    }
  },
})

// ── conteos_recientes ───────────────────────────────────────────────────
// «Conteos cargados» de /conteos: los últimos 30 días, agrupados por día.

/** La ventana de /conteos. Más viejo que esto, la pantalla no lo lista. */
const DIAS_DE_CONTEOS = 30

interface EntradaConteos { punto: string | null }

/**
 * Se corrigió después de cargarlo. Como en /conteos: el alta deja creado_en y
 * actualizado_en con el mismo now(), y un segundo de tolerancia evita que un
 * redondeo del driver invente correcciones.
 */
function fueCorregido(creado: string, actualizado: string): boolean {
  const antes = new Date(creado).getTime()
  const despues = new Date(actualizado).getTime()
  if (!Number.isFinite(antes) || !Number.isFinite(despues)) return false
  return despues - antes > 1000
}

const conteosRecientes = definir<EntradaConteos>({
  nombre: 'conteos_recientes',
  clase: 'lectura',
  roles: ['admin'],
  descripcion: () =>
    `Los conteos diarios de vecinos de los últimos ${DIAS_DE_CONTEOS} días, como la pantalla Conteos: por día, cuántos vecinos cargó cada punto y si se corrigió después. El conteo es el total del día que se lleva en papel donde no se puede usar el celular. Usala para «cuántos vecinos contó Paso de los Andes el 15», «qué días no se cargó el conteo». NO incluye las visitas cargadas una por una desde el celular (eso es vecinos_por_periodo), ni días de hace más de ${DIAS_DE_CONTEOS}, ni quién cargó el conteo.`,
  parametros: (catalogo) =>
    esquema({
      punto: { ...enumCon(codigosDePuntosVerdes(catalogo)), description: 'Código del punto verde, o todos.' },
    }),
  validar: (entrada, contexto) => {
    const punto = elegir(campos(entrada).punto, [TODOS, ...codigosDePuntosVerdes(contexto.catalogo)], 'punto')
    if (!punto.ok) return punto
    return { ok: true, valor: { punto: punto.valor === TODOS ? null : punto.valor } }
  },
  estado: () => 'Mirando los conteos diarios…',
  ejecutar: async (tx, entrada, contexto) => {
    const numeros = new Numeros().agregar(DIAS_DE_CONTEOS)
    const punto = entrada.punto ? await idDePunto(tx, entrada.punto) : null
    if (punto && !punto.ok) return sinConsulta(punto.error)

    // conteosRecientesEnTx pide una Sesion sólo para decidir de qué punto se
    // habla: la coordinación elige y el vigilador ve el suyo. Quién es para
    // la base ya lo dice la transacción abierta, así que alcanza con el rol.
    const coordinacion: Sesion = { perfilId: '', rol: contexto.rol, sitioId: null, nombre: '' }
    const [conteos, sitios, hayConteos] = await Promise.all([
      conteosRecientesEnTx(tx, coordinacion, { sitioId: punto?.valor.id, dias: DIAS_DE_CONTEOS }),
      sitiosVisiblesEnTx(tx),
      hay(tx, 'select 1 from conteos_diarios'),
    ])
    const codigoDe = new Map(sitios.map((s) => [s.id, s.codigo]))

    const dias: Array<{ clave: string; fecha: ConteoDiario['fecha']; filas: ConteoDiario[]; vecinos: number }> = []
    for (const c of conteos) {
      const clave = claveDeCalendario(c.fecha) ?? ''
      let dia = dias[dias.length - 1]
      if (!dia || dia.clave !== clave) {
        dia = { clave, fecha: c.fecha, filas: [], vecinos: 0 }
        dias.push(dia)
      }
      dia.filas.push(c)
      dia.vecinos += Number(c.vecinos) || 0
    }
    const totalVecinos = conteos.reduce((suma, c) => suma + (Number(c.vecinos) || 0), 0)

    const recorte = recortarContando(numeros, dias)
    const lista = recorte.filas.map((dia) => {
      numeros.agregar(dia.filas.length)
      return {
        fecha: dicha(numeros, fechaDeCalendario(dia.fecha)),
        dia: dicha(numeros, diaSemana(instanteDeDia(dia.clave))),
        puntos: dia.filas.length,
        vecinos: cifra(numeros, dia.vecinos),
        conteos: dia.filas.map((c) => ({
          punto: `${nombrado(numeros, codigoDe.get(c.sitio_id) ?? '')} · ${nombrado(numeros, c.sitio_nombre ?? '')}`,
          vecinos: cifra(numeros, c.vecinos),
          ...(fueCorregido(c.creado_en, c.actualizado_en) ? { corregido: true } : {}),
          ...(c.observaciones ? { observacion: aMano(c.observaciones) } : {}),
        })),
      }
    })

    const hoy = hoyEnTucuman(contexto.ahora)
    const desde = restarDias(hoy, DIAS_DE_CONTEOS)
    const quienes = punto ? nombrado(numeros, punto.valor.nombre) : 'todos los puntos'
    numeros.agregar(conteos.length)

    return {
      alcance:
        `Conteos diarios de ${quienes}, últimos ${DIAS_DE_CONTEOS} días ` +
        `(del ${dicha(numeros, fechaDeCalendario(desde))} al ${dicha(numeros, fechaDeCalendario(hoy))}); ${TODAVIA_PUEDE_CRECER}`,
      datos: {
        // La pantalla dibuja el total de la ventana sólo para todos los
        // puntos: el de uno solo no está en ningún lado, y se deja afuera.
        ...(punto ? {} : { conteos_cargados: conteos.length, vecinos_en_total: cifra(numeros, totalVecinos) }),
        por_dia: lista,
        ...(recorte.nota ? { aclaracion: recorte.nota } : {}),
      },
      enlaces: [enlace('Ver los conteos', '/conteos', {}, punto ? 'filas' : 'numero')],
      numeros: numeros.lista(),
      hayDatosEnElSistema: hayConteos,
    }
  },
})

// ── pilas y pila ────────────────────────────────────────────────────────
// /pilas y /pilas/<id>. De v_pilas NO salen volteos, riegos, último volteo,
// volteo atrasado ni la última temperatura: los lee de la planilla de
// proceso, y lo que el celular anota va a pila_controles. Hoy esos números
// dirían «nunca se volteó» de una pila volteada la semana pasada. Los
// controles que sí se dan son los de la ficha, que lee pila_controles.

const ESTADOS_DE_PILA: EstadoPila[] = ['en_formacion', 'madurando', 'lista', 'despachada']

const ETIQUETA_ESTADO_PILA: Record<EstadoPila, string> = {
  en_formacion: 'en formación',
  madurando: 'madurando',
  lista: 'lista para despachar',
  despachada: 'despachada',
}

const ETIQUETA_CONTROL: Record<TipoControl, string> = {
  volteo: 'volteo',
  riego: 'riego',
  temperatura: 'temperatura',
  humedad: 'humedad',
  observacion: 'observación',
}

const SOBRE_LOS_VOLTEOS =
  'Los volteos anotados desde el celular todavía no se reflejan en el tablero de pilas; se ven en la ficha de cada pila (herramienta pila).'

/** Un número de la vista que llega como texto o como número, o null. */
const cuantoONada = (valor: number | string | null) => (valor === null ? null : Number(valor))

/**
 * Cuándo madura, como lo dice /pilas. Sin fecha de cierre no hay madurez que
 * dar: se cuenta desde que se cierra, y una pila «madurando» sin cierre —las
 * cinco que hay hoy— no tiene fecha de nada. Decirlo es la respuesta.
 */
function madurezDicha(numeros: Numeros, p: FilaPila): string {
  if (!p.fecha_cierre || !p.madurez) {
    return p.estado === 'en_formacion'
      ? 'todavía sin cerrar: la maduración se cuenta desde el día que se cierra'
      : 'sin fecha de cierre cargada: el sistema no puede calcular cuándo madura; se cierra desde la ficha de la pila'
  }
  const restante = cuantoONada(p.dias_para_madurez) ?? 0
  const madura = dicha(numeros, fechaDeCalendario(p.madurez))
  if (restante > 1) return `madura el ${madura}, faltan ${cifra(numeros, restante)} días`
  if (restante === 1) return `madura mañana, el ${madura}`
  if (restante === 0) return `madura hoy, el ${madura}`
  return `lista hace ${cifra(numeros, -restante)} ${restante === -1 ? 'día' : 'días'} (maduraba el ${madura})`
}

function pilaDicha(numeros: Numeros, p: FilaPila) {
  const armada = cuantoONada(p.dias_desde_armado)
  return {
    pila: nombrado(numeros, p.codigo),
    estado: ETIQUETA_ESTADO_PILA[p.estado] ?? p.estado,
    ...(p.activo ? {} : { dada_de_baja: true }),
    armada: p.fecha_armado
      ? `${dicha(numeros, fechaDeCalendario(p.fecha_armado))}${armada === null ? '' : `, hace ${cifra(numeros, armada)} días`}`
      : 'sin fecha de armado',
    cerrada: p.fecha_cierre ? dicha(numeros, fechaDeCalendario(p.fecha_cierre)) : 'sin cerrar',
    madurez: madurezDicha(numeros, p),
    volumen_que_entro: `${cifra(numeros, p.m3_ingresados, 1)} m³`,
    volumen_que_salio: `${cifra(numeros, p.m3_despachados, 1)} m³`,
  }
}

interface EntradaPilas { estado: EstadoPila | null }

const pilas = definir<EntradaPilas>({
  nombre: 'pilas',
  clase: 'lectura',
  roles: ['admin'],
  descripcion: () =>
    'Las pilas de compost activas, como la pantalla Pilas: cuántas hay en cada estado (en formación, madurando, lista, despachada) y de cada una la fecha de armado, la de cierre, cuándo madura y los m³ que entraron y salieron según los movimientos. Usala para «qué pilas están listas para despachar», «cuántas pilas hay madurando», «cuándo madura la P-07». Si una pila no tiene fecha de cierre, la madurez no se puede calcular: decilo así, no inventes una fecha. NO da volteos, riegos ni temperaturas: si preguntan por eso, decí que los volteos anotados desde el celular todavía no se reflejan en el tablero de pilas y que se ven en la ficha de cada una (herramienta pila). Tampoco da el responsable.',
  parametros: () =>
    esquema({
      estado: { ...enumCon(ESTADOS_DE_PILA), description: 'en_formacion, madurando, lista, despachada o todos.' },
    }),
  validar: (entrada) => {
    const estado = elegir(campos(entrada).estado, [TODOS, ...ESTADOS_DE_PILA], 'estado')
    if (!estado.ok) return estado
    return { ok: true, valor: { estado: estado.valor === TODOS ? null : (estado.valor as EstadoPila) } }
  },
  estado: () => 'Mirando las pilas de compost…',
  ejecutar: async (tx, entrada) => {
    const numeros = new Numeros()

    // Como /pilas: se piden todas, bajas incluidas, y se cuenta acá. Las
    // tarjetas y la lista son de las activas.
    const todas = await pilasEnTx(tx, { incluirBajas: true })
    const activas = todas.filter((p) => p.activo)
    const visibles = entrada.estado ? activas.filter((p) => p.estado === entrada.estado) : activas

    const porEstado = Object.fromEntries(
      ESTADOS_DE_PILA.map((e) => [ETIQUETA_ESTADO_PILA[e], cifra(numeros, activas.filter((p) => p.estado === e).length)]),
    )
    const sinCierre = activas.filter((p) => p.estado !== 'en_formacion' && p.estado !== 'despachada' && !p.fecha_cierre)
    numeros.agregar(visibles.length, sinCierre.length)

    const recorte = recortarContando(numeros, visibles)
    const quienes = entrada.estado ? `Pilas activas ${ETIQUETA_ESTADO_PILA[entrada.estado]}` : 'Todas las pilas activas'

    return {
      alcance: `${quienes} de la Planta; los m³ salen de los movimientos vigentes cargados con cada pila`,
      datos: {
        activas_por_estado: porEstado,
        pilas: recorte.filas.map((p) => pilaDicha(numeros, p)),
        ...(recorte.nota ? { aclaracion: recorte.nota } : {}),
        volteos_y_riegos: SOBRE_LOS_VOLTEOS,
      },
      enlaces: [enlace('Ver las pilas', '/pilas', { ver: entrada.estado ?? '' }, 'numero')],
      numeros: numeros.lista(),
      ...(sinCierre.length
        ? {
            nota: `${sinCierre.length === 1 ? 'Una pila figura' : `${sinCierre.length} pilas figuran`} madurando o lista sin fecha de cierre: el sistema no puede calcular cuándo maduran. Se cierran desde la ficha de cada pila.`,
          }
        : {}),
      hayDatosEnElSistema: todas.length > 0,
    }
  },
})

interface EntradaPila { codigo: string }

const pila = definir<EntradaPila>({
  nombre: 'pila',
  clase: 'lectura',
  roles: ['admin'],
  descripcion: () =>
    'La ficha de una pila de compost por su código, como su pantalla: estado, fechas de armado, cierre y madurez, medidas y volumen nominal, los m³ que entraron y salieron, de qué está hecha (cada material y de dónde vino, calculado de los ingresos cargados con esa pila), los controles anotados (volteos, riegos, temperaturas, humedad) y las salidas que se llevaron material de ella. Usala para «de qué está hecha la P-03», «cuándo se volteó la P-07 por última vez», «adónde fue el compost de la P-02». NO dice quién anotó cada control ni quién manejó cada salida, ni el responsable de la pila.',
  parametros: (catalogo) =>
    esquema({
      codigo: catalogo.pilas.length
        ? { type: 'string', enum: [...catalogo.pilas], description: 'El código de la pila.' }
        : { type: 'string', description: 'El código de la pila. Hoy no hay ninguna activa.' },
    }),
  validar: (entrada, contexto) => {
    const codigo = cadena(campos(entrada).codigo)
    if (!contexto.catalogo.pilas.length) return { ok: false, error: 'No hay ninguna pila activa en el sistema.' }
    return elegir(codigo, contexto.catalogo.pilas, 'codigo').ok
      ? { ok: true, valor: { codigo } }
      : { ok: false, error: `No hay ninguna pila activa con el código «${codigo}». Las que hay: ${contexto.catalogo.pilas.join(', ')}.` }
  },
  estado: (entrada) => `Abriendo la ficha de la pila ${entrada.codigo}…`,
  ejecutar: async (tx, entrada) => {
    const numeros = new Numeros()
    const [fila] = await tx.consultar<{ id: string }>('select id from pilas where codigo = $1', [entrada.codigo])
    if (!fila) return sinConsulta(`La pila ${entrada.codigo} ya no está en la lista.`)

    const ficha = await pilaPorIdEnTx(tx, fila.id)
    if (!ficha) return sinConsulta(`La pila ${entrada.codigo} ya no se puede leer.`)
    const { pila: p, composicion, controles, salidas } = ficha

    // v_trazabilidad_salidas no dice cuánto llevaba cada camión: la ficha lo
    // pide a v_movimientos con esta misma consulta.
    const cantidades = salidas.length
      ? await tx.consultar<{
          id: string
          items: number | string
          cantidad_total: number | string | null
          unidad_nombre: string | null
          unidad_plural: string | null
          unidad_decimales: number | null
        }>(
          `select id, items, cantidad_total, unidad_nombre, unidad_plural, unidad_decimales
             from v_movimientos where id = any($1::uuid[])`,
          [salidas.map((s) => s.movimiento_id)],
        )
      : []
    const cantidadDe = new Map(cantidades.map((c) => [c.id, c]))

    const m3Compuestos = composicion.reduce((total, c) => total + Number(c.m3 ?? 0), 0)
    const movimientosCompuestos = composicion.reduce((total, c) => total + Number(c.movimientos), 0)
    numeros.agregar(movimientosCompuestos, salidas.length)

    const deQueEsta = recortarContando(numeros, composicion)
    const anotados = recortarContando(numeros, controles)
    const queSalio = recortarContando(numeros, salidas)

    const datos = {
      ...pilaDicha(numeros, p),
      punto: nombrado(numeros, p.sitio_nombre),
      medidas: `${cifra(numeros, p.largo_m, decimalesDe(Number(p.largo_m)))} × ${cifra(numeros, p.ancho_m, decimalesDe(Number(p.ancho_m)))} × ${cifra(numeros, p.alto_m, decimalesDe(Number(p.alto_m)))} m`,
      volumen_nominal: `${cifra(numeros, p.volumen_nominal_m3, 1)} m³`,
      ...(p.composicion ? { agregado_sin_movimiento: aMano(p.composicion) } : {}),
      ...(p.notas ? { notas: aMano(p.notas) } : {}),
      de_que_esta_hecha: composicion.length
        ? {
            // El origen puede ser una entidad de la lista o lo que el
            // vigilador escribió: la vista no dice cuál, así que va marcado.
            ingresos: deQueEsta.filas.map((c) => {
              const primero = fecha(c.primer_ingreso)
              const ultimo = fecha(c.ultimo_ingreso)
              numeros.agregar(Number(c.movimientos))
              return {
                material: nombrado(numeros, c.material),
                procedencia: aMano(c.origen),
                entro: primero === ultimo ? dicha(numeros, primero) : `${dicha(numeros, primero)} a ${dicha(numeros, ultimo)}`,
                movimientos: Number(c.movimientos),
                volumen: `${cifra(numeros, c.m3, 1)} m³`,
              }
            }),
            total: { movimientos: movimientosCompuestos, volumen: `${cifra(numeros, m3Compuestos, 1)} m³` },
            ...(deQueEsta.nota ? { aclaracion: deQueEsta.nota } : {}),
          }
        : 'Ningún ingreso quedó registrado con esta pila: de qué está hecha no se puede reconstruir.',
      controles_anotados: controles.length
        ? {
            del_mas_nuevo_al_mas_viejo: anotados.filas.map((c) => ({
              control: ETIQUETA_CONTROL[c.tipo] ?? c.tipo,
              cuando: dicha(numeros, fechaHora(c.ocurrido_en)),
              ...(c.valor === null
                ? {}
                : {
                    valor: c.tipo === 'temperatura' ? `${cifra(numeros, c.valor, 1)} °C`
                      : c.tipo === 'humedad' ? `${cifra(numeros, c.valor, 0)} %`
                        : cifra(numeros, c.valor, 1),
                  }),
              ...(c.observacion ? { observacion: aMano(c.observacion) } : {}),
            })),
            ...(anotados.nota ? { aclaracion: anotados.nota } : {}),
          }
        : 'Sin controles anotados.',
      que_salio: salidas.length
        ? {
            salidas: queSalio.filas.map((s) => {
              const c = cantidadDe.get(s.movimiento_id)
              numeros.agregar(s.numero)
              return {
                numero: s.numero,
                fecha: dicha(numeros, fecha(s.ocurrido_en)),
                destino: aMano(s.destino),
                ...(s.tipo_valorizacion
                  ? { para_que: ETIQUETA_VALORIZACION[s.tipo_valorizacion] ?? s.tipo_valorizacion }
                  : {}),
                ...(c ? { cantidad: cantidadComoLaFicha(numeros, c) } : {}),
              }
            }),
            total: `${salidas.length} ${salidas.length === 1 ? 'salida' : 'salidas'}, ${cifra(numeros, p.m3_despachados, 1)} m³ despachados`,
            ...(queSalio.nota ? { aclaracion: queSalio.nota } : {}),
          }
        : 'Todavía no salió nada de esta pila.',
    }

    return {
      alcance: `Pila ${nombrado(numeros, p.codigo)}, ${ETIQUETA_ESTADO_PILA[p.estado] ?? p.estado}; los m³ salen de los movimientos vigentes cargados con esta pila`,
      datos,
      enlaces: [enlace(`Ficha de la pila ${p.codigo}`, `/pilas/${p.id}`, {}, 'numero')],
      numeros: numeros.lista(),
    }
  },
})

// ── trazabilidad ────────────────────────────────────────────────────────
// Arriba de /trazabilidad: cuántas salidas del período declaran de qué pila
// salieron y cuántas no. Es la misma cuenta de esa pantalla, con la misma
// función: los dos bordes del rango van al SQL antes del tope de 500, y la
// base corta los días en Tucumán. Hasta el 28/09/2026 la pantalla aplicaba el
// `hasta` en JavaScript sobre lo que ya había vuelto, y un rango acotado podía
// salir recortado; si esto se aparta de la pantalla, vuelven a no coincidir.

const TOPE_DE_TRAZABILIDAD = 500

interface EntradaTrazabilidad { periodo: PeriodoResuelto | null }

const trazabilidad = definir<EntradaTrazabilidad>({
  nombre: 'trazabilidad',
  clase: 'lectura',
  roles: ['admin'],
  descripcion: () =>
    'Las salidas de la Planta de un período, como la pantalla Trazabilidad: cuántas declaran de qué pila salieron y cuántas no (con el porcentaje), y las más recientes que sí la declaran, con destino, pila, m³ que formaron esa pila y de dónde vino ese material. Usala para «cuántas salidas no dicen de qué pila salieron», «adónde fue el compost de este mes y de qué pila». Si la mayoría no declara la pila, decilo: la lista es una parte y no sirve para sacar conclusiones. NO da los volteos de cada pila, ni el chofer, ni la cantidad que se llevó cada camión (eso está en movimiento).',
  parametros: () => esquema(propiedadesDePeriodoConTodo()),
  validar: (entrada, contexto) => {
    const periodo = leerPeriodo(campos(entrada), contexto.ahora)
    if (!periodo.ok) return periodo
    return { ok: true, valor: { periodo: periodo.valor } }
  },
  estado: () => 'Mirando de qué pila salió cada camión…',
  ejecutar: async (tx, entrada) => {
    const numeros = new Numeros()
    const desde = entrada.periodo?.desde
    const hasta = entrada.periodo?.hasta

    const [leidas, total, haySalidas] = await Promise.all([
      trazabilidadDeSalidasEnTx(tx, { desde, hasta, limite: TOPE_DE_TRAZABILIDAD }),
      contarMovimientosEnTx(tx, { flujo: 'planta', tipo: 'salida', desde, hasta }),
      hay(tx, "select 1 from movimientos where flujo = 'planta' and tipo = 'salida'"),
    ])

    const filas = leidas
    const conPila = filas.length
    // Como la pantalla: el total sale de las salidas de la Planta y la vista
    // de cualquier salida con pila; si no cierran, el faltante va en cero.
    const sinPila = Math.max(total - conPila, 0)
    const porcentaje = total > 0 ? Math.min(Math.round((conPila / total) * 100), 100) : null
    const mayoriaSinPila = total > 0 && sinPila > conPila
    const seCorto = leidas.length >= TOPE_DE_TRAZABILIDAD
    numeros.agregar(conPila, sinPila, total)
    if (porcentaje !== null) numeros.agregar(porcentaje)

    const recorte = recortarContando(numeros, filas)
    const lista = recorte.filas.map((f) => {
      numeros.agregar(f.numero)
      const m3 = Number(f.m3_que_la_formaron)
      return {
        numero: f.numero,
        fecha: dicha(numeros, fechaHora(f.ocurrido_en)),
        // Una entidad de la lista o lo que se escribió a mano: la vista los
        // junta en una sola columna, así que va marcado.
        destino: aMano(f.destino),
        pila: nombrado(numeros, f.pila),
        ...(Number.isFinite(m3) && m3 > 0
          ? { volumen_que_formo_la_pila: `${cifra(numeros, m3, Number.isInteger(m3) ? 0 : 1)} m³` }
          : {}),
        procedencias: f.procedencias ? aMano(f.procedencias) : 'sin identificar',
      }
    })

    const notas: string[] = []
    if (mayoriaSinPila) {
      notas.push('La mayoría de las salidas del período no dice de qué pila salió: la lista muestra una parte y no sirve para sacar conclusiones sobre destinos.')
    }
    if (seCorto) {
      numeros.agregar(TOPE_DE_TRAZABILIDAD)
      notas.push(`Se leyeron las últimas ${TOPE_DE_TRAZABILIDAD} salidas con pila: si el período es largo puede faltar lo más viejo.`)
    }

    return {
      alcance:
        `Salidas de la Planta, ${fraseDePeriodo(numeros, entrada.periodo)}, sólo vigentes` +
        (entrada.periodo?.incluyeHoy ? `; ${TODAVIA_PUEDE_CRECER}` : ''),
      datos: {
        salidas_de_la_planta: total,
        con_pila_declarada: conPila,
        sin_pila_declarada: sinPila,
        ...(porcentaje === null ? {} : { porcentaje_con_pila: `${porcentaje}%` }),
        mas_recientes_con_pila: lista,
        ...(recorte.nota ? { aclaracion: recorte.nota } : {}),
        sobre_los_volumenes: 'Los m³ son de la pila entera, no de ese camión: dos salidas de la misma pila repiten el número.',
      },
      enlaces: [enlace('Ver la trazabilidad', '/trazabilidad', { desde: desde ?? '', hasta: hasta ?? '' }, 'numero')],
      numeros: numeros.lista(),
      ...(notas.length ? { nota: notas.join(' ') } : {}),
      hayDatosEnElSistema: haySalidas,
    }
  },
})

// ── recambios ───────────────────────────────────────────────────────────
// /recambios: la cola de pedidos abiertos y el tiempo de respuesta por punto,
// partido en los dos tramos a propósito. Lo que tarda el municipio en avisar
// y lo que tarda la empresa en venir se arreglan de maneras distintas, y un
// promedio del total los mezclaría.

/** Una espera como la dice /recambios: en horas hasta dos días, en días después. */
function espera(numeros: Numeros, horas: number | string | null): string {
  if (horas === null || horas === '') return 'sin dato'
  const h = Number(horas)
  if (!Number.isFinite(h)) return 'sin dato'
  if (h < 1) return `menos de ${cifra(numeros, 1)} h`
  if (h < 48) return `${cifra(numeros, h, 1)} h`
  return `${cifra(numeros, h / 24, 1)} días`
}

/** La misma espera contada desde ahora: «hace 2 días». */
function hace(numeros: Numeros, horas: number | string): string {
  const h = Number(horas)
  if (!Number.isFinite(h)) return 'hace un rato'
  if (h < 1) return 'recién'
  if (h < 48) return `hace ${cifra(numeros, Math.round(h))} h`
  return `hace ${cifra(numeros, Math.floor(h / 24))} días`
}

/** Los demorados primero; adentro, el orden de la consulta: urgentes y del más viejo al más nuevo. */
const demoradosArriba = (pedidos: PedidoRecambio[]) =>
  [...pedidos].sort((a, b) => Number(b.demorado) - Number(a.demorado))

const recambios = definir<Record<string, never>>({
  nombre: 'recambios',
  clase: 'lectura',
  roles: ['admin'],
  descripcion: () =>
    `Los recambios de contenedores, como la pantalla Recambios: los pedidos abiertos (sin avisar a la empresa y ya avisados), cuáles están demorados (abiertos hace más de ${DIAS_PARA_PEDIDO_DEMORADO} días), y por punto el tiempo de respuesta en dos tramos que NO se suman: lo que tarda el municipio en avisar y lo que tarda la empresa en venir. Usala para «qué pedidos están demorados», «cuánto tarda la 9 de Julio en venir», «hay algo sin avisar». NO dice quién pidió ni quién avisó, ni los kilos retirados, ni pedidos ya cerrados uno por uno.`,
  parametros: () => esquema({}),
  validar: () => ({ ok: true, valor: {} }),
  estado: () => 'Mirando los pedidos de recambio…',
  ejecutar: async (tx) => {
    const numeros = new Numeros().agregar(DIAS_PARA_PEDIDO_DEMORADO)
    const [respuesta, abiertos, hayPedidos] = await Promise.all([
      respuestaDeRecambioEnTx(tx),
      pedidosDeRecambioEnTx(tx),
      hay(tx, 'select 1 from pedidos_recambio'),
    ])

    const sinAvisar = demoradosArriba(abiertos.filter((p) => p.estado === 'pedido'))
    const avisados = demoradosArriba(abiertos.filter((p) => p.estado === 'avisado'))
    const demorados = abiertos.filter((p) => p.demorado).length
    numeros.agregar(abiertos.length, sinAvisar.length, avisados.length, demorados)

    const pedidoDicho = (p: PedidoRecambio) => ({
      punto: `${nombrado(numeros, p.sitio_codigo)} · ${nombrado(numeros, p.sitio_nombre)}`,
      corriente: p.material ? nombrado(numeros, p.material) : 'sin corriente asignada',
      ...(p.urgente ? { urgente: true } : {}),
      ...(p.demorado ? { demorado: `${cifra(numeros, Math.floor(Number(p.horas_totales) / 24) || 0)} días` } : {}),
      pedido: `${hace(numeros, p.horas_totales)} (${dicha(numeros, fechaHora(p.pedido_en))})`,
      ...(p.estado === 'avisado'
        ? {
            avisado_a_la_empresa: dicha(numeros, fechaHora(p.avisado_en)),
            el_municipio_tardo_en_avisar: espera(numeros, p.horas_hasta_aviso),
            hace_que_espera_a_la_empresa: espera(numeros, p.horas_hasta_retiro),
          }
        : { sin_avisar_a_la_empresa: true }),
      ...(p.observaciones ? { observaciones: aMano(p.observaciones) } : {}),
    })

    const colaSinAvisar = recortarContando(numeros, sinAvisar)
    const colaAvisados = recortarContando(numeros, avisados)

    const porPunto = respuesta.map((r) => {
      const retirados = Number(r.retirados || 0)
      const enEspera = Number(r.abiertos || 0)
      const atrasados = Number(r.demorados || 0)
      numeros.agregar(retirados, enEspera, atrasados)
      return {
        punto: `${nombrado(numeros, r.sitio_codigo)} · ${nombrado(numeros, r.sitio_nombre)}`,
        abiertos: enEspera,
        demorados: atrasados,
        el_municipio_tarda_en_avisar: espera(numeros, r.promedio_hasta_aviso),
        la_empresa_tarda_en_venir: retirados > 0 ? espera(numeros, r.promedio_hasta_retiro) : 'sin retiros cerrados',
        retiros_cerrados: retirados,
      }
    })

    return {
      alcance: 'Pedidos de recambio abiertos ahora; los tiempos de respuesta son promedios de todos los pedidos de cada punto',
      datos: {
        abiertos: abiertos.length,
        sin_avisar: sinAvisar.length,
        avisados: avisados.length,
        demorados,
        cola_sin_avisar: colaSinAvisar.filas.map(pedidoDicho),
        cola_avisados: colaAvisados.filas.map(pedidoDicho),
        ...(colaSinAvisar.nota || colaAvisados.nota
          ? { aclaracion: colaSinAvisar.nota ?? colaAvisados.nota }
          : {}),
        tiempo_de_respuesta_por_punto: porPunto,
        sobre_los_tramos: 'Lo que tarda el municipio en avisar y lo que tarda la empresa en venir son dos tramos distintos: no se suman.',
      },
      enlaces: [enlace('Ver los recambios', '/recambios', {}, 'numero')],
      numeros: numeros.lista(),
      hayDatosEnElSistema: hayPedidos,
    }
  },
})

// ── pendientes_de_revision ──────────────────────────────────────────────
// /revisiones: lo que el vigilador tuvo que resolver en la calle y la
// coordinación termina de ordenar. Que esté vacío es lo normal: acá no hay
// «todavía no se empezó a cargar», y por eso no lleva hayDatosEnElSistema.

/** El mismo umbral de /revisiones: desde acá, un destino escrito merece ser opción fija. */

const pendientesDeRevision = definir<Record<string, never>>({
  nombre: 'pendientes_de_revision',
  clase: 'lectura',
  roles: ['admin'],
  descripcion: () =>
    `Lo que espera revisión en la pantalla Revisiones: las altas de carreros, emprendimientos u organizaciones que un vigilador hizo desde la calle (cuándo y en cuántos movimientos ya se usaron), y los destinos que se escribieron a mano porque no estaban en la lista (cuántas veces, entre qué fechas, en qué puntos). Usala para «cuántas altas hay sin revisar», «qué destinos escribieron a mano». Que no haya nada es lo normal, no un error. NO dice quién hizo cada alta, y no confirma, fusiona ni formaliza nada: eso se hace en la pantalla.`,
  parametros: () => esquema({}),
  validar: () => ({ ok: true, valor: {} }),
  estado: () => 'Mirando lo que espera revisión…',
  ejecutar: async (tx) => {
    const numeros = new Numeros().agregar(SE_REPITE)
    const [altas, destinos] = await Promise.all([
      entidadesPendientesEnTx(tx),
      destinosAFormalizarEnTx(tx),
    ])
    const repetidos = destinos.filter((d) => Number(d.veces) >= SE_REPITE).length
    numeros.agregar(altas.length, destinos.length, repetidos)

    const lasAltas = recortarContando(numeros, altas)
    const losDestinos = recortarContando(numeros, destinos)

    return {
      alcance: 'Lo que espera revisión hoy: altas hechas en la calle y destinos escritos a mano en salidas vigentes',
      datos: {
        altas_hechas_en_la_calle: altas.length,
        altas: lasAltas.filas.map((e) => {
          numeros.agregar(e.usos)
          return {
            // Lo escribió un vigilador en el celular: es un nombre de la
            // lista recién ahora, y todavía nadie lo confirmó.
            nombre: aMano(e.nombre),
            tipo: ETIQUETA_ENTIDAD[e.tipo] ?? e.tipo,
            alta: dicha(numeros, fechaHora(e.creado_en)),
            usada_en_movimientos: e.usos,
          }
        }),
        ...(lasAltas.nota ? { aclaracion_altas: lasAltas.nota } : {}),
        destinos_escritos_a_mano: destinos.length,
        se_repiten_cinco_veces_o_mas: repetidos,
        destinos: losDestinos.filas.map((d) => {
          const veces = Number(d.veces)
          const primera = fecha(d.primera_vez)
          const ultima = fecha(d.ultima_vez)
          numeros.agregar(veces)
          return {
            escrito: aMano(d.destino),
            veces,
            cuando: primera === ultima ? `sólo el ${dicha(numeros, primera)}` : `del ${dicha(numeros, primera)} al ${dicha(numeros, ultima)}`,
            puntos: (d.sitios ?? []).map((s) => nombrado(numeros, s)),
            flujos: (d.flujos ?? []).map((f) => ETIQUETA_FLUJO[f] ?? f),
          }
        }),
        ...(losDestinos.nota ? { aclaracion_destinos: losDestinos.nota } : {}),
      },
      enlaces: [enlace('Ir a Revisiones', '/revisiones', {}, 'numero')],
      numeros: numeros.lista(),
    }
  },
})

// ── La lista ────────────────────────────────────────────────────────────

export const HERRAMIENTAS_DE_COORDINACION: Herramienta[] = [
  plantaPorMes,
  buscarMovimientos,
  movimiento,
  puntosSinCarga,
  vecinosPorPeriodo,
  conteosRecientes,
  pilas,
  pila,
  trazabilidad,
  recambios,
  pendientesDeRevision,
]
