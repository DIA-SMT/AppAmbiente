-- ═══════════════════════════════════════════════════════════════════════
-- 0011 · Vistas de consulta
--
-- Todas con security_invoker: las políticas de 0010 se evalúan con el usuario
-- que consulta, no con el dueño de la vista. Un vigilador que lea estas vistas
-- ve exactamente lo mismo que si leyera las tablas.
--
-- Para los nombres de entidades y personas se usan las vistas públicas, que no
-- exponen CUIT, teléfono ni documento. Así el vigilador ve "Vivero Municipal"
-- en el listado de su turno sin tener acceso a la ficha completa.
-- ═══════════════════════════════════════════════════════════════════════

create view v_movimientos with (security_invoker = true) as
select
  m.id,
  m.numero,
  m.flujo,
  m.tipo,
  m.estado,
  m.ocurrido_en,
  m.carga_diferida,
  m.creado_en,
  m.observaciones,
  m.tipo_valorizacion,
  m.vecino_sin_datos,
  m.motivo_anulacion,
  m.anulado_en,

  s.id       as sitio_id,
  s.nombre   as sitio_nombre,
  s.codigo   as sitio_codigo,

  m.origen_clase,
  coalesce(os.nombre, oe.nombre, case when m.origen_clase = 'vecino' then 'Vecino' end, m.origen_detalle)
    as origen_nombre,
  m.destino_clase,
  coalesce(ds.nombre, de.nombre, case when m.destino_clase = 'vecino' then 'Vecino' end, m.destino_detalle)
    as destino_nombre,
  de.tipo    as destino_entidad_tipo,

  v.patente  as patente,
  v.tipo     as vehiculo_tipo,
  ch.nombre  as chofer_nombre,
  au.nombre  as autorizante_nombre,
  vg.nombre  as vigilador_nombre,
  p.nombre   as cargado_por_nombre,
  m.cargado_por_id,

  (select count(*)                     from movimiento_items i where i.movimiento_id = m.id) as items,
  (select string_agg(mt.nombre, ' + ' order by mt.nombre)
     from movimiento_items i join materiales mt on mt.id = i.material_id
    where i.movimiento_id = m.id)                                                            as materiales,
  (select sum(i.cantidad) from movimiento_items i where i.movimiento_id = m.id)              as cantidad_total
from movimientos m
  join sitios s               on s.id  = m.sitio_id
  left join sitios os         on os.id = m.origen_sitio_id
  left join entidades_publicas oe on oe.id = m.origen_entidad_id
  left join sitios ds         on ds.id = m.destino_sitio_id
  left join entidades_publicas de on de.id = m.destino_entidad_id
  left join vehiculos v       on v.id  = m.vehiculo_id
  left join personas_publicas ch on ch.id = m.chofer_id
  left join personas_publicas au on au.id = m.autorizado_por_id
  left join personas_publicas vg on vg.id = m.vigilador_id
  left join perfiles p        on p.id  = m.cargado_por_id;

grant select on v_movimientos to authenticated;

-- Una fila por material movido. Es la base de la exportación a Excel y del
-- tablero: sumar por acá no cuenta dos veces un movimiento con dos materiales.
create view v_movimiento_items with (security_invoker = true) as
select
  i.id           as item_id,
  i.movimiento_id,
  i.cantidad,
  i.observacion,
  mt.id          as material_id,
  mt.nombre      as material_nombre,
  mt.categoria   as material_categoria,
  mt.color       as material_color,
  u.id           as unidad_id,
  u.codigo       as unidad_codigo,
  u.nombre       as unidad_nombre,
  u.nombre_plural as unidad_plural,
  u.factor_m3,
  round(i.cantidad * coalesce(u.factor_m3, 0), 2) as equivalente_m3,
  m.numero, m.flujo, m.tipo, m.estado, m.ocurrido_en, m.sitio_id,
  date_trunc('month', m.ocurrido_en)::date as mes,
  date_trunc('week',  m.ocurrido_en)::date as semana
from movimiento_items i
  join movimientos m on m.id  = i.movimiento_id
  join materiales mt on mt.id = i.material_id
  join unidades u    on u.id  = i.unidad_id;

grant select on v_movimiento_items to authenticated;

-- El indicador de la fase 1: entradas y salidas de Planta por material y mes.
create view v_resumen_mensual with (security_invoker = true) as
select
  sitio_id,
  flujo,
  tipo,
  mes,
  material_id,
  material_nombre,
  material_color,
  unidad_codigo,
  unidad_plural,
  count(distinct movimiento_id) as movimientos,
  sum(cantidad)                 as cantidad,
  sum(equivalente_m3)           as equivalente_m3
from v_movimiento_items
where estado = 'vigente'
group by sitio_id, flujo, tipo, mes, material_id, material_nombre, material_color,
         unidad_codigo, unidad_plural;

grant select on v_resumen_mensual to authenticated;
