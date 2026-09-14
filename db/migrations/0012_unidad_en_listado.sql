-- ═══════════════════════════════════════════════════════════════════════
-- 0012 · La unidad en el listado
--
-- v_movimientos traía cantidad_total pero no la unidad, así que el listado del
-- turno mostraba "Poda · 12" en vez de "Poda · 12 m³". La unidad es el punto de
-- toda la estandarización: sin ella el número no dice nada, que es exactamente
-- el problema que tienen hoy los formularios.
--
-- Además, sumar cantidades de unidades distintas no significa nada: un
-- movimiento con 2 m³ de poda y 1 camión de chipeo no son "3" de algo. Por eso
-- la unidad se expone solo cuando hay una sola en todo el movimiento, y la
-- pantalla decide qué mostrar según eso.
-- ═══════════════════════════════════════════════════════════════════════

drop view if exists v_movimientos;

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

  r.items,
  r.materiales,
  r.cantidad_total,
  -- Null cuando el movimiento mezcla unidades: ahí el total no es sumable y la
  -- pantalla muestra "N materiales" en vez de un número sin sentido.
  r.unidad_nombre,
  r.unidad_plural,
  r.unidad_decimales
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
  left join perfiles p        on p.id  = m.cargado_por_id
  left join lateral (
    select
      count(*)                                                as items,
      string_agg(mt.nombre, ' + ' order by mt.nombre)         as materiales,
      sum(i.cantidad)                                         as cantidad_total,
      case when count(distinct i.unidad_id) = 1 then min(u.nombre)        end as unidad_nombre,
      case when count(distinct i.unidad_id) = 1 then min(u.nombre_plural) end as unidad_plural,
      case when count(distinct i.unidad_id) = 1 then min(u.decimales)     end as unidad_decimales
    from movimiento_items i
      join materiales mt on mt.id = i.material_id
      join unidades u    on u.id  = i.unidad_id
    where i.movimiento_id = m.id
  ) r on true;

grant select on v_movimientos to authenticated;
