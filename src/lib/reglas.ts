/**
 * Las reglas de tiempo del sistema, escritas una sola vez.
 *
 * La que manda es la base: cada una de estas cifras está en una política o en
 * un disparador, y es la base la que rechaza lo que se pasa. Acá están para
 * que las pantallas y Migue digan lo mismo que la base hace. Antes vivían
 * sueltas en cada pantalla —el 10 en /listo, el 7 en /conteo y en su acción,
 * el 24 en /contenedores— y Migue tenía que poder citarlas sin inventarlas: una
 * respuesta como «tenés 10 minutos para deshacerlo» sólo pasa el control de
 * números si el 10 sale de una consulta, y ésta es la consulta.
 *
 * Si alguna cambia en una migración, cambia acá también: db:verificar compara
 * cada una contra el texto de su política y falla si no coinciden.
 */

/** 0010_rls.sql, `movimientos_deshacer`: el vigilador anula lo propio hasta acá. */
export const MINUTOS_PARA_DESHACER = 10

/** 0010_rls.sql, `movimientos_leer`: lo que un celular ve de los movimientos de su punto. */
export const HORAS_VISIBLES_EN_EL_CELULAR = 48

/** 0007_movimientos.sql, `app.validar_fecha_movimiento`: no se carga algo que pasó hace más de esto. */
export const HORAS_DE_ATRASO_MAXIMO = 48

/** 0007_movimientos.sql, el mismo disparador: pasado esto, la carga queda marcada como diferida. */
export const MINUTOS_PARA_CARGA_DIFERIDA = 30

/** 0017_conteo_diario.sql, `conteos_crear` y `conteos_editar`: el celular carga o corrige hasta acá. */
export const DIAS_DE_CONTEO_PARA_ATRAS = 7

/** 0018_recambio_contenedores.sql, `pedidos_cancelar`: el punto cancela lo que pidió hasta acá. */
export const HORAS_PARA_CANCELAR_PEDIDO = 24

/** 0018_recambio_contenedores.sql, `v_pedidos_recambio.demorado`: un pedido abierto hace más de esto. */
export const DIAS_PARA_PEDIDO_DEMORADO = 3

// ── Las que son de pantalla, no de la base ──────────────────────────────
// Éstas no las hace cumplir ninguna política: son criterios de lectura. Están
// acá por lo mismo que las de arriba: Migue las cita, y tiene que decir lo
// mismo que la pantalla.

/** /conteos: un punto que no mandó nada en más días que esto aparece como callado. */
export const DIAS_PARA_PUNTO_CALLADO = 3

/** /conteos: los conteos de cuántos días para atrás muestra el panel. */
export const DIAS_DE_CONTEOS_EN_EL_PANEL = 30

/** /revisiones: un destino escrito a mano que aparece esta cantidad de veces conviene formalizarlo. */
export const VECES_PARA_DESTINO_REPETIDO = 5

// ── Las de Migue ────────────────────────────────────────────────────────

/** 0025_migue.sql, `app.migue_vencer`: lo del punto vence igual que lo que ve de los movimientos. */
export const HORAS_DE_CONVERSACION_DEL_PUNTO = 48

/** 0025_migue.sql, `app.migue_vencer`. */
export const DIAS_DE_CONVERSACION_DE_COORDINACION = 90

/** 0025_migue.sql, `app.migue_vencer`: una conversación del punto quieta se cierra, para el turno siguiente. */
export const HORAS_PARA_CERRAR_QUIETA = 2

/** 0025_migue.sql, `app.migue_recordar`. */
export const RECUERDOS_MAXIMOS = 20
