-- ═══════════════════════════════════════════════════════════════════════
-- 0016 · Pilas de compost y trazabilidad del camión
--
-- A la pregunta de qué les piden y hoy no pueden responder, la Secretaría
-- contestó dos cosas: la trazabilidad de los camiones de compost y el control
-- operativo de las pilas. Son la misma cadena mirada desde dos puntas.
--
--   poda que entró  →  pila  →  compost que salió  →  destino
--
-- La tabla `pilas` y la columna `movimientos.pila_id` se crearon vacías en la
-- fase 1 justamente para esto. Acá se completan: los controles operativos que
-- pidieron (volteos, riego, composición) y las vistas que arman la cadena.
-- ═══════════════════════════════════════════════════════════════════════

-- ── La pila ─────────────────────────────────────────────────────────────

alter table pilas add column fecha_cierre date;
alter table pilas add column composicion text;
alter table pilas add column responsable_id uuid references personas (id) on delete set null;

comment on column pilas.fecha_cierre is
  'Cuándo se dejó de agregar material. Desde acá se cuentan los meses de maduración.';
comment on column pilas.composicion is
  'Lo que se agregó y no pasa por un movimiento: tierra, estiércol, restos de la huerta.';

-- Maduran entre 4 y 5 meses. Si nadie la declaró, se estima desde el cierre.
create or replace function app.madurez_de_pila(p_cierre date, p_declarada date) returns date
  language sql immutable
as $$
  select coalesce(p_declarada, p_cierre + interval '4 months')::date
$$;

-- ── Controles operativos ────────────────────────────────────────────────
-- Volteos, riego y temperatura son lo que hace que una pila madure bien. Hoy se
-- anotan en un formulario aparte que no se cruza con nada.

create table pila_controles (
  id                uuid primary key default gen_random_uuid(),
  pila_id           uuid not null references pilas (id) on delete restrict,
  tipo              text not null check (tipo in ('volteo', 'riego', 'temperatura', 'humedad', 'observacion')),
  ocurrido_en       timestamptz not null default now(),
  -- Grados para temperatura, porcentaje para humedad. Vacío en volteo y riego:
  -- ahí lo que importa es que pasó, no cuánto.
  valor             numeric(6, 2),
  observacion       text,
  registrado_por_id uuid not null references perfiles (id) on delete restrict,
  creado_en         timestamptz not null default now(),
  constraint control_con_valor_donde_corresponde
    check (tipo not in ('temperatura', 'humedad') or valor is not null)
);

create index pila_controles_pila_idx on pila_controles (pila_id, ocurrido_en desc);
create index pila_controles_tipo_idx on pila_controles (tipo, ocurrido_en desc);

-- El grant de 0010 alcanzó a las tablas que existían entonces. Una tabla nueva
-- necesita el suyo, y sin él las políticas ni llegan a evaluarse: la base corta
-- antes con "permission denied". Borrar sigue revocado para todos.
grant select, insert, update on pila_controles to authenticated;
revoke delete on pila_controles from authenticated, anon;

-- Para que la próxima tabla no repita el olvido.
alter default privileges in schema public
  grant select, insert, update on tables to authenticated;

alter table pila_controles enable row level security;

-- El vigilador de la Planta anota volteos y riegos desde el celular, igual que
-- carga movimientos. No puede tocar lo que ya anotó otro.
create policy controles_leer on pila_controles for select to authenticated
  using (
    app.es_admin()
    or exists (select 1 from pilas p where p.id = pila_id and p.sitio_id = app.sitio_id())
  );

create policy controles_crear on pila_controles for insert to authenticated
  with check (
    app.es_admin()
    or (
      registrado_por_id = app.uid()
      and exists (select 1 from pilas p where p.id = pila_id and p.sitio_id = app.sitio_id())
    )
  );

create policy controles_editar on pila_controles for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

-- ── El estado de cada pila, de un vistazo ───────────────────────────────

create view v_pilas with (security_invoker = true) as
select
  p.id,
  p.codigo,
  p.sitio_id,
  s.nombre            as sitio_nombre,
  p.estado,
  p.fecha_armado,
  p.fecha_cierre,
  app.madurez_de_pila(p.fecha_cierre, p.madurez_estimada) as madurez,
  p.largo_m, p.ancho_m, p.alto_m,
  round(p.largo_m * p.ancho_m * p.alto_m, 1)              as volumen_nominal_m3,
  p.composicion,
  p.notas,
  p.activo,
  pe.nombre           as responsable,

  (current_date - p.fecha_armado)                                        as dias_desde_armado,
  case when p.fecha_cierre is not null
       then app.madurez_de_pila(p.fecha_cierre, p.madurez_estimada) - current_date
  end                                                                    as dias_para_madurez,

  c.volteos,
  c.riegos,
  c.ultimo_volteo,
  c.ultima_temperatura,
  -- Una pila madurando que hace más de tres semanas que no se voltea necesita
  -- atención: es el dato que hoy no tienen y que hace que una pila se pierda.
  -- Solo aplica mientras madura: una que ya está lista no se voltea más, y
  -- marcarla en rojo sería ruido que enseña a ignorar el indicador.
  case
    when p.estado <> 'madurando' then false
    when p.fecha_cierre is null  then false
    else coalesce(c.ultimo_volteo, p.fecha_cierre::timestamptz) < now() - interval '21 days'
  end                                                                    as volteo_atrasado,

  coalesce(e.m3, 0)   as m3_ingresados,
  coalesce(sal.m3, 0) as m3_despachados,
  coalesce(e.movimientos, 0)   as ingresos,
  coalesce(sal.movimientos, 0) as salidas
