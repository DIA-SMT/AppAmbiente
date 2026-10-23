/**
 * El tema claro u oscuro que eligió la persona en este navegador.
 *
 * Sin elección, manda el dispositivo (prefers-color-scheme), como siempre. Con
 * elección, va en <html data-tema="claro|oscuro">, que globals.css ya
 * respeta. Se guarda en el navegador y no en la cuenta: la cuenta del punto
 * la comparten varios, y el tema es del teléfono, no de la persona.
 */
export type Tema = 'claro' | 'oscuro'

export const CLAVE_DEL_TEMA = 'ambiente.tema'

/**
 * Corre en <head>, antes de que se dibuje nada: si esperara a React, la
 * pantalla saldría un instante en el tema del dispositivo y después saltaría.
 * Sin localStorage (modo privado) no hace nada y queda el del dispositivo.
 */
export const SCRIPT_DEL_TEMA = `try{var t=localStorage.getItem('${CLAVE_DEL_TEMA}');if(t==='claro'||t==='oscuro')document.documentElement.dataset.tema=t}catch(e){}`
