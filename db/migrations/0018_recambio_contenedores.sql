-- ═══════════════════════════════════════════════════════════════════════
-- 0018 · Recambio de contenedores
--
-- Hoy el circuito es todo WhatsApp: el vigilador ve un contenedor lleno y
-- escribe al grupo de Puntos Verdes; la Coordinación lo retransmite al grupo de
-- choferes de la 9 de Julio; la empresa retira y recambia.
--
-- Funciona, pero no deja rastro. Nadie puede contestar cuántos días espera un
-- punto por un recambio, los pedidos se pierden entre mensajes, y el Excel que
-- la empresa manda a fin de mes no se puede cruzar contra nada: no se sabe si
-- hubo retiros que nadie pidió ni pedidos que nunca se sirvieron.
--
-- Esto NO reemplaza el WhatsApp con la empresa —ese canal es de ellos— sino el
-- primer tramo, y vuelve medible el resto. La coordinadora sigue avisando, pero
-- desde una pantalla que sabe qué hay pendiente y desde cuándo.
-- ═══════════════════════════════════════════════════════════════════════

-- ── El contenedor ───────────────────────────────────────────────────────
-- La tabla se creó vacía en la fase 1. No tienen numeración física: un
-- contenedor es "el de cartón de Italia", o sea el par punto + corriente.

alter table contenedores add column material_id uuid references materiales (id) on delete restrict;
alter table contenedores add column ultima_retirada date;

create unique index contenedores_punto_corriente_idx
  on contenedores (sitio_actual_id, material_id)
  where activo and material_id is not null;

comment on column contenedores.material_id is
  'La corriente que recibe. Sin numeración física, el contenedor es el par punto + corriente.';

-- La política de 0010 dejaba que cualquier vigilador leyera todos los
-- contenedores activos. Se escribió cuando la tabla estaba vacía y un
-- contenedor no significaba nada; ahora es el par punto + corriente, así que
-- cada uno ve los suyos y nada más, igual que con los movimientos.
drop policy if exists contenedores_leer on contenedores;
create policy contenedores_leer on contenedores for select to authenticated
  using (
    app.es_admin()
    or (activo and sitio_actual_id = app.sitio_id())
  );

-- ── El pedido ───────────────────────────────────────────────────────────

create table pedidos_recambio (
  id             uuid primary key default gen_random_uuid(),
  sitio_id       uuid not null references sitios (id) on delete restrict,
  contenedor_id  uuid references contenedores (id) on delete restrict,
  material_id    uuid references materiales (id) on delete restrict,

  estado         text not null default 'pedido'
                 check (estado in ('pedido', 'avisado', 'retirado', 'cancelado')),

  -- Lo pide el vigilador desde el punto.
  pedido_en      timestamptz not null default now(),
  pedido_por_id  uuid not null references perfiles (id) on delete restrict,
  urgente        boolean not null default false,
  observaciones  text,

  -- La coordinación lo pasa a la 9 de Julio. Es el momento que hoy no queda
  -- registrado en ningún lado y el que parte la espera en dos: cuánto tardó el
  -- municipio en avisar y cuánto tardó la empresa en venir.
  avisado_en     timestamptz,
  avisado_por_id uuid references perfiles (id) on delete restrict,

  -- Se confirma cuando llega el Excel de fin de mes, o antes si alguien lo vio.
  retirado_en    timestamptz,
  remito         text,
  peso_kg        numeric(12, 2) check (peso_kg is null or peso_kg >= 0),

  motivo_cierre  text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Cada estado exige lo que le corresponde. Sin esto, un pedido puede quedar
  -- "retirado" sin fecha de retiro y el tiempo de respuesta sale de la nada.
  constraint estados_coherentes check (
    case estado
      when 'pedido'    then avisado_en is null and retirado_en is null
      when 'avisado'   then avisado_en is not null and retirado_en is null
      when 'retirado'  then retirado_en is not null
      when 'cancelado' then length(trim(coalesce(motivo_cierre, ''))) >= 3
    end
  )
);

create index pedidos_abiertos_idx on pedidos_recambio (sitio_id, pedido_en desc)
  where estado in ('pedido', 'avisado');
create index pedidos_estado_idx on pedidos_recambio (estado, pedido_en desc);
create index pedidos_remito_idx on pedidos_recambio (remito) where remito is not null;

grant select, insert, update on pedidos_recambio to authenticated;
revoke delete on pedidos_recambio from authenticated, anon;

alter table pedidos_recambio enable row level security;

create policy pedidos_leer on pedidos_recambio for select to authenticated
  using (app.es_admin() or sitio_id = app.sitio_id());