from pilas p
  join sitios s on s.id = p.sitio_id
  left join personas pe on pe.id = p.responsable_id
  left join lateral (
    select
      count(*) filter (where tipo = 'volteo')                as volteos,
      count(*) filter (where tipo = 'riego')                 as riegos,
      max(ocurrido_en) filter (where tipo = 'volteo')        as ultimo_volteo,
      max(valor)       filter (where tipo = 'temperatura')   as ultima_temperatura
    from pila_controles pc where pc.pila_id = p.id
  ) c on true
  left join lateral (
    select count(distinct m.id) as movimientos,
           sum(i.cantidad * coalesce(u.factor_m3, 0)) as m3
      from movimientos m
      join movimiento_items i on i.movimiento_id = m.id
      join unidades u on u.id = i.unidad_id
     where m.pila_id = p.id and m.tipo = 'ingreso' and m.estado = 'vigente'
  ) e on true
  left join lateral (
    select count(distinct m.id) as movimientos,
           sum(i.cantidad * coalesce(u.factor_m3, 0)) as m3
      from movimientos m
      join movimiento_items i on i.movimiento_id = m.id
      join unidades u on u.id = i.unidad_id
     where m.pila_id = p.id and m.tipo = 'salida' and m.estado = 'vigente'
  ) sal on true;

grant select on v_pilas to authenticated;

-- ── De qué está hecha cada pila ─────────────────────────────────────────
-- La composición real, calculada desde los ingresos que la formaron, y no
-- declarada de memoria. Es lo que convierte "compost" en "compost de poda de
-- la cuadrilla Norte levantada en abril".

create view v_pila_composicion with (security_invoker = true) as
select
  m.pila_id,
  mt.id                as material_id,
  mt.nombre            as material,
  mt.color             as material_color,
  coalesce(oe.nombre, os.nombre, m.origen_detalle, 'Sin identificar') as origen,
  count(distinct m.id) as movimientos,
  min(m.ocurrido_en)   as primer_ingreso,
  max(m.ocurrido_en)   as ultimo_ingreso,
  sum(i.cantidad * coalesce(u.factor_m3, 0)) as m3
from movimientos m
  join movimiento_items i on i.movimiento_id = m.id
  join materiales mt      on mt.id = i.material_id
  join unidades u         on u.id = i.unidad_id
  left join entidades_publicas oe on oe.id = m.origen_entidad_id
  left join sitios os             on os.id = m.origen_sitio_id
where m.pila_id is not null
  and m.tipo = 'ingreso'
  and m.estado = 'vigente'
group by m.pila_id, mt.id, mt.nombre, mt.color, 5;

grant select on v_pila_composicion to authenticated;

-- ── La trazabilidad del camión ──────────────────────────────────────────
-- Una fila por cada salida que declara pila. Es la respuesta directa a
-- "¿de dónde salió este camión de compost?".

create view v_trazabilidad_salidas with (security_invoker = true) as
select
  m.id            as movimiento_id,
  m.numero,
  m.ocurrido_en,
  m.tipo_valorizacion,
  coalesce(de.nombre, m.destino_detalle, 'Sin destino declarado') as destino,
  v.patente,
  ch.nombre       as chofer,
  au.nombre       as autoriza,
  p.id            as pila_id,
  p.codigo        as pila,
  p.fecha_armado,
  p.fecha_cierre,
  app.madurez_de_pila(p.fecha_cierre, p.madurez_estimada) as madurez,
  (select count(*) from pila_controles c where c.pila_id = p.id and c.tipo = 'volteo') as volteos,
  (select sum(i2.cantidad * coalesce(u2.factor_m3, 0))
     from movimientos m2
     join movimiento_items i2 on i2.movimiento_id = m2.id
     join unidades u2 on u2.id = i2.unidad_id
    where m2.pila_id = p.id and m2.tipo = 'ingreso' and m2.estado = 'vigente') as m3_que_la_formaron,
  (select string_agg(distinct coalesce(oe2.nombre, m2.origen_detalle), ' · ')
     from movimientos m2
     left join entidades_publicas oe2 on oe2.id = m2.origen_entidad_id
    where m2.pila_id = p.id and m2.tipo = 'ingreso' and m2.estado = 'vigente') as procedencias
from movimientos m
  join pilas p on p.id = m.pila_id
  left join entidades_publicas de on de.id = m.destino_entidad_id
  left join vehiculos v           on v.id = m.vehiculo_id
  left join personas_publicas ch  on ch.id = m.chofer_id
  left join personas_publicas au  on au.id = m.autorizado_por_id
where m.tipo = 'salida' and m.estado = 'vigente';

grant select on v_trazabilidad_salidas to authenticated;
