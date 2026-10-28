/**
 * Las preguntas que la burbuja ofrece según la pantalla donde se la abre.
 *
 * La idea es que la primera pregunta sea un toque: quien está en Recambios
 * casi siempre quiere saber qué está demorado, y quien está cargando una
 * salida, cómo se deshace si se equivocó. Si no está lo que busca, «Preguntar
 * otra cosa» abre el cuadro y de ahí la charla es libre.
 *
 * Cada una tiene con qué contestarse: cae en una herramienta de Migue o en un
 * tema de como_se_hace (src/lib/migue/herramientas). Una pregunta ofrecida que
 * termina en «eso no lo puedo ver» enseña, de entrada, a no preguntarle. Por
 * eso tampoco hay ninguna sobre volteos de pilas, que todavía no llegan al
 * tablero.
 *
 * Va por el prefijo más largo de la ruta. Una pantalla que no está acá usa los
 * ejemplos de siempre del rol (textos.ts).
 */
import type { RolDeMigue } from '@/lib/migue/tipos'

type Pantallas = Record<string, string[]>

const DEL_PANEL: Pantallas = {
  '/tablero': [
    '¿Cuánto entró a la Planta el mes pasado?',
    '¿Qué puntos hace días que no cargan nada?',
    '¿Qué pedidos de recambio están demorados?',
  ],
  '/tablero/puntos-verdes': [
    '¿Qué puntos hace días que no cargan nada?',
    '¿Cuántos vecinos llevaron reciclables este mes?',
    '¿Qué pedidos de recambio están demorados?',
  ],
  '/movimientos': [
    '¿Cuántos ingresos hubo esta semana en la Planta?',
    '¿Cuántas salidas no dicen de qué pila salieron?',
    '¿Cómo se anula un movimiento?',
  ],
  '/trazabilidad': [
    '¿Adónde fue lo que salió de la Planta este mes?',
    '¿Cuántas salidas no dicen de qué pila salieron?',
  ],
  '/pilas': [
    '¿Qué pilas están activas ahora?',
    '¿Cuántos m³ tiene cada pila activa?',
    '¿Cómo se cierra una pila?',
  ],
  '/conteos': [
    '¿Cuántos vecinos se contaron ayer en los puntos?',
    '¿Qué puntos no hicieron el conteo de hoy?',
  ],
  '/recambios': [
    '¿Qué pedidos de recambio están demorados?',
    '¿Qué punto tarda más en recibir el recambio?',
  ],
  '/revisiones': [
    '¿Qué hay para revisar hoy?',
    '¿Cómo se formaliza un destino escrito a mano?',
  ],
  '/vecinos': [
    '¿Cuántos vecinos llevaron reciclables este mes?',
    '¿Qué puntos hace días que no cargan nada?',
  ],
  '/listas': [
    '¿Qué materiales hay cargados en el sistema?',
    '¿Qué destinos hay en la lista?',
  ],
  '/usuarios': [
    '¿Cómo se da de alta un usuario?',
    '¿Qué puntos hace días que no cargan nada?',
  ],
  '/importar': [
    '¿Cómo se importan los pesos de la 9 de Julio?',
    '¿Cuánto entró a la Planta el mes pasado?',
  ],
  '/importar/historico': [
    '¿Cuánta poda entró a la Planta en 2025?',
    '¿Qué orígenes quedaron escritos como texto?',
  ],
}

const DEL_PUNTO: Pantallas = {
  '/cargar': [
    'Me equivoqué en la última carga, ¿la puedo deshacer?',
    '¿Cómo cargo algo que pasó ayer?',
    '¿Qué hago si no tengo señal?',
  ],
  '/listo': [
    'Me equivoqué en esta carga, ¿la puedo deshacer?',
    '¿Qué cargué hoy?',
  ],
  '/hoy': [
    '¿Qué cargué hoy?',
    '¿Cuál fue el número del último que cargué?',
  ],
  '/conteo': [
    '¿Cuántos vecinos puse en el conteo de ayer?',
    'Me equivoqué en el conteo, ¿lo puedo corregir?',
  ],
  '/contenedores': [
    '¿Qué contenedores tengo acá?',
    '¿Ya pedí el recambio del cartón?',
    '¿Cómo cancelo un pedido de recambio?',
  ],
  '/pila': [
    '¿Qué pilas hay activas en el predio?',
    '¿Cuántos m³ tiene cada pila?',
  ],
}

/** Las de la pantalla, o null si para esa pantalla van los ejemplos de siempre. */
export function preguntasDeLaPantalla(rol: RolDeMigue, ruta: string): string[] | null {
  const pantallas = rol === 'admin' ? DEL_PANEL : DEL_PUNTO
  let mejor: string | null = null
  for (const prefijo of Object.keys(pantallas)) {
    const coincide = ruta === prefijo || ruta.startsWith(`${prefijo}/`)
    if (coincide && (!mejor || prefijo.length > mejor.length)) mejor = prefijo
  }
  return mejor ? pantallas[mejor] : null
}
