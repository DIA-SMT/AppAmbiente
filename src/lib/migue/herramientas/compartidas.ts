/**
 * Lo que Migue contesta igual al celular y al panel: cómo se hace algo, y
 * cómo se llaman las cosas.
 *
 * Ninguna de las dos mira movimientos. como_se_hace no consulta nada: explica
 * la regla y manda a la pantalla donde se hace, porque Migue no escribe —si
 * anulara o cargara él, la auditoría firmaría con la cuenta del punto y dejaría
 * de poder contestar quién hizo qué—. catalogo lee el catálogo congelado con
 * la conversación, el mismo del que salen los nombres del sistema.
 *
 * Las cifras de las reglas salen todas de src/lib/reglas.ts. Un «tenés 10
 * minutos» escrito a mano acá sería la tercera copia del 10 —la base y la
 * pantalla ya tienen la suya— y el día que la política cambie, Migue seguiría
 * diciendo el viejo.
 */
import 'server-only'

import { ETIQUETA_FLUJO, ETIQUETA_TIPO, numero } from '@/lib/formato'
import {
  DIAS_DE_CONTEO_PARA_ATRAS, HORAS_DE_ATRASO_MAXIMO, HORAS_PARA_CANCELAR_PEDIDO, MINUTOS_PARA_CARGA_DIFERIDA,
  MINUTOS_PARA_DESHACER,
} from '@/lib/reglas'

import type { Catalogo, ContextoDeHerramienta, Enlace, Herramienta, Resultado } from '../tipos'
import { Numeros, enlace, recortar } from './comunes'

// ── Lo que comparten ────────────────────────────────────────────────────

/** Ver definir() en vigilador.ts: la lista mezcla entradas de tipos distintos. */
function definir<E>(herramienta: Herramienta<E>): Herramienta {
  return herramienta as unknown as Herramienta
}

/**
 * Las cifras de un texto que escribimos acá, en el código. No es texto libre:
 * cada una es una constante de reglas.ts o un nombre propio del sistema («la 9
 * de Julio»). Se sacan del texto ya armado para que ninguna quede afuera de
 * `numeros` por olvido.
 */
function cifrasDe(...textos: string[]): string[] {
  return textos.flatMap((t) => t.match(/\d+/g) ?? [])
}

function leerTexto(entrada: unknown, campo: string): string | null {
  const valor = (entrada as Record<string, unknown> | null)?.[campo]
  return typeof valor === 'string' ? valor : null
}

// ── como_se_hace ────────────────────────────────────────────────────────
// Los textos siguen a las pantallas y al manual (docs/manual/manual.html), con
// los rótulos de los botones tal como se leen: la persona los va a buscar.
// Los enlaces son del rol que pregunta: el celular no abre el panel —el marco
// del vigilador redirige a la coordinación y el del panel al vigilador—, así
// que un enlace a /movimientos en el celular es un botón que no lleva a nada.

const TEMAS_DEL_PUNTO = [
  'deshacer_movimiento',
  'cargar_atrasado',
  'corregir_conteo',
  'cancelar_pedido',
  'destino_que_no_esta',
  'sin_senal',
] as const
type TemaDelPunto = (typeof TEMAS_DEL_PUNTO)[number]

const TEMAS_DE_COORDINACION = [
  ...TEMAS_DEL_PUNTO,
  'anular_movimiento',
  'formalizar_destino',
  'importar_pesos',
  'cerrar_pila',
  'alta_de_usuario',
] as const
type TemaDeCoordinacion = (typeof TEMAS_DE_COORDINACION)[number]

/** Los que sólo existen en un punto verde: la Planta no cuenta vecinos ni pide recambios. */
const SOLO_PUNTO_VERDE: TemaDelPunto[] = ['corregir_conteo', 'cancelar_pedido']

interface Explicacion {
  titulo: string
  texto: string
  enlaces: Enlace[]
}

