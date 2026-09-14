-- ═══════════════════════════════════════════════════════════════════════
-- 0003 · Materiales y unidades
--
-- SUPUESTO A CONFIRMAR (pregunta 1 del documento de validación): todavía no
-- está definido en qué unidad se anota cada material. Por eso la unidad es un
-- atributo del material y se cambia desde la pantalla de listas maestras, sin
-- tocar código ni migrar datos.
-- ═══════════════════════════════════════════════════════════════════════

create table unidades (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique check (codigo in ('camion', 'batea', 'm3', 'bolsa', 'kg', 'tn', 'unidad')),
  nombre          text not null,
  nombre_plural   text not null,
  -- 0 para "camión" (no existe medio camión), 1 para m³, 2 para kg.
  decimales       int  not null default 0 check (decimales between 0 and 3),
  -- SUPUESTO: equivalencia estimada a m³, para poder sumar materiales medidos
  -- en unidades distintas en el tablero. Null = no comparable.
  factor_m3       numeric(10, 3) check (factor_m3 is null or factor_m3 > 0),
  orden           int  not null default 0,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create trigger unidades_tocar before update on unidades
  for each row execute function app.tocar_actualizado_en();

create table materiales (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  categoria           text not null check (categoria in (
                        'verdes', 'reciclables', 'textil', 'madera', 'especiales', 'otros')),
  -- Dónde se ofrece este material. Vacío = en todos los flujos.
  flujos              text[] not null default '{}',
  -- Si entra, si sale o ambas. Es lo que impide registrar un ingreso de
  -- compost o una salida de poda: la opción ni siquiera aparece en la lista.
  tipos               text[] not null default '{ingreso,salida}',
  unidad_default_id   uuid not null references unidades (id),
  unidades_permitidas uuid[] not null default '{}',
  -- Valores sugeridos como botones en el formulario del celular.
  sugerencias         numeric(12, 2)[] not null default '{}',
  color               text not null default '#126ff5',
  orden               int  not null default 0,
  activo              boolean not null default true,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  constraint material_tipos_validos
    check (tipos <@ array['ingreso', 'salida']::text[] and cardinality(tipos) > 0),
  constraint material_flujos_validos
    check (flujos <@ array['planta', 'punto_verde', 'gran_generador']::text[])
);

create unique index materiales_nombre_idx on materiales (lower(nombre));
create index materiales_activo_idx on materiales (activo, orden);

create trigger materiales_tocar before update on materiales
  for each row execute function app.tocar_actualizado_en();
