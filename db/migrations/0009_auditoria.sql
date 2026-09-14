-- ═══════════════════════════════════════════════════════════════════════
-- 0009 · Auditoría
--
-- La escriben los disparadores de la base, no la app. Ni la coordinadora
-- puede editarla. Responde "quién cargó esto y quién lo anuló", que es
-- justamente lo que hoy no se puede responder.
-- ═══════════════════════════════════════════════════════════════════════

create table auditoria (
  id           bigint generated always as identity primary key,
  tabla        text not null,
  registro_id  uuid not null,
  accion       text not null check (accion in ('insert', 'update', 'anular')),
  actor_id     uuid,
  actor_rol    text,
  antes        jsonb,
  despues      jsonb,
  creado_en    timestamptz not null default now()
);

create index auditoria_registro_idx on auditoria (tabla, registro_id, creado_en desc);
create index auditoria_actor_idx    on auditoria (actor_id, creado_en desc);
create index auditoria_fecha_idx    on auditoria (creado_en desc);

create or replace function app.registrar_auditoria() returns trigger
  language plpgsql security definer set search_path = public, app
as $$
declare
  accion_detectada text;
  -- Campos que nunca se copian a la auditoría.
  reservados text[] := array['credencial_hash'];
begin
  if tg_op = 'INSERT' then
    accion_detectada := 'insert';
  elsif to_jsonb(new) ->> 'estado' = 'anulado' and to_jsonb(old) ->> 'estado' = 'vigente' then
    accion_detectada := 'anular';
  else
    accion_detectada := 'update';
  end if;

  insert into auditoria (tabla, registro_id, accion, actor_id, actor_rol, antes, despues)
  values (
    tg_table_name,
    (to_jsonb(coalesce(new, old)) ->> 'id')::uuid,
    accion_detectada,
    app.uid(),
    app.rol(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) - reservados end,
    to_jsonb(new) - reservados
  );

  return new;
end
$$;

create trigger movimientos_auditar
  after insert or update on movimientos
  for each row execute function app.registrar_auditoria();

create trigger vecinos_auditar
  after insert or update on vecinos
  for each row execute function app.registrar_auditoria();

create trigger entidades_auditar
  after insert or update on entidades
  for each row execute function app.registrar_auditoria();

create trigger materiales_auditar
  after insert or update on materiales
  for each row execute function app.registrar_auditoria();

create trigger perfiles_auditar
  after insert or update on perfiles
  for each row execute function app.registrar_auditoria();