function explicarAlPunto(tema: TemaDelPunto, contexto: ContextoDeHerramienta): Explicacion {
  switch (tema) {
    case 'deshacer_movimiento':
      return {
        titulo: 'deshacer un movimiento',
        texto:
          `Lo que cargaste lo podés deshacer vos durante ${MINUTOS_PARA_DESHACER} minutos desde que lo cargaste: abrilo ` +
          'desde «Lo de hoy» y en el comprobante, el del número grande, tocá «Deshacer». Pasados los ' +
          `${MINUTOS_PARA_DESHACER} minutos ya no se puede desde el celular: pedile la anulación a la coordinadora y ` +
          'pasale el número de movimiento.',
        enlaces: [enlace('Lo de hoy', '/hoy', {}, 'regla')],
      }
    case 'cargar_atrasado':
      return {
        titulo: 'cargar algo que pasó antes',
        texto:
          `Se puede cargar algo que pasó hasta ${HORAS_DE_ATRASO_MAXIMO} horas antes: en el formulario, en «Fecha y ` +
          'hora», tocá «Cambiar» y poné cuándo pasó. Si lo cargás más de ' +
          `${MINUTOS_PARA_CARGA_DIFERIDA} minutos después de que pasó queda marcado «Cargado después», y está bien que ` +
          `sea así. Más de ${HORAS_DE_ATRASO_MAXIMO} horas para atrás el celular no lo deja: avisale a la coordinadora.`,
        enlaces: [
          enlace('Registrar un ingreso', '/cargar/ingreso', {}, 'regla'),
          enlace('Registrar una salida', '/cargar/salida', {}, 'regla'),
        ],
      }
    case 'corregir_conteo':
      return {
        titulo: 'corregir el conteo de vecinos',
        texto:
          'El conteo se corrige volviendo a cargar el mismo día en «Conteo del día»: el número nuevo reemplaza al ' +
          `anterior, no se suma. Se puede hasta ${DIAS_DE_CONTEO_PARA_ATRAS} días para atrás; un día más viejo lo ` +
          'corrige la coordinadora. Si un día no vino nadie, se carga un cero: no es lo mismo que dejarlo sin cargar.',
        enlaces: [enlace('Conteo del día', '/conteo', {}, 'regla')],
      }
    case 'cancelar_pedido':
      return {
        titulo: 'cancelar un pedido de recambio',
        texto:
          'Un pedido de recambio se cancela desde «Contenedores», con «Cancelar el pedido», mientras se cumplan tres ' +
          'cosas: que lo haya pedido este punto, que la coordinación todavía no haya avisado a la empresa y que no ' +
          `hayan pasado ${HORAS_PARA_CANCELAR_PEDIDO} horas desde que se pidió. Si el botón no aparece es que alguna ` +
          'no se cumple: avisale a la coordinadora.',
        enlaces: [enlace('Contenedores', '/contenedores', {}, 'regla')],
      }
    case 'destino_que_no_esta':
      return {
        titulo: 'cargar un destino que no está en la lista',
        texto:
          'Si no está en la lista, al final tenés «Otro destino…» (en un ingreso de la Planta, «Otra procedencia…»): ' +
          'lo escribís como lo dirías. En el punto verde también podés tocar «Agregar a la lista…» para dar de alta a ' +
          'un carrero o un emprendimiento que se lleva material. Después la coordinadora lo revisa y lo deja como ' +
          'opción fija, y ya no hay que escribirlo.',
        enlaces: [enlace('Registrar una salida', '/cargar/salida', {}, 'regla')],
      }
    case 'sin_senal': {
      const pendientes = contexto.pendientesEnElCelular > 0
        ? ` Ahora mismo hay ${contexto.pendientesEnElCelular} guardados en este teléfono esperando subir: no los cargues de nuevo.`
        : ''
      return {
        titulo: 'cargar sin señal',
        texto:
          'Sin señal la aplicación no abre. Lo que sí funciona es el formulario que ya está abierto: se completa, se ' +
          'confirma, y el movimiento queda guardado en el celular hasta que vuelva la conexión, que lo sube solo. Por ' +
          'eso conviene abrir la aplicación al empezar el turno y no cerrarla. El conteo de vecinos, el pedido de ' +
          `recambio y los controles de pila sí necesitan señal en el momento.${pendientes}`,
        enlaces: [enlace('Lo de hoy', '/hoy', {}, 'regla')],
      }
    }
  }
}

