/**
 * El largo máximo de una pregunta, escrito una sola vez.
 *
 * Vive acá, solo y sin importar nada, porque lo leen los dos lados: el cuadro
 * del chat, que no deja escribir más, y la ruta que contesta, que rechaza lo
 * que llegue más largo igual. Si estuviera en la configuración o en el
 * orquestador, el componente del celular arrastraría `server-only` y la base;
 * si estuviera escrito dos veces, el día que cambie uno el vigilador escribe
 * una pregunta entera, la manda con el pulgar y recibe un error que el cuadro
 * no le avisó.
 *
 * 600 letras son unas diez líneas en el celular. Las preguntas reales del
 * relevamiento no pasan de ochenta («ya pedi el contenedor de plastico?»), y
 * lo que viene más largo casi nunca es una pregunta: es una lista de vecinos
 * pegada, o un texto que alguien quiere que Migue tome como instrucción. Cada
 * letra además viaja al proveedor en todas las preguntas siguientes de la
 * conversación, porque la historia se reenvía entera.
 */
export const LARGO_MAXIMO_PREGUNTA = 600

// ── Datos personales ────────────────────────────────────────────────────
// Un teléfono, un documento, un CUIT o un correo no tienen por qué viajar al
// proveedor ni quedar en una conversación que lee el turno siguiente. Se
// reconocen acá, una sola vez, por dos caminos: la pregunta que escribe la
// persona (se rechaza entera) y el texto escrito a mano que devuelve una
// consulta —una observación, un destino de la calle— (se tapa y sigue).
//
// La forma: siete dígitos o más, con hasta tres caracteres de separación entre
// uno y otro («381 - 555 - 1234», «381_555_1234», «30-12345678-9»). Antes de
// mirar se pasa a NFKC, porque algunos teclados de celular escriben dígitos de
// ancho completo («３８１…») que ninguna expresión con \d reconoce. Y antes se
// apartan las fechas: «del 01-09-2026 al 15-09-2026» son ocho dígitos con un
// guion y no son el teléfono de nadie; rechazarlas le decía a la coordinadora
// que no escriba teléfonos cuando había escrito una fecha.

const FECHAS = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
  /\b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\b/g,
  /\b(?:19|20)\d{2}\b/g,
]
// El «+» opcional es el del prefijo internacional: sin él, «+54 9 381…» quedaba
// «+[dato personal quitado]».
const TELEFONO_O_DOCUMENTO = /\+?\d(?:[\s._()\-]{0,3}\d){6,}/g
const CORREO = /[^\s@]+\s*@\s*[^\s@]+|\S+\s*\(?\s*\barroba\b\s*\)?\s*\S+/gi

/** Si el texto trae algo con forma de teléfono, documento o correo. */
export function tieneDatoPersonal(texto: string): boolean {
  let limpio = texto.normalize('NFKC')
  for (const fecha of FECHAS) limpio = limpio.replace(fecha, ' ')
  return new RegExp(TELEFONO_O_DOCUMENTO.source).test(limpio) || new RegExp(CORREO.source, 'i').test(limpio)
}

/**
 * El mismo texto con esos datos tapados. Las fechas se guardan aparte y se
 * vuelven a poner, así un «vino el 01-09-2026» no pierde la fecha.
 */
export function taparDatosPersonales(texto: string): string {
  const apartadas: string[] = []
  let limpio = texto.normalize('NFKC')
  for (const fecha of FECHAS) {
    limpio = limpio.replace(fecha, (f) => `\u0000${apartadas.push(f) - 1}\u0000`)
  }
  limpio = limpio.replace(TELEFONO_O_DOCUMENTO, '[dato personal quitado]').replace(CORREO, '[dato personal quitado]')
  return limpio.replace(/\u0000(\d+)\u0000/g, (_, i) => apartadas[Number(i)])
}
