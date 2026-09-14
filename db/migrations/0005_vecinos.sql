-- ═══════════════════════════════════════════════════════════════════════
-- 0005 · Vecinos
--
-- Tabla aparte del resto de las contrapartes a propósito: así "los datos de
-- vecinos los ve solo la coordinadora" es una política de dos líneas en la
-- base (ver 0010_rls.sql) y no una regla que haya que recordar en cada
-- pantalla. El vigilador puede crear, nunca leer.
--
-- Anonimizar vacía nombre, teléfono y barrio y marca la fila. Los movimientos
-- y el tablero no pierden un solo dato: el vínculo sigue existiendo.
-- ═══════════════════════════════════════════════════════════════════════

create table vecinos (
  id              uuid primary key default gen_random_uuid(),
  nombre          text,
  telefono        text,
  barrio          text,
  sitio_alta_id   uuid references sitios (id) on delete set null,
  anonimizado     boolean not null default false,
  anonimizado_en  timestamptz,
  creado_por_id   uuid references perfiles (id) on delete set null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint vecino_anonimizado_sin_datos
    check (not anonimizado or (nombre is null and telefono is null and barrio is null))
);

create index vecinos_sitio_idx    on vecinos (sitio_alta_id, creado_en desc);
create index vecinos_telefono_idx on vecinos (telefono) where telefono is not null;

create trigger vecinos_tocar before update on vecinos
  for each row execute function app.tocar_actualizado_en();

-- Vacía los datos personales conservando el vínculo con los movimientos.
create or replace function app.anonimizar_vecino(vecino uuid) returns void
  language sql security definer set search_path = public, app
as $$
  update vecinos
     set nombre = null, telefono = null, barrio = null,
         anonimizado = true, anonimizado_en = now()
   where id = vecino and not anonimizado
$$;