function explicarACoordinacion(tema: TemaDeCoordinacion): Explicacion {
  switch (tema) {
    case 'deshacer_movimiento':
      return {
        titulo: 'deshacer un movimiento',
        texto:
          `Desde el celular, el punto deshace lo suyo en los primeros ${MINUTOS_PARA_DESHACER} minutos. Pasado eso ` +
          'lo anulás vos desde Movimientos: buscalo por su número, abrilo y anulalo con un motivo escrito y la casilla ' +
          'de confirmación. No se puede desanular.',
        enlaces: [enlace('Movimientos', '/movimientos', {}, 'regla')],
      }
    case 'cargar_atrasado':
      // No hay pantalla del panel para cargar un movimiento suelto: la base
      // deja a la coordinación cargar con cualquier fecha pasada, pero ningún
      // botón lo ofrece. Por eso esta explicación no lleva enlace.
      return {
        titulo: 'cargar algo que pasó antes',
        texto:
          `El celular deja cargar algo que pasó hasta ${HORAS_DE_ATRASO_MAXIMO} horas antes, cambiando la «Fecha y ` +
          `hora» del formulario; si se carga más de ${MINUTOS_PARA_CARGA_DIFERIDA} minutos después, queda marcado ` +
          `«Cargado después». Lo que se pasó de las ${HORAS_DE_ATRASO_MAXIMO} horas el celular no lo acepta, y el ` +
          'panel todavía no tiene una pantalla para cargar un movimiento suelto: hay que pedírselo a la Dirección de ' +
          'Inteligencia Artificial.',
        enlaces: [],
      }
    case 'corregir_conteo':
      return {
        titulo: 'corregir el conteo de vecinos',
        texto:
          'En Conteos se carga o se corrige el total de cualquier punto y cualquier día, sin el límite de ' +
          `${DIAS_DE_CONTEO_PARA_ATRAS} días para atrás que tiene el celular. Volver a cargar el mismo día corrige, no ` +
          'suma, y el valor viejo queda en la auditoría. Un cero cargado no es lo mismo que un día sin cargar.',
        enlaces: [enlace('Conteos', '/conteos', {}, 'regla')],
      }
    case 'cancelar_pedido':
      return {
        titulo: 'cancelar un pedido de recambio',
        texto:
          'En Recambios. Cancelar saca al pedido de la medición del tiempo de respuesta: usalo sólo para un pedido ' +
          'que no hacía falta, nunca para uno que sí se retiró, porque le regala tiempo a la empresa. El punto puede ' +
          `cancelar el suyo en las primeras ${HORAS_PARA_CANCELAR_PEDIDO} horas y sólo si todavía no se avisó.`,
        enlaces: [enlace('Recambios', '/recambios', {}, 'regla')],
      }
    case 'destino_que_no_esta':
      return {
        titulo: 'un destino que no está en la lista',
        texto:
          'El vigilador lo escribe a mano en el celular, y queda en Revisiones, en «Destinos escritos a mano». Ahí ' +
          'Formalizar crea la entidad y reapunta de una sola vez todos los movimientos que tenían ese texto; desde ' +
          'entonces aparece en el celular como opción fija. Lo que dio de alta en la calle aparece en «Altas hechas en ' +
          'la calle»: se confirma si es nuevo o se fusiona con la que ya existe.',
        enlaces: [enlace('Revisiones', '/revisiones', {}, 'regla')],
      }
    case 'sin_senal':
      return {
        titulo: 'los puntos sin señal',
        texto:
          'Sin señal la aplicación del celular no abre. Lo que sí funciona es el formulario que ya está abierto: se ' +
          'completa, se confirma y queda guardado en el teléfono hasta que vuelva la conexión, que lo sube solo. Lo ' +
          'práctico en un punto con mala señal es abrir la aplicación al empezar el turno y no cerrarla. El conteo de ' +
          'vecinos, el pedido de recambio y los controles de pila sí necesitan señal en el momento.',
        enlaces: [],
      }
    case 'anular_movimiento':
      return {
        titulo: 'anular un movimiento',
        texto:
          'En Movimientos buscalo por su número, abrí la ficha y anulalo: pide un motivo escrito y una casilla de ' +
          'confirmación, y no se puede desanular. No se borra: sigue en el listado marcado como anulado, si el filtro ' +
          'de estado lo incluye, y deja de contar en los totales.',
        enlaces: [enlace('Movimientos', '/movimientos', {}, 'regla')],
      }
    case 'formalizar_destino':
      return {
        titulo: 'formalizar un destino escrito a mano',
        texto:
          'En Revisiones, en «Destinos escritos a mano», Formalizar crea la entidad y reapunta de una sola vez todos ' +
          'los movimientos que tenían ese texto. Desde ese momento el destino aparece en el celular como opción fija y ' +
          'nadie lo vuelve a escribir.',
        enlaces: [enlace('Revisiones', '/revisiones', {}, 'regla')],
      }
    case 'importar_pesos':
      return {
        titulo: 'importar los pesos de la 9 de Julio',
        texto:
          'En Importar pesos se sube el Excel tal cual lo manda la planta de la 9 de Julio, sin acomodarlo. Son cinco ' +
          'pasos —el archivo, la hoja, las columnas, el resultado y confirmar— y hasta el último no se escribe nada. ' +
          'El punto verde se reconoce por el domicilio, no por el cliente. Si la planta reexporta un mes corregido, ' +
          'primero se revierte la importación anterior y después se importa la nueva: al revés, los kilos quedan ' +
          'contados dos veces.',
        enlaces: [enlace('Importar pesos', '/importar', {}, 'regla')],
      }
    case 'cerrar_pila':
      return {
        titulo: 'cerrar una pila',
        texto:
          'En Pilas, abrí la ficha y usá «Cerrar la pila» con la fecha real de cierre: desde ahí se calcula la ' +
          'madurez y se enciende el aviso de volteo atrasado. Si la pila está madurando sin fecha de cierre, como las ' +
          'que creó la importación del histórico, primero «Corregir el estado» → «En formación» → «Cambiar», y recién ' +
          'ahí aparece «Cerrar la pila».',
        enlaces: [enlace('Pilas', '/pilas', {}, 'regla')],
      }
    case 'alta_de_usuario':
      return {
        titulo: 'dar de alta un usuario',
        texto:
          'En Usuarios y accesos. Un usuario por punto, compartido por quienes estén de turno, que entra con el nombre ' +
          'del punto y un PIN; el PIN se muestra una sola vez, al crearlo o al resetearlo. Una cuenta de coordinación ' +
          'por persona, con su correo y una contraseña provisoria que tiene que cambiar la primera vez que entra. Al ' +
          'que se va se lo desactiva; eliminar sólo se puede si nunca cargó nada.',
        enlaces: [enlace('Usuarios y accesos', '/usuarios', {}, 'regla')],
      }
  }
}

