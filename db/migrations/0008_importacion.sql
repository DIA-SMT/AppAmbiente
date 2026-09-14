-- ═══════════════════════════════════════════════════════════════════════
-- 0008 · Importación del Excel de pesos
--
-- El formato del archivo que manda la planta de la 9 de Julio todavía no se
-- conoce. Por eso el mapeo de columnas es un dato configurable y no código:
-- cuando llegue el archivo se resuelve desde la pantalla, sin desplegar nada.
-- ═══════════════════════════════════════════════════════════════════════

create table mapeos_importacion (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  tipo              text not null default 'pesos_contenedores'
                    check (tipo in ('pesos_contenedores', 'movimientos_historicos')),
  -- Qué columna del Excel corresponde a cada campo:
  --   {"fecha": "FECHA RETIRO", "sitio": "PUNTO", "peso_kg": "KG NETO"}
  columnas          jsonb not null default '{}',
  -- Formato de fecha, coma decimal, alias de nombres de sitios, filas a saltear.
  transformaciones  jsonb not null default '{}',
  hoja              text,
  fila_encabezado   int not null default 1,
  activo            boolean not null default true,
  creado_por_id     uuid references perfiles (id) on delete set null,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);

create unique index mapeos_nombre_idx on mapeos_importacion (lower(nombre));

create trigger mapeos_tocar before update on mapeos_importacion
  for each row execute function app.tocar_actualizado_en();

-- Una fila por archivo subido. Nada se confirma sin previsualizar, y una
-- importación equivocada se revierte completa.
create table importaciones (
  id              uuid primary key default gen_random_uuid(),
  mapeo_id        uuid references mapeos_importacion (id) on delete set null,
  archivo_nombre  text not null,
  archivo_hash    text,
  periodo_desde   date,
  periodo_hasta   date,
  filas_ok        int not null default 0,
  filas_error     int not null default 0,
  errores         jsonb not null default '[]',
  estado          text not null default 'previsualizada'
                  check (estado in ('previsualizada', 'confirmada', 'revertida')),
  importado_por_id uuid references perfiles (id) on delete set null,
  importado_en    timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create index importaciones_estado_idx on importaciones (estado, importado_en desc);

create trigger importaciones_tocar before update on importaciones
  for each row execute function app.tocar_actualizado_en();

-- Los kilos reales que informa la planta externa, para cruzar contra lo que
-- se registró en cada punto verde.
create table pesos_externos (
  id                uuid primary key default gen_random_uuid(),
  importacion_id    uuid not null references importaciones (id) on delete cascade,
  sitio_id          uuid references sitios (id) on delete restrict,
  fecha             date not null,
  contenedor_codigo text,
  material_id       uuid references materiales (id) on delete set null,
  peso_kg           numeric(12, 2) not null check (peso_kg >= 0),
  -- La fila cruda, tal cual vino. Permite recalcular el indicador si más
  -- adelante cambia el criterio de cruce, sin volver a pedir el archivo.
  fila_origen       jsonb not null default '{}',
  creado_en         timestamptz not null default now()
);

create index pesos_externos_sitio_fecha_idx on pesos_externos (sitio_id, fecha);
create index pesos_externos_importacion_idx on pesos_externos (importacion_id);
