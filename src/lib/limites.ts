/**
 * Los dos topes del archivo que se importa, escritos una sola vez.
 *
 * Viven acá y no en importacion.ts porque los necesita también el navegador:
 * el único lugar donde se puede decir la frase completa —qué pasó y qué hacer—
 * es antes de mandar el pedido. Si el archivo sale igual, Next lo corta por
 * `serverActions.bodySizeLimit` y la promesa de la acción se rompe fuera de
 * todo try/catch: con useActionState eso no llega como { ok: false, error },
 * llega como pantalla rota.
 *
 * Por eso TAMANO_MAXIMO está bien por debajo del bodySizeLimit de
 * next.config.ts y no pegado a él: el cuerpo del pedido lleva el archivo más el
 * mapeo, la hoja, el nombre y los separadores del multipart, así que el margen
 * tiene que alcanzar para todo eso. El archivo real de la planta pesa 40 KB.
 */

/** 2 MB. El de agosto pesa 40 KB y un año entero no llega a medio mega. */
export const TAMANO_MAXIMO = 2 * 1024 * 1024

/**
 * Filas de datos que se leen como máximo.
 *
 * Cortar por bytes no alcanza: un .xlsx comprime muy bien y unos pocos megas
 * dan para cientos de miles de filas, que es memoria que el proceso no tiene
 * —medido: 200.000 filas son 1,2 GB de RSS—. Cuando la función se queda sin
 * memoria nadie ve un error: se cae y listo. Así que el tope real es por
 * cantidad de filas y se revisa apenas se sabe cuántas hay, antes de armar una
 * sola fila en memoria.
 *
 * 10.000 son casi tres años de la planta de la 9 de Julio, que manda 287 filas
 * por mes.
 */
export const TOPE_FILAS = 10_000

/** El mismo texto en el navegador y en el servidor: es el mismo problema. */
export function avisoDeTamano(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1).replace('.', ',')
  return (
    `El archivo pesa ${mb} MB y el máximo son 2 MB. El de la planta pesa unos 40 KB, `
    + 'así que uno de este tamaño casi seguro trae más de un año junto o tiene imágenes '
    + 'pegadas adentro. Partilo por mes y subí uno por vez.'
  )
}
