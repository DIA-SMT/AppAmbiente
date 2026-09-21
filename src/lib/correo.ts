/**
 * El correo con el que se entra al panel.
 *
 * Vive acá y no en cada pantalla porque lo preguntan dos lugares —el alta de
 * Usuarios y Mi cuenta— y los dos tienen que contestar lo mismo. Con la regla
 * escrita dos veces, endurecer una sola deja cuentas que se pueden crear pero
 * no completar, o al revés.
 *
 * ── POR QUÉ NO SE EXIGE EL DOMINIO DEL MUNICIPIO ───────────────────────
 *
 * Al principio se exigía `@smt.gob.ar`. Duró hasta la primera persona real: la
 * cuenta de coordinación que va a usar la app no tiene casilla institucional, y
 * cargar el correo es el ÚNICO camino que saca a una cuenta de la pantalla Mi
 * cuenta. O sea que la baranda que estaba puesta para evitar una equivocación
 * dejaba encerrada, sin salida desde adentro, a la única persona que la iba a
 * usar. Destrabarla era tocar el código y volver a desplegar.
 *
 * Se aceptan todas, entonces, y el motivo es que la exigencia nunca fue
 * seguridad. Una cuenta de coordinación la crea otra cuenta de coordinación:
 * quien puede poner un Gmail ya podía poner cualquier `@smt.gob.ar` inventado.
 * Lo que de verdad corta el acceso es desactivar el usuario desde el panel, y
 * eso lo hace efectivo en el pedido siguiente aunque tenga la sesión abierta.
 *
 * Lo que sí se pierde y conviene tener presente: con una casilla personal, el
 * acceso ya no se muere junto con la cuenta municipal el día que esa persona
 * deja la Secretaría. Hay que ir a desactivarla desde Usuarios. Por eso las dos
 * pantallas piden por escrito usar la del municipio cuando exista —lo piden, no
 * lo imponen— y el ejemplo del campo sigue siendo una dirección @smt.gob.ar.
 *
 * Sigue habiendo un índice único sobre el correo en minúsculas: dos cuentas no
 * pueden compartirlo, porque es con lo que se entra.
 */

/** Se muestra como ejemplo cuando hace falta uno. */
export const DOMINIO_PRINCIPAL = 'smt.gob.ar'

export function normalizarCorreo(bruto: string): string {
  return bruto.trim().toLowerCase()
}

/**
 * Que tenga forma de correo, y nada más.
 *
 * No valida que exista ni que reciba: nadie manda un mail de confirmación acá,
 * así que pretender más rigor del que se puede comprobar es rechazar
 * direcciones buenas por gusto. Lo único que frena esto es el error de tipeo
 * que no tiene arroba o no tiene punto después.
 */
export function esCorreoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)
}
