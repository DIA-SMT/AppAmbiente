-- ═══════════════════════════════════════════════════════════════════════
-- 0002 · Lugares y personas
--   sitios     → lugares propios: la Planta y los 8 puntos verdes
--   entidades  → contrapartes externas, incluida la lista de destinos habilitados
--   vehiculos  → patentes
--   personas   → choferes, vigiladores y quienes autorizan salidas
-- ═══════════════════════════════════════════════════════════════════════

create table sitios (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  nombre         text not null,
  tipo           text not null check (tipo in ('planta', 'punto_verde')),
  direccion      text,
  latitud        numeric(10, 7),
  longitud       numeric(10, 7),
  orden          int  not null default 0,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index sitios_activo_idx on sitios (activo, orden);

create trigger sitios_tocar before update on sitios
  for each row execute function app.tocar_actualizado_en();

-- ── Entidades ───────────────────────────────────────────────────────────
-- Una sola tabla para empresas, emprendimientos, organizaciones, carreros y
-- dependencias municipales. Dar de alta un gran generador nuevo es agregar
-- una fila con habilitada_origen = true.

create table entidades (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  tipo                text not null check (tipo in (
                        'empresa', 'emprendimiento', 'organizacion', 'carrero',
                        'dependencia_municipal', 'planta_externa', 'otro')),
  habilitada_origen   boolean not null default false,
  habilitada_destino  boolean not null default false,
  -- En qué flujos se ofrece. Vacío = en todos.
  flujos              text[] not null default '{}',
  cuit                text,
  contacto            text,
  telefono            text,
  barrio              text,
  notas               text,
  activo              boolean not null default true,
  creado_por_id       uuid,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  constraint entidad_sirve_para_algo
    check (habilitada_origen or habilitada_destino)
);

create unique index entidades_nombre_idx on entidades (lower(nombre));
create index entidades_destino_idx on entidades (habilitada_destino, activo) where habilitada_destino;
create index entidades_origen_idx  on entidades (habilitada_origen,  activo) where habilitada_origen;

create trigger entidades_tocar before update on entidades
  for each row execute function app.tocar_actualizado_en();

-- ── Vehículos ───────────────────────────────────────────────────────────

create table vehiculos (
  id              uuid primary key default gen_random_uuid(),
  patente         text not null,
  patente_norm    text generated always as (app.normalizar_patente(patente)) stored,
  tipo            text not null check (tipo in ('camion', 'batea', 'camioneta', 'tractor', 'otro')),
  -- Si se conoce, el formulario propone este volumen y el vigilador solo confirma.
  capacidad_m3    numeric(8, 2) check (capacidad_m3 is null or capacidad_m3 > 0),
  entidad_id      uuid references entidades (id) on delete set null,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create unique index vehiculos_patente_idx on vehiculos (patente_norm);
create index vehiculos_activo_idx on vehiculos (activo, patente);

create trigger vehiculos_tocar before update on vehiculos
  for each row execute function app.tocar_actualizado_en();

-- ── Personas ────────────────────────────────────────────────────────────
-- De acá sale tanto el selector de chofer como el de "vigilador a cargo"
-- del inicio de turno y el de quién autoriza una salida.

create table personas (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  rol             text not null check (rol in ('chofer', 'vigilador', 'autorizante', 'operario')),
  documento       text,
  entidad_id      uuid references entidades (id) on delete set null,
  sitio_id        uuid references sitios (id) on delete set null,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create index personas_rol_idx   on personas (rol, activo, nombre);
create index personas_sitio_idx on personas (sitio_id, rol) where sitio_id is not null;

create trigger personas_tocar before update on personas
  for each row execute function app.tocar_actualizado_en();