function resultadoDeExplicacion(explicacion: Explicacion, desde: string): Resultado {
  return {
    alcance: `Cómo se hace: ${explicacion.titulo}, ${desde}`,
    datos: { como_se_hace: explicacion.texto },
    enlaces: explicacion.enlaces,
    numeros: new Numeros().agregar(...cifrasDe(explicacion.titulo, explicacion.texto)).lista(),
  }
}

const DESCRIPCION_DE_COMO_SE_HACE =
  'Explica cómo se hace algo en el sistema y en qué pantalla, con la regla que lo limita (los minutos para ' +
  'deshacer, las horas de atraso, los días del conteo). Usala cuando pregunten «¿cómo…?», «¿puedo…?», «¿se puede…?», ' +
  'y también cuando te pidan que cargues, anules o corrijas algo: vos no escribís nada, y esto da el camino. Decí ' +
  'la regla con sus números tal como vienen.'

/**
 * Son dos herramientas con el mismo nombre y no una: el enum de temas depende
 * del rol, y parametros() recibe el catálogo, no quién pregunta. Cada rol ve
 * sólo la suya; el celular nunca ve un tema del panel en la lista.
 */
const comoSeHaceEnElPunto = definir<TemaDelPunto>({
  nombre: 'como_se_hace',
  clase: 'lectura',
  roles: ['vigilador'],
  descripcion: () => DESCRIPCION_DE_COMO_SE_HACE,
  parametros: () => ({
    type: 'object',
    properties: { tema: { type: 'string', enum: [...TEMAS_DEL_PUNTO], description: 'Qué quiere hacer la persona.' } },
    required: ['tema'],
    additionalProperties: false,
  }),
  validar: (entrada, contexto) => {
    const tema = leerTexto(entrada, 'tema') as TemaDelPunto | null
    if (contexto.rol !== 'vigilador' || !contexto.punto) return { ok: false, error: 'Esta versión es la del celular de un punto.' }
    if (!tema || !TEMAS_DEL_PUNTO.includes(tema)) return { ok: false, error: `Tema desconocido: ${tema ?? 'vacío'}.` }
    if (SOLO_PUNTO_VERDE.includes(tema) && contexto.punto.tipo !== 'punto_verde') {
      return { ok: false, error: `${contexto.punto.nombre} no es un punto verde: ahí no hay conteo de vecinos ni pedidos de recambio.` }
    }
    return { ok: true, valor: tema }
  },
  estado: () => 'Buscando cómo se hace…',
  ejecutar: async (_tx, tema, contexto) => resultadoDeExplicacion(explicarAlPunto(tema, contexto), 'desde el celular'),
})