create policy pedidos_crear on pedidos_recambio for insert to authenticated
  with check (
    app.es_admin()
    or (sitio_id = app.sitio_id() and pedido_por_id = app.uid() and estado = 'pedido')
  );

-- El vigilador puede cancelar el suyo si se equivocó o si ya lo retiraron antes
-- de que nadie avisara. Lo demás —avisar y confirmar el retiro— es de la
-- coordinación, que es quien habla con la empresa.
create policy pedidos_editar_admin on pedidos_recambio for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

create policy pedidos_cancelar on pedidos_recambio for update to authenticated
  using (
    not app.es_admin()
    and sitio_id = app.sitio_id()
    and pedido_por_id = app.uid()
    and estado = 'pedido'
    and pedido_en > now() - interval '24 hours'
  )
  with check (estado = 'cancelado');

create trigger pedidos_tocar before update on pedidos_recambio
  for each row execute function app.tocar_actualizado_en();

create trigger pedidos_auditar
  after insert or update on pedidos_recambio
  for each row execute function app.registrar_auditoria();

-- Al confirmar un retiro, el contenedor recuerda cuándo fue la última vez.
create or replace function app.marcar_retirada() returns trigger
  language plpgsql
as $$
begin
  if new.estado = 'retirado' and new.contenedor_id is not null
     and (old.estado is distinct from 'retirado') then
    update contenedores
       set ultima_retirada = new.retirado_en::date
     where id = new.contenedor_id;
  end if;
  return new;
end
$$;

create trigger pedidos_marcar_retirada
  after update on pedidos_recambio
  for each row execute function app.marcar_retirada();

-- ── La cola, con la espera medida ───────────────────────────────────────

create view v_pedidos_recambio with (security_invoker = true) as
select
  p.id,
  p.sitio_id,
  s.codigo   as sitio_codigo,
  s.nombre   as sitio_nombre,
  p.contenedor_id,
  p.material_id,
  m.nombre   as material,
  m.color    as material_color,
  p.estado,
  p.urgente,
  p.observaciones,
  p.pedido_en,
  p.pedido_por_id,
  qp.nombre  as pedido_por,
  p.avisado_en,
  qa.nombre  as avisado_por,
  p.retirado_en,
  p.remito,
  p.peso_kg,
  p.motivo_cierre,

  -- Las tres esperas que hoy nadie puede calcular.
  round(extract(epoch from (coalesce(p.avisado_en, now()) - p.pedido_en)) / 3600, 1)
    as horas_hasta_aviso,
  case when p.avisado_en is not null
       then round(extract(epoch from (coalesce(p.retirado_en, now()) - p.avisado_en)) / 3600, 1)
  end as horas_hasta_retiro,
  round(extract(epoch from (coalesce(p.retirado_en, now()) - p.pedido_en)) / 3600, 1)
    as horas_totales,

  -- Un pedido abierto hace más de tres días necesita que alguien lo mire. No es
  -- un umbral pactado con la empresa: no existe ninguno. Es lo que hace que la
  -- cola se lea sin tener que sacar la cuenta de cabeza.
  (p.estado in ('pedido', 'avisado') and p.pedido_en < now() - interval '3 days') as demorado
from pedidos_recambio p
  join sitios s          on s.id = p.sitio_id
  left join materiales m on m.id = p.material_id
  left join perfiles qp  on qp.id = p.pedido_por_id
  left join perfiles qa  on qa.id = p.avisado_por_id;

grant select on v_pedidos_recambio to authenticated;

-- ── Tiempo de respuesta por punto ───────────────────────────────────────
-- El indicador que hoy no existe, y el que sirve para reclamar frecuencia.

create view v_respuesta_recambio with (security_invoker = true) as
select
  sitio_id,
  sitio_codigo,
  sitio_nombre,
  count(*) filter (where estado = 'retirado')                as retirados,
  count(*) filter (where estado in ('pedido', 'avisado'))    as abiertos,
  count(*) filter (where demorado)                           as demorados,
  round(avg(horas_hasta_aviso)  filter (where estado <> 'cancelado'), 1) as promedio_hasta_aviso,
  round(avg(horas_hasta_retiro) filter (where estado = 'retirado'), 1)   as promedio_hasta_retiro,
  round(avg(horas_totales)      filter (where estado = 'retirado'), 1)   as promedio_total,
  max(pedido_en) filter (where estado in ('pedido', 'avisado'))          as pedido_mas_viejo
from v_pedidos_recambio
group by sitio_id, sitio_codigo, sitio_nombre;

grant select on v_respuesta_recambio to authenticated;
