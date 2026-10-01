/**
 * Cuándo la ventana de Migue ocupa la pantalla entera: un teléfono parado
 * (menos de 720 de ancho) o acostado (más ancho que eso, pero con dedo y
 * menos de 500 de alto, donde la tarjeta de escritorio quedaba de 260 y el
 * teclado le tapaba el cuadro entero).
 *
 * El CSS no puede importar esto: la misma consulta está escrita a mano en
 * burbuja.module.css y en conversacion.module.css («Pantalla entera»), y la
 * contraria en el bloque «Escritorio». Si cambia acá, cambia en los tres
 * lugares.
 */
export const PANTALLA_ENTERA = '(max-width: 720px), (pointer: coarse) and (max-height: 500px)'

/**
 * Dónde poner el foco en el cuadro levanta un teclado en pantalla. Es otra
 * pregunta que la de arriba: una tableta se toca con el dedo y ve la tarjeta
 * de escritorio, y una ventana de escritorio angosta ve la pantalla entera
 * pero se usa con teclado de verdad.
 */
export const TECLADO_EN_PANTALLA = '(pointer: coarse)'