const comoSeHaceEnElPanel = definir<TemaDeCoordinacion>({
  nombre: 'como_se_hace',
  clase: 'lectura',
  roles: ['admin'],
  descripcion: () => DESCRIPCION_DE_COMO_SE_HACE,
  parametros: () => ({
    type: 'object',
    properties: { tema: { type: 'string', enum: [...TEMAS_DE_COORDINACION], description: 'Qué quiere hacer la persona.' } },
    required: ['tema'],
    additionalProperties: false,
  }),
  validar: (entrada, contexto) => {
    const tema = leerTexto(entrada, 'tema') as TemaDeCoordinacion | null
    if (contexto.rol !== 'admin') return { ok: false, error: 'Esta versión es la del panel de coordinación.' }
    if (!tema || !TEMAS_DE_COORDINACION.includes(tema)) return { ok: false, error: `Tema desconocido: ${tema ?? 'vacío'}.` }
    return { ok: true, valor: tema }
  },
  estado: () => 'Buscando cómo se hace…',
  ejecutar: async (_tx, tema) => resultadoDeExplicacion(explicarACoordinacion(tema), 'desde el panel'),
})

// ── catalogo ────────────────────────────────────────────────────────────
// Sale del catálogo congelado con la conversación y no de una consulta: es el
// mismo del que el sistema saca los nombres, así que lo que Migue dice acá no
// puede contradecir lo que dijo en la pregunta anterior. Un material nuevo
// aparece en la conversación siguiente.

const QUE_DEL_CATALOGO = ['puntos', 'materiales', 'recipientes'] as const
type QueDelCatalogo = (typeof QUE_DEL_CATALOGO)[number]

/** La lista del panel donde se mantiene cada cosa. */
const LISTA_DEL_PANEL: Record<QueDelCatalogo, { rotulo: string; ruta: string }> = {
  puntos: { rotulo: 'Sitios', ruta: '/listas/sitios' },
  materiales: { rotulo: 'Corrientes', ruta: '/listas/materiales' },
  recipientes: { rotulo: 'Recipientes', ruta: '/listas/unidades' },
}

const NOMBRE_DEL_TIPO_DE_SITIO: Record<string, string> = {
  planta: 'predio de la Planta',
  punto_verde: 'punto verde',
}

/** Hasta dos decimales, sin ceros de más: 0,2 m³ el tambor, 6 m³ el camión. */
function factorEscrito(factor: number): string {
  const decimales = Number.isInteger(factor) ? 0 : Number.isInteger(factor * 10) ? 1 : 2
  return numero(factor, decimales)
}

function catalogoDe(que: QueDelCatalogo, catalogo: Catalogo, contexto: ContextoDeHerramienta, numeros: Numeros) {
  switch (que) {
    case 'puntos':
      return catalogo.puntos.map((p) => {
        numeros.agregar(...cifrasDe(p.codigo, p.nombre, p.direccion))
        return {
          codigo: p.codigo,
          nombre: p.nombre,
          direccion: p.direccion || 'sin dirección cargada',
          tipo: NOMBRE_DEL_TIPO_DE_SITIO[p.tipo] ?? p.tipo,
          ...(p.tipo === 'punto_verde' && !p.cargaDetallada
            ? { modalidad: 'sólo conteo diario: los vecinos se cuentan en papel y se carga un total al cerrar' }
            : {}),
        }
      })
    case 'materiales': {
      // Al celular, sólo las corrientes de su flujo: son las que le ofrece el
      // formulario. Que «Compost» exista no le sirve a un punto verde, y
      // nombrárselo lo invita a buscarlo en una lista donde no está.
      //
      // Una corriente sin flujos marcados vale para todos: así lo dice la
      // 0003, así la ofrece Listas («Todos») y así filtra el formulario
      // (cardinality(flujos) = 0). Si la coordinadora crea «Aceite vegetal» sin
      // marcar flujos, el formulario de PV-01 la muestra, y Migue no puede
      // decirle al vigilador que ahí no se carga.
      const flujo = contexto.rol === 'vigilador' ? contexto.punto?.tipo : null
      const nombreDeRecipiente = new Map(catalogo.recipientes.map((r) => [r.codigo, r.nombre]))
      return catalogo.materiales
        .filter((m) => !flujo || m.flujos.length === 0 || m.flujos.includes(flujo))
        .map((m) => {
          const unidad = nombreDeRecipiente.get(m.unidad) ?? m.unidad
          numeros.agregar(...cifrasDe(m.nombre, m.categoria, unidad))
          return {
            nombre: m.nombre,
            categoria: m.categoria,
            // Una lista vacía el modelo la lee como «en ningún flujo».
            flujos: m.flujos.length ? m.flujos.map((f) => ETIQUETA_FLUJO[f] ?? f) : ['todos los flujos'],
            se_carga_como: m.tipos.map((t) => (ETIQUETA_TIPO[t] ?? t).toLowerCase()),
            se_mide_en: unidad,
          }
        })
    }
    case 'recipientes':
      return catalogo.recipientes.map((r) => {
        numeros.agregar(...cifrasDe(r.nombre))
        // El m³ es la medida de las demás: «1 m³ = 1 m³» no le dice nada a nadie.
        if (r.codigo === 'm3') return { nombre: r.nombre, equivale: 'es la medida en que se suma todo lo demás' }
        if (r.factorM3 === null) {
          return {
            nombre: r.nombre,
            equivale: 'no se suma a los m³: esa cantidad se informa aparte, en su propia línea',
          }
        }
        numeros.agregar(1, r.factorM3).cantidad(r.factorM3, 2)
        return { nombre: r.nombre, equivale: `1 ${r.nombre} = ${factorEscrito(r.factorM3)} m³` }
      })
  }
}

