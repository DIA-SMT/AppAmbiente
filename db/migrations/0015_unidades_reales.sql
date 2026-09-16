-- ═══════════════════════════════════════════════════════════════════════
-- 0015 · Unidades reales y destinos abiertos
--
-- Correcciones sobre lo relevado con la Secretaría (expediente 190941/26).
-- Dos supuestos de la fase 1 eran incorrectos.
--
-- 1. LA UNIDAD. Se suponía que cada material se medía en una unidad fija y que
--    un camión eran 12 m³. La realidad: no hay balanza y TODO se estima en m³.
--    Los recipientes son la forma de estimar, no unidades distintas, y un mismo
--    material entra en tambor y sale en batea. Un camión son 6 m³, no 12: todos
--    los m³ informados hasta ahora estaban al doble.
--
-- 2. LOS DESTINOS. Se suponía una lista cerrada de destinos habilitados. No
--    existe: el chofer le dice al portero adónde lleva el material y queda en
--    observaciones. La autorización es verbal o por WhatsApp. La Secretaría
--    quiere formalizarlo de a poco, así que el destino pasa a ser abierto y lo
--    escrito a mano se promueve a opción fija desde el panel.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Recipientes con capacidad declarada ─────────────────────────────────
-- El vigilador elige el recipiente y cuántos; la app guarda el equivalente en
-- m³ usando estas capacidades. 'otro_m3' es la válvula para cuando alguien
-- conoce bien la capacidad de su vehículo y la declara en portería.

alter table unidades drop constraint if exists unidades_codigo_check;
alter table unidades add constraint unidades_codigo_check
  check (codigo in (
    'm3', 'kg', 'tn', 'unidad', 'bolsa',
    'tambor_200', 'carro_delfi', 'camion', 'contenedor', 'batea', 'batea_larga'
  ));

insert into unidades (codigo, nombre, nombre_plural, decimales, factor_m3, orden) values
  ('m3',          'm³',              'm³',               1, 1,    1),
  ('tambor_200',  'tambor de 200 L', 'tambores de 200 L', 0, 0.2, 2),
  ('carro_delfi', 'carro de delfi',  'carros de delfi',   0, 4,   3),
  ('camion',      'camión',          'camiones',          0, 6,   4),
  ('contenedor',  'contenedor',      'contenedores',      0, 6,   5),
  ('batea',       'batea',           'bateas',            0, 20,  6),
  ('batea_larga', 'batea alargada',  'bateas alargadas',  0, 30,  7),
  ('kg',          'kg',              'kg',                2, null, 8)
on conflict (codigo) do update
  set nombre        = excluded.nombre,
      nombre_plural = excluded.nombre_plural,
      decimales     = excluded.decimales,
      factor_m3     = excluded.factor_m3,
      orden         = excluded.orden,
      activo        = true;

-- Las unidades que se habían inventado dejan de ofrecerse. No se borran: hay
-- movimientos históricos que las referencian y en este sistema no se borra.
update unidades set activo = false where codigo in ('bolsa', 'tn', 'unidad');

-- ── Recalcular lo ya cargado ────────────────────────────────────────────
-- v_movimiento_items calcula el equivalente en m³ al vuelo desde factor_m3, así
-- que corregir la capacidad del camión arregla sola toda la serie histórica.
-- Queda dicho acá para que no se busque una migración de datos que no hace falta.

-- ── Destinos escritos a mano ────────────────────────────────────────────
-- Lo que el vigilador escribió porque no estaba en la lista. Es la materia
-- prima para formalizar: si un destino aparece diez veces, merece ser opción.

create view v_destinos_a_formalizar with (security_invoker = true) as
select
  trim(m.destino_detalle)                 as destino,
  count(*)                                as veces,
  min(m.ocurrido_en)                      as primera_vez,
  max(m.ocurrido_en)                      as ultima_vez,
  array_agg(distinct s.nombre order by s.nombre) as sitios,
  array_agg(distinct m.flujo  order by m.flujo)  as flujos
from movimientos m
  join sitios s on s.id = m.sitio_id
where m.tipo = 'salida'
  and m.estado = 'vigente'
  and m.destino_clase = 'texto'
  and length(trim(coalesce(m.destino_detalle, ''))) > 1
  -- Si ya existe una entidad con ese nombre, ya está formalizado.
  and not exists (
    select 1 from entidades e
     where lower(e.nombre) = lower(trim(m.destino_detalle)) and e.activo
  )
group by trim(m.destino_detalle);

grant select on v_destinos_a_formalizar to authenticated;

-- ── Promover un destino escrito a mano a entidad de la lista ────────────
-- Reapunta los movimientos que lo usaban, para no perder la trazabilidad de lo
-- que ya salió. Solo la coordinadora.

create or replace function app.formalizar_destino(
  p_texto  text,
  p_nombre text,
  p_tipo   text,
  p_flujo  text
) returns uuid
  language plpgsql security definer set search_path = public, app
as $$
declare
  v_id uuid;
begin
  if not app.es_admin() then
    raise exception 'Solo la coordinación puede formalizar destinos'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_id from entidades where lower(nombre) = lower(trim(p_nombre));

  if v_id is null then
    insert into entidades (nombre, tipo, habilitada_origen, habilitada_destino,
                           flujos, pendiente_revision, creado_por_id)
    values (trim(p_nombre), p_tipo, false, true, array[p_flujo]::text[], false, app.uid())
    returning id into v_id;
  end if;

  update movimientos
     set destino_clase = 'entidad',
         destino_entidad_id = v_id,
         destino_detalle = null
   where destino_clase = 'texto'
     and lower(trim(destino_detalle)) = lower(trim(p_texto));

  return v_id;
end
$$;
