/**
 * Los pasos del recorrido que explican la pantalla donde se lo abre. Van
 * antes de los de siempre (el menú, Migue, el tema, la cuenta), porque quien
 * toca el «?» casi siempre quiere saber qué es lo que tiene adelante.
 *
 * El destino «pantalla» es la cabecera de la pantalla (su título y lo que
 * dice abajo); los demás son marcas data-recorrido en esa pantalla. El que no
 * está —«Exportar» sin filas, por ejemplo— se saltea.
 *
 * Va por el prefijo más largo de la ruta, como las preguntas de Migue. Un
 * prefijo terminado en «/*» es sólo para lo que cuelga de él: el detalle de
 * un movimiento y no el listado.
 */
export interface Paso {
  /** El data-recorrido de lo que se ilumina. Sin destino, la tarjeta va al medio. */
  destino?: string
  titulo: string
  texto: string
}

type Pantallas = Record<string, Paso[]>

const EXPORTAR: Paso = {
  destino: 'exportar',
  titulo: 'Exportar a Excel',
  texto: 'Descarga lo que estás viendo, para trabajarlo en una planilla.',
}

const DEL_PANEL: Pantallas = {
  '/tablero': [
    {
      destino: 'pantalla',
      titulo: 'Planta de Valorización',
      texto: 'Los números del mes en la Planta, el volumen mes a mes y el detalle por material.',
    },
    EXPORTAR,
  ],
  '/tablero/puntos-verdes': [
    {
      destino: 'pantalla',
      titulo: 'Puntos Verdes',
      texto: 'Lo que recibió cada punto verde, por semana o por mes. El período se elige arriba.',
    },
    EXPORTAR,
  ],
  '/movimientos': [
    {
      destino: 'pantalla',
      titulo: 'Movimientos',
      texto: 'Todo lo que se cargó, en la Planta y en los puntos. Cada fila abre el detalle.',
    },
    {
      destino: 'filtros',
      titulo: 'Los filtros',
      texto: 'Por punto, tipo, material, patente o fechas. La suma y el listado siguen a lo que pongas.',
    },
    { ...EXPORTAR, texto: 'Descarga el listado con los filtros puestos.' },
  ],
  '/movimientos/*': [
    {
      destino: 'pantalla',
      titulo: 'Un movimiento',
      texto: 'Todo lo que se cargó en este registro, dónde y cuándo. Si estuvo mal, se anula con el motivo: no se borra.',
    },
  ],
  '/pilas': [
    {
      destino: 'pantalla',
      titulo: 'Pilas de compost',
      texto: 'En qué etapa está cada pila, cuándo va a estar lista y cuáles se están quedando sin voltear. Desde acá se abre una nueva.',
    },
  ],
  '/pilas/*': [
    {
      destino: 'pantalla',
      titulo: 'Una pila',
      texto: 'De qué está hecha, cómo se la trató y qué salió de ella.',
    },
  ],
  '/trazabilidad': [
    {
      destino: 'pantalla',
      titulo: 'Trazabilidad',
      texto: 'De dónde salió cada camión de compost: la pila que lo formó y de dónde vino lo que entró en ella.',
    },
  ],
  '/conteos': [
    {
      destino: 'pantalla',
      titulo: 'Conteos diarios',
      texto: 'Los vecinos que se cuentan en papel y se cargan al cerrar el día. Muestra qué puntos están al día y cuáles hace días que no mandan nada.',
    },
  ],
  '/recambios': [
    {
      destino: 'pantalla',
      titulo: 'Recambios de contenedores',
      texto: 'Los contenedores que pidieron los puntos y desde cuándo esperan. Acá se anota cuándo se avisó a los choferes y cuándo vinieron.',
    },
  ],
  '/revisiones': [
    {
      destino: 'pantalla',
      titulo: 'Revisiones',
      texto: 'Lo que los vigiladores cargaron fuera de las listas, para que lo confirmes o lo ordenes. El número del menú cuenta lo que espera.',
    },
  ],
  '/listas': [
    {
      destino: 'pantalla',
      titulo: 'Listas',
      texto: 'Todo lo que el vigilador elige en el celular sale de acá. Lo que se desactiva deja de ofrecerse, pero no se borra.',
    },
  ],
  '/listas/*': [
    {
      destino: 'pantalla',
      titulo: 'Una lista',
      texto: 'Agregá, corregí o desactivá lo que se ofrece en el celular. Lo que ya se usó se sigue viendo igual.',
    },
  ],
  '/vecinos': [
    {
      destino: 'pantalla',
      titulo: 'Vecinos',
      texto: 'Quienes traen material y dejaron sus datos. Es la única pantalla con datos personales: mirá sólo lo que haga falta.',
    },
  ],
  '/usuarios': [
    {
      destino: 'pantalla',
      titulo: 'Usuarios y accesos',
      texto: 'Un usuario por punto y uno por cada persona de coordinación. Acá se crean, se resetea el PIN de un punto o se cambia una contraseña.',
    },
  ],
  '/importar': [
    {
      destino: 'pantalla',
      titulo: 'Importar pesos',
      texto: 'Los kilos que informa la planta de la 9 de Julio, para cruzarlos con lo registrado en cada punto. Una importación se puede revertir.',
    },
  ],
  '/auditoria': [
    {
      destino: 'pantalla',
      titulo: 'Auditoría',
      texto: 'Qué se cargó, cambió o anuló, quién y cuándo. Nadie puede editar ni borrar una línea de acá.',
    },
  ],
  '/cuenta': [
    {
      destino: 'pantalla',
      titulo: 'Mi cuenta',
      texto: 'Tu correo del municipio y tu contraseña. Para cambiar la contraseña te pide la actual.',
    },
  ],
  '/migue': [
    {
      destino: 'pantalla',
      titulo: 'Preguntale a Migue',
      texto: 'El chat con Migue a pantalla completa. Lee lo cargado y contesta; no cambia nada.',
    },
  ],
  '/migue/recuerdos': [
    {
      destino: 'pantalla',
      titulo: 'Lo que Migue recuerda',
      texto: 'Lo que Migue tiene guardado de vos y de cada punto, y las palabras nuevas que propone usar, para que las apruebes.',
    },
  ],
}

