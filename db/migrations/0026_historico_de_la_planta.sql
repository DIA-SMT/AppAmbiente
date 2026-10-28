-- ═══════════════════════════════════════════════════════════════════════
-- 0026 · El histórico de la Planta, cargado desde el panel
--
-- Hasta ahora el R-05 de la Secretaría sólo entraba por la línea de comandos,
-- y lo que entraba no quedaba atado a nada: no había forma de saber qué
-- movimientos salieron de qué archivo, ni de sacarlos si el archivo vino mal.
-- Desde el panel eso no alcanza. La coordinadora sube el Excel todos los meses
-- —es una planilla viva, que crece— y tiene que poder revertir lo que subió.
--
-- Tres cosas:
--
--   · importaciones.tipo, para separar los pesos de la 9 de Julio del
--     histórico. Hasta ahora la tabla era sólo de pesos, y la pantalla de
--     pesos revertía cualquier importación marcándola y nada más: con un
--     histórico eso dejaría los movimientos vivos y la importación «revertida».
--
--   · movimientos.importacion_id, para saber de qué importación salió cada
--     movimiento y poder anularlos todos juntos.
--
--   · movimientos.importacion_clave, que identifica la fila de la planilla por
--     lo que dice y no por el archivo. Subir el mismo R-05 el mes que viene, con
--     doscientas filas más, sólo carga las doscientas. Es único sólo entre los
--     vigentes: después de revertir, la misma fila tiene que poder volver a
--     entrar.
-- ═══════════════════════════════════════════════════════════════════════

alter table importaciones
  add column tipo text not null default 'pesos_contenedores'
  check (tipo in ('pesos_contenedores', 'movimientos_historicos'));

-- Lo que el CLI importó antes de esta migración quedó como una importación sin
-- mapeo y sin una sola fila de pesos: ésas son históricos, no pesos.
update importaciones i
   set tipo = 'movimientos_historicos'
 where i.mapeo_id is null
   and not exists (select 1 from pesos_externos p where p.importacion_id = i.id);

alter table movimientos
  add column importacion_id uuid references importaciones (id) on delete restrict,
  add column importacion_clave text;

create index movimientos_importacion_idx on movimientos (importacion_id)
  where importacion_id is not null;

create unique index movimientos_importacion_clave_idx on movimientos (importacion_clave)
  where estado = 'vigente';

comment on column movimientos.importacion_id is
  'La importación de la que salió el movimiento. Null para todo lo que se cargó a mano o desde el celular.';
comment on column movimientos.importacion_clave is
  'Qué fila de la planilla es, calculado por su contenido. Lo usa el histórico para no cargar dos veces la misma fila.';
