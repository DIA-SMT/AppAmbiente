-- ═══════════════════════════════════════════════════════════════════════
-- 0007 · Movimientos
--
-- Todo es un movimiento: algo sale de un lugar y entra en otro, con material,
-- cantidad y responsable. Una sola tabla sostiene los tres flujos; lo que
-- cambia entre un ingreso de poda a la Planta y una salida de retazos de tela
-- a una emprendedora son los campos que se completan, no la estructura.
--
-- El material va en movimiento_items, no acá: un camión puede traer poda y
-- restos de jardinería en el mismo viaje, y un vecino, cartón y plástico.
-- ═══════════════════════════════════════════════════════════════════════

create sequence movimientos_numero_seq;

create table movimientos (
  id                uuid primary key default gen_random_uuid(),
  -- Correlativo legible, para poder referirse a un movimiento por teléfono.
  numero            bigint not null default nextval('movimientos_numero_seq') unique,

  flujo             text not null check (flujo in ('planta', 'punto_verde', 'gran_generador')),
  tipo              text not null check (tipo in ('ingreso', 'salida', 'contenedor')),
  -- Dónde ocurre. Lo determina el usuario que entró, no se elige.
  sitio_id          uuid not null references sitios (id) on delete restrict,
  ocurrido_en       timestamptz not null default now(),
  -- Se cargó después del hecho (sin señal, sin celular). Se marca en el
  -- listado y en la exportación.
  carga_diferida    boolean not null default false,

  -- ── Origen ───────────────────────────────────────────────────────────
  origen_clase      text not null check (origen_clase in ('sitio', 'entidad', 'vecino', 'texto')),
  origen_sitio_id   uuid references sitios (id)    on delete restrict,
  origen_entidad_id uuid references entidades (id) on delete restrict,
  origen_vecino_id  uuid references vecinos (id)   on delete restrict,
  origen_detalle    text,

  -- ── Destino ──────────────────────────────────────────────────────────
  destino_clase      text not null check (destino_clase in ('sitio', 'entidad', 'vecino', 'texto')),
  destino_sitio_id   uuid references sitios (id)    on delete restrict,
  destino_entidad_id uuid references entidades (id) on delete restrict,
  destino_vecino_id  uuid references vecinos (id)   on delete restrict,
  destino_detalle    text,

  -- ── Transporte y autorización ────────────────────────────────────────
  vehiculo_id        uuid references vehiculos (id) on delete restrict,
  chofer_id          uuid references personas (id)  on delete restrict,
  autorizado_por_id  uuid references personas (id)  on delete restrict,

  -- ── Campos por flujo ─────────────────────────────────────────────────
  tipo_valorizacion  text check (tipo_valorizacion in
                       ('reutilizacion', 'venta', 'emprendimiento', 'otro')),
  vecino_sin_datos   boolean not null default false,

  -- ── Preparado para la fase 2, sin uso todavía ────────────────────────
  pila_id            uuid references pilas (id)        on delete restrict,
  contenedor_id      uuid references contenedores (id) on delete restrict,

  -- ── Estado y auditoría ───────────────────────────────────────────────
  observaciones      text,
  estado             text not null default 'vigente' check (estado in ('vigente', 'anulado')),
  motivo_anulacion   text,
  anulado_por_id     uuid references perfiles (id) on delete restrict,
  anulado_en         timestamptz,

  cargado_por_id     uuid not null references perfiles (id) on delete restrict,
  -- Quién estaba físicamente de turno, más allá del usuario compartido del sitio.
  vigilador_id       uuid references personas (id) on delete restrict,
  -- Idempotencia del sincronizado: si el celular reintenta, no duplica.
  client_uuid        uuid unique,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  -- Exactamente una referencia de origen según la clase declarada.
  constraint origen_coherente check (
    case origen_clase
      when 'sitio'   then origen_sitio_id   is not null and origen_entidad_id is null and origen_vecino_id is null
      when 'entidad' then origen_entidad_id is not null and origen_sitio_id   is null and origen_vecino_id is null
      when 'vecino'  then origen_vecino_id  is not null and origen_sitio_id   is null and origen_entidad_id is null
      when 'texto'   then origen_sitio_id is null and origen_entidad_id is null and origen_vecino_id is null
                          and length(coalesce(origen_detalle, '')) > 0
    end
  ),
  constraint destino_coherente check (
    case destino_clase
      when 'sitio'   then destino_sitio_id   is not null and destino_entidad_id is null and destino_vecino_id is null
      when 'entidad' then destino_entidad_id is not null and destino_sitio_id   is null and destino_vecino_id is null
      when 'vecino'  then destino_vecino_id  is not null and destino_sitio_id   is null and destino_entidad_id is null
      when 'texto'   then destino_sitio_id is null and destino_entidad_id is null and destino_vecino_id is null
                          and length(coalesce(destino_detalle, '')) > 0
    end
  ),
  constraint valorizacion_solo_en_salida
    check (tipo_valorizacion is null or tipo = 'salida'),
  -- Un movimiento anulado siempre dice por qué y quién.
  constraint anulacion_coherente check (
    (estado = 'vigente' and anulado_por_id is null and anulado_en is null and motivo_anulacion is null)
    or
    (estado = 'anulado' and anulado_por_id is not null and anulado_en is not null
       and length(trim(coalesce(motivo_anulacion, ''))) >= 5)
  )
);