const DEL_PUNTO: Pantallas = {
  '/turno': [
    {
      destino: 'pantalla',
      titulo: 'Lo que se hace en el turno',
      texto: 'Cargar lo que trae un vecino, lo que se lleva alguien, el conteo del día y el pedido de recambio. Sin señal, lo cargado se guarda en el celular y sube cuando vuelve.',
    },
  ],
  '/cargar': [
    {
      destino: 'pantalla',
      titulo: 'Registrar',
      texto: 'Completá lo que corresponde y guardá. Sin señal queda en el celular y sube solo cuando vuelve.',
    },
  ],
  '/listo': [
    {
      destino: 'pantalla',
      titulo: 'Guardado',
      texto: 'Lo que cargaste quedó guardado. Si no había señal, sube solo cuando vuelve.',
    },
  ],
  '/conteo': [
    {
      destino: 'pantalla',
      titulo: 'Conteo del día',
      texto: 'Cuántos vecinos vinieron, en un solo número, para el día que no se pudo cargar de a uno. También se completa un día que quedó atrás.',
    },
  ],
  '/contenedores': [
    {
      destino: 'pantalla',
      titulo: 'Contenedores',
      texto: 'Pedí el recambio del que está lleno y mirá cómo va lo que ya pediste.',
    },
  ],
  '/hoy': [
    {
      destino: 'pantalla',
      titulo: 'Lo de hoy',
      texto: 'Lo que se cargó hoy en este punto, y lo que todavía espera señal para subir.',
    },
  ],
  '/pila': [
    {
      destino: 'pantalla',
      titulo: 'Control de las pilas',
      texto: 'Anotá el volteo o el riego de cada pila.',
    },
  ],
  '/preguntar': [
    {
      destino: 'pantalla',
      titulo: 'Preguntale a Migue',
      texto: 'Preguntale sobre lo que cargaste. No carga nada: eso lo hacés vos.',
    },
  ],
  '/preguntar/recuerdos': [
    {
      destino: 'pantalla',
      titulo: 'Lo que Migue recuerda',
      texto: 'Lo que Migue tiene guardado de este punto para contestar mejor.',
    },
  ],
}

export function recorridoDeLaPantalla(rol: 'admin' | 'vigilador', ruta: string): Paso[] {
  const pantallas = rol === 'admin' ? DEL_PANEL : DEL_PUNTO
  let mejor: string | null = null
  let largo = -1
  for (const clave of Object.keys(pantallas)) {
    const soloDetalle = clave.endsWith('/*')
    const prefijo = soloDetalle ? clave.slice(0, -2) : clave
    const coincide = soloDetalle
      ? ruta.startsWith(`${prefijo}/`)
      : ruta === prefijo || ruta.startsWith(`${prefijo}/`)
    // A igual prefijo gana el detalle: es más específico.
    const peso = prefijo.length * 2 + (soloDetalle ? 1 : 0)
    if (coincide && peso > largo) { mejor = clave; largo = peso }
  }
  return mejor ? pantallas[mejor] : []
}
