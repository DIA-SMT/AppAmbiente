-- ═══════════════════════════════════════════════════════════════════════
-- 0001 · Base: roles, helpers de sesión y utilidades comunes
--
-- La app pone los datos de la sesión en `request.jwt.claims` antes de cada
-- consulta, que es el mismo mecanismo que usa Supabase con PostgREST. Por eso
-- las políticas de seguridad escritas acá funcionan igual en el PGlite local
-- y en un Postgres de Supabase, sin cambiar una línea.
-- ═══════════════════════════════════════════════════════════════════════

-- Los roles ya existen en Supabase; en PGlite hay que crearlos.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end
$$;

create schema if not exists app;

-- ── Lectura de la sesión ────────────────────────────────────────────────

create or replace function app.claims() returns jsonb
  language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

-- Quién está operando. Null si no hay sesión.
create or replace function app.uid() returns uuid
  language sql stable
as $$
  select nullif(app.claims() ->> 'sub', '')::uuid
$$;

create or replace function app.rol() returns text
  language sql stable
as $$
  select coalesce(nullif(app.claims() ->> 'rol', ''), 'anonimo')
$$;

create or replace function app.es_admin() returns boolean
  language sql stable
as $$
  select app.rol() = 'admin'
$$;

-- El sitio asignado al usuario. Es lo que hace que un vigilador no pueda
-- cargar ni leer movimientos de otro punto, aunque consulte la base directo.
create or replace function app.sitio_id() returns uuid
  language sql stable
as $$
  select nullif(app.claims() ->> 'sitio_id', '')::uuid
$$;

-- ── Utilidades ──────────────────────────────────────────────────────────

create or replace function app.tocar_actualizado_en() returns trigger
  language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end
$$;

-- Normaliza patentes: "ab 123 cd" y "AB123CD" son la misma.
create or replace function app.normalizar_patente(texto text) returns text
  language sql immutable
as $$
  select upper(regexp_replace(coalesce(texto, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

grant usage on schema app to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on all functions in schema app to anon, authenticated;
alter default privileges in schema app grant execute on functions to anon, authenticated;

-- El registro de migraciones ya aplicadas lo administra db/cli/migrar.ts.
create table if not exists app.migraciones (
  nombre       text primary key,
  aplicada_en  timestamptz not null default now(),
  hash         text not null
);