const DESCRIPCION_DE_QUE: Record<QueDelCatalogo, string> = {
  puntos: 'los puntos y predios, con su dirección',
  materiales: 'las corrientes que se cargan',
  recipientes: 'los recipientes y cuánto equivale cada uno en m³',
}

const catalogoDelSistema = definir<QueDelCatalogo>({
  nombre: 'catalogo',
  clase: 'lectura',
  roles: ['admin', 'vigilador'],
  descripcion: () =>
    'Las listas del sistema: «puntos» (código, nombre, dirección, si es predio de la Planta o punto verde, y si ' +
    'sólo carga el conteo diario), «materiales» (las corrientes: categoría, si entran o salen, en qué se miden) o ' +
    '«recipientes» (cuánto equivale cada uno en m³; kg y bolsa no se suman a los m³). Para «¿cuánto es un camión ' +
    'en metros?», «¿dónde queda el de Italia?». No trae cantidades cargadas.',
  parametros: () => ({
    type: 'object',
    properties: { que: { type: 'string', enum: [...QUE_DEL_CATALOGO], description: 'Qué lista.' } },
    required: ['que'],
    additionalProperties: false,
  }),
  validar: (entrada) => {
    const que = leerTexto(entrada, 'que') as QueDelCatalogo | null
    if (!que || !QUE_DEL_CATALOGO.includes(que)) return { ok: false, error: 'Tiene que ser puntos, materiales o recipientes.' }
    return { ok: true, valor: que }
  },
  estado: (que) => `Mirando ${DESCRIPCION_DE_QUE[que]}…`,
  ejecutar: async (_tx, que, contexto) => {
    const numeros = new Numeros()
    const filas = catalogoDe(que, contexto.catalogo, contexto, numeros)
    const { filas: aMostrar, nota: recorte } = recortar<unknown>(filas, 40)
    if (recorte) numeros.agregar(40, filas.length)

    const delFlujo = que === 'materiales' && contexto.rol === 'vigilador' && contexto.punto
      ? `, las que se cargan en ${contexto.punto.tipo === 'planta' ? 'la Planta' : 'los puntos verdes'}`
      : ''
    const lista = LISTA_DEL_PANEL[que]

    // Las listas son del panel: al celular no se le da un enlace que no puede
    // abrir. Lo que sabe, lo sabe por acá.
    const enlaces: Enlace[] = contexto.rol === 'admin' ? [enlace(lista.rotulo, lista.ruta, {}, 'filas')] : []
    return {
      alcance: `El catálogo del sistema: ${DESCRIPCION_DE_QUE[que]}${delFlujo}, tal como estaban al empezar esta conversación`,
      datos: { lista: aMostrar, ...(recorte ? { recorte } : {}) },
      enlaces,
      numeros: numeros.lista(),
    }
  },
})

// ── Lo que se exporta ───────────────────────────────────────────────────

/**
 * Ojo: `como_se_hace` aparece dos veces, una por rol. Quien arme el mapa de
 * herramientas por nombre tiene que filtrar por rol antes, o la segunda pisa a
 * la primera.
 */
export const HERRAMIENTAS_COMPARTIDAS: Herramienta[] = [
  comoSeHaceEnElPunto,
  comoSeHaceEnElPanel,
  catalogoDelSistema,
]
