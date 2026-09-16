-- ═══════════════════════════════════════════════════════════════════════
-- 0017 · Conteo diario de vecinos
--
-- Del relevamiento: en algunos puntos verdes no se puede usar el celular
-- durante la jornada. En Paso de los Andes el personal es de otra Secretaría y
-- directamente no carga; en otros, sacar el teléfono es riesgo de seguridad.
--
-- Para esos casos la Secretaría pidió una modalidad simplificada: durante el
-- día se lleva el conteo en papel, con palitos, y al cerrar se carga una sola
-- vez "Paso de los Andes – 15/09/2026 – 15 vecinos".
--
-- Un conteo NO es un movimiento. Un movimiento es material que va de un lugar a
-- otro, con cantidad y unidad; un conteo es cuánta gente vino. Meterlo en
-- `movimientos` obligaría a inventar un material y una cantidad falsos, y
-- ensuciaría todos los metros cúbicos del tablero. Va en su propia tabla.
-- ═══════════════════════════════════════════════════════════════════════

create table conteos_diarios (
  id             uuid primary key default gen_random_uuid(),
  sitio_id       uuid not null references sitios (id) on delete restrict,
  fecha          date not null,
  vecinos        int  not null check (vecinos >= 0 and vecinos <= 5000),
  observaciones  text,
  cargado_por_id uuid not null references perfiles (id) on delete restrict,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  -- Un total por día y por punto. Si se equivocaron, se corrige el mismo, y el
  -- cambio queda en la auditoría: dos filas para el mismo día serían dos
  -- verdades distintas sobre lo mismo.
  unique (sitio_id, fecha)
);

create index conteos_fecha_idx on conteos_diarios (fecha desc, sitio_id);

grant select, insert, update on conteos_diarios to authenticated;
revoke delete on conteos_diarios from authenticated, anon;

alter table conteos_diarios enable row level security;

create policy conteos_leer on conteos_diarios for select to authenticated
  using (app.es_admin() or sitio_id = app.sitio_id());

create policy conteos_crear on conteos_diarios for insert to authenticated
  with check (
    app.es_admin()
    or (sitio_id = app.sitio_id() and cargado_por_id = app.uid()
        and fecha >= current_date - 7 and fecha <= current_date)
  );

-- Corregir el conteo del día es parte del trabajo: se anotó 15 y eran 18. Se
-- puede hasta una semana atrás, igual que cargarlo.
create policy conteos_editar on conteos_diarios for update to authenticated
  using (
    app.es_admin()
    or (sitio_id = app.sitio_id() and fecha >= current_date - 7)
  )
  with check (app.es_admin() or sitio_id = app.sitio_id());

create trigger conteos_tocar before update on conteos_diarios
  for each row execute function app.tocar_actualizado_en();

create trigger conteos_auditar
  after insert or update on conteos_diarios
  for each row execute function app.registrar_auditoria();

-- ── Cómo registra cada punto ────────────────────────────────────────────
--
-- Esta bandera no cambia lo que se puede cargar: el conteo diario está
-- disponible en todos lados, porque cualquier punto puede tener un día en que
-- no se pudo usar el celular. Lo que cambia es cómo se lee un cero.
--
-- Sin esto, un punto sin registros detallados es indistinguible de un punto
-- donde no vino nadie, y el tablero informaría una caída que no existe.

alter table sitios add column carga_detallada boolean not null default true;

comment on column sitios.carga_detallada is
  'Falso donde no se puede usar el celular durante la jornada: ahí solo se espera el conteo diario.';

update sitios set carga_detallada = false where codigo = 'PV-03';

-- ── Vecinos por período, juntando las dos modalidades ───────────────────
--
-- Se reescribe la vista de 0013 para sumar los conteos. La distinción que hay
-- que sostener es la misma de siempre, ahora con una más:
--
--   visitas        cuánta gente vino, por cualquiera de las dos vías
--   identificados  personas distintas que dejaron teléfono — solo modo detallado
--   contadas       parte de las visitas que viene de un conteo diario
--
-- Sumar identificados con contadas no tiene sentido: el conteo no sabe quién
-- vino. Por eso van separadas y la pantalla lo dice.

drop view if exists v_vecinos_por_periodo;

create view v_vecinos_por_periodo with (security_invoker = true) as
with detallado as (
  select
    m.sitio_id,
    date_trunc('week',  m.ocurrido_en)::date as semana,
    date_trunc('month', m.ocurrido_en)::date as mes,
    count(*)                                                   as visitas,
    count(*) filter (where m.vecino_sin_datos)                 as sin_datos,
    count(distinct v.id) filter (where v.telefono is not null) as identificados,
    0                                                          as contadas
  from movimientos m
    left join vecinos v on v.id = m.origen_vecino_id
  where m.flujo = 'punto_verde' and m.tipo = 'ingreso' and m.estado = 'vigente'
  group by 1, 2, 3
),
simplificado as (
  select
    c.sitio_id,
    date_trunc('week',  c.fecha)::date as semana,
    date_trunc('month', c.fecha)::date as mes,
    sum(c.vecinos)::bigint as visitas,
    0::bigint              as sin_datos,
    0::bigint              as identificados,
    sum(c.vecinos)::bigint as contadas
  from conteos_diarios c
  group by 1, 2, 3
),
junto as (
  select * from detallado
  union all
  select * from simplificado
)
select
  j.sitio_id,
  s.nombre as sitio_nombre,
  s.codigo as sitio_codigo,
  s.carga_detallada,
  j.semana,
  j.mes,
  sum(j.visitas)::bigint       as visitas,
  sum(j.sin_datos)::bigint     as sin_datos,
  sum(j.identificados)::bigint as identificados,
  sum(j.contadas)::bigint      as contadas
from junto j
  join sitios s on s.id = j.sitio_id
group by 1, 2, 3, 4, 5, 6;

grant select on v_vecinos_por_periodo to authenticated;

-- ── Qué puntos no están cargando ────────────────────────────────────────
-- Un punto que debería cargar todos los días y hace una semana que no manda
-- nada es un problema operativo, no un punto sin gente.

create view v_puntos_sin_carga with (security_invoker = true) as
select
  s.id as sitio_id,
  s.codigo,
  s.nombre,
  s.carga_detallada,
  greatest(
    coalesce((select max(m.ocurrido_en::date) from movimientos m
               where m.sitio_id = s.id and m.estado = 'vigente'), '1900-01-01'),
    coalesce((select max(c.fecha) from conteos_diarios c where c.sitio_id = s.id), '1900-01-01')
  ) as ultima_carga
from sitios s
where s.activo and s.tipo = 'punto_verde';

grant select on v_puntos_sin_carga to authenticated;