-- No se puede registrar algo que todavía no pasó, ni una carga diferida de
-- más de 48 horas. Va en un disparador y no en un CHECK porque Postgres exige
-- que las restricciones usen solo funciones inmutables, y now() no lo es.
create or replace function app.validar_fecha_movimiento() returns trigger
  language plpgsql
as $$
begin
  if new.ocurrido_en > now() + interval '5 minutes' then
    raise exception 'La fecha del movimiento no puede estar en el futuro'
      using errcode = 'check_violation';
  end if;
  -- El límite de 48 horas es para el vigilador. La coordinadora puede cargar
  -- o corregir con cualquier fecha pasada, y las importaciones y la siembra
  -- corren sin sesión, fuera de esta regla.
  if app.rol() = 'vigilador' then
    if new.ocurrido_en < now() - interval '48 hours' then
      raise exception 'No se puede cargar un movimiento de más de 48 horas atrás'
        using errcode = 'check_violation';
    end if;
    new.carga_diferida := new.ocurrido_en < now() - interval '30 minutes';
  end if;
  return new;
end
$$;

create trigger movimientos_validar_fecha
  before insert on movimientos
  for each row execute function app.validar_fecha_movimiento();

create index movimientos_sitio_fecha_idx  on movimientos (sitio_id, ocurrido_en desc);
create index movimientos_flujo_idx        on movimientos (flujo, tipo, ocurrido_en desc);
create index movimientos_estado_idx       on movimientos (estado) where estado = 'vigente';
create index movimientos_cargado_por_idx  on movimientos (cargado_por_id, creado_en desc);
create index movimientos_vehiculo_idx     on movimientos (vehiculo_id)        where vehiculo_id is not null;
create index movimientos_dest_entidad_idx on movimientos (destino_entidad_id) where destino_entidad_id is not null;
create index movimientos_pila_idx         on movimientos (pila_id)            where pila_id is not null;

create trigger movimientos_tocar before update on movimientos
  for each row execute function app.tocar_actualizado_en();

-- ── Qué y cuánto ────────────────────────────────────────────────────────

create table movimiento_items (
  id             uuid primary key default gen_random_uuid(),
  movimiento_id  uuid not null references movimientos (id) on delete cascade,
  material_id    uuid not null references materiales (id)  on delete restrict,
  cantidad       numeric(12, 2) not null check (cantidad > 0),
  unidad_id      uuid not null references unidades (id)    on delete restrict,
  observacion    text,
  creado_en      timestamptz not null default now(),
  -- El mismo material no se carga dos veces en el mismo movimiento.
  unique (movimiento_id, material_id)
);

create index movimiento_items_mov_idx      on movimiento_items (movimiento_id);
create index movimiento_items_material_idx on movimiento_items (material_id);

-- Un movimiento sin materiales no dice nada. Se valida al confirmar, no en el
-- insert de la cabecera, porque cabecera e ítems se insertan en la misma
-- transacción.
create or replace function app.validar_movimiento_tiene_items(mov uuid) returns void
  language plpgsql
as $$
begin
  if not exists (select 1 from movimiento_items where movimiento_id = mov) then
    raise exception 'El movimiento % no tiene ningún material cargado', mov
      using errcode = 'check_violation';
  end if;
end
$$;
