-- ═══════════════════════════════════════════════════════════════════════
-- 0006 · Estructura preparada, sin pantalla en la fase 1
--
-- Se crean vacías para que sumar el seguimiento por pila de compost y el
-- circuito de contenedores sea agregar pantallas, no migrar la base. Las
-- columnas movimientos.pila_id y movimientos.contenedor_id ya quedan puestas
-- en 0007_movimientos.sql.
-- ═══════════════════════════════════════════════════════════════════════

-- Hoy son 17 pilas de 1 × 1 × 100 m que maduran entre 4 y 5 meses.
create table pilas (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null unique,
  sitio_id          uuid not null references sitios (id) on delete restrict,
  fecha_armado      date,
  madurez_estimada  date,
  largo_m           numeric(6, 2) default 100,
  ancho_m           numeric(6, 2) default 1,
  alto_m            numeric(6, 2) default 1,
  estado            text not null default 'en_formacion'
                    check (estado in ('en_formacion', 'madurando', 'lista', 'despachada')),
  notas             text,
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);

create index pilas_sitio_idx on pilas (sitio_id, estado);

create trigger pilas_tocar before update on pilas
  for each row execute function app.tocar_actualizado_en();

-- El circuito de recambios y retiros todavía no está detallado. Un recambio
-- será un movimiento con tipo = 'contenedor' y contenedor_id apuntando acá.
create table contenedores (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique,
  tipo            text,
  capacidad_m3    numeric(8, 2),
  sitio_actual_id uuid references sitios (id) on delete set null,
  estado          text not null default 'en_sitio'
                  check (estado in ('en_sitio', 'en_transito', 'mantenimiento', 'baja')),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create index contenedores_sitio_idx on contenedores (sitio_actual_id, estado);

create trigger contenedores_tocar before update on contenedores
  for each row execute function app.tocar_actualizado_en();
