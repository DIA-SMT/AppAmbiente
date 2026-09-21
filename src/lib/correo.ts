/**
 * El correo institucional con el que se entra al panel.
 *
 * Vive acá y no en cada pantalla porque lo preguntan dos lugares —el alta de
 * Usuarios y Mi cuenta— y los dos tienen que contestar lo mismo. Con la lista
 * escrita dos veces, agregar un dominio en una sola deja cuentas que se pueden
 * crear pero no completar, o al revés.
 *
 * Y vive en el código y no en un check de la base a propósito: el día que la
 * Secretaría aparezca con una casilla de otro dominio, agregarlo es una línea y
 * un despliegue, y no una migración sobre una base en uso.
 */

/** Los dominios institucionales, sin arroba y sin punto adelante. */
export const DOMINIOS_INSTITUCIONALES = ['smt.gob.ar']

/** Para los mensajes de pantalla: el que se le muestra a la gente. */
export const DOMINIO_PRINCIPAL = DOMINIOS_INSTITUCIONALES[0]

export function normalizarCorreo(bruto: string): string {
  return bruto.trim().toLowerCase()
}

/**
 * Vale el dominio institucional y también cualquier subdominio suyo.
 *
 * Los subdominios entran a propósito. El municipio reparte casillas por
 * dependencia —algo@rrhh.smt.gob.ar, algo@ia.smt.gob.ar— y cargar el correo es
 * el ÚNICO camino que saca a una cuenta de /cuenta: si el formulario le rechaza
 * su propia dirección, esa persona queda encerrada en esa pantalla sin ninguna
 * salida desde adentro, y destrabarla es tocar el código y volver a desplegar.
 *
 * Se compara contra el dominio y no con endsWith() sobre el correo entero para
 * que «alguien@nosmt.gob.ar» no pase por terminar parecido.
 */
export function esCorreoInstitucional(correo: string): boolean {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return false
  const dominio = correo.slice(correo.lastIndexOf('@') + 1)
  return DOMINIOS_INSTITUCIONALES.some((d) => dominio === d || dominio.endsWith(`.${d}`))
}
