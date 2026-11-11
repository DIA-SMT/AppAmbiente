-- ═══════════════════════════════════════════════════════════════════════
-- 0027 · Salidas de contenedores anotadas en el punto, y unidades por material
--
-- LAS SALIDAS. Hasta ahora el punto verde anotaba lo que trae el vecino y lo
-- que se lleva alguien para reutilizar, pero no el contenedor lleno que se
-- lleva la 9 de Julio. De eso sólo quedaba el Excel que la empresa manda a fin
-- de mes, que es también lo que se le paga: no había contra qué cruzarlo.
--
-- Ahora el vigilador anota, en el momento, qué contenedor se va: a qué hora,
-- en qué camión (patente o número de interno), quién manejaba, qué llevaba de
-- verdad —no lo que dice el ploteo, sino lo que tiene adentro— y a dónde va.
-- Es la misma información que anota el nodo cuando el camión llega, para que la
-- coordinación pueda contrastar las tres puntas: lo que salió del punto, lo
-- que llegó y lo que cobra la empresa.
--
-- Va en una tabla propia y no como un movimiento de salida. Una salida del
-- punto verde es una entrega para reutilizar (R-05-08) y así la cuenta el
-- tablero; si el contenedor fuera también una «salida», el material del punto
-- se contaría dos veces y la reutilización parecería mucho más grande de lo
-- que es.
--
-- El chofer va escrito, no elegido de una lista: es personal de la empresa, la
-- Secretaría no lleva un padrón de ellos, y un vigilador que no encuentra el
-- nombre en la lista no puede anotar la salida.
--
-- Y no se borra nada: si una salida se cargó mal, la coordinación la anula con
-- el motivo, y queda.
--
-- LAS UNIDADES. En el punto no hay balanza para la poda: se estima en m³, y el
-- kilo nunca se usa. Lo seco se estima en kilos, que es como lo pide CIRCULA y
-- como llega el Excel de la empresa. Ofrecer las dos cosas sólo servía para
-- que alguien eligiera la equivocada.
-- ═══════════════════════════════════════════════════════════════════════

-- ── La salida ───────────────────────────────────────────────────────────

create table salidas_contenedor (
  id                uuid primary key default gen_random_uuid(),
  sitio_id          uuid not null references sitios (id) on delete restrict,

  -- Cuándo se lo llevaron, no cuándo se cargó: el vigilador puede anotarlo
  -- un rato después.
  salio_en          timestamptz not null,

  -- Patente o número de interno, lo que se lea en el camión. Texto y no un id
  -- de la lista de vehículos: el interno de la empresa no es una patente.
  patente           text not null check (length(trim(patente)) between 2 and 20),
  chofer            text check (chofer is null or length(trim(chofer)) between 2 and 80),

  destino           text not null check (destino in ('nodo', 'san_felipe', 'huerta', 'otro')),
  destino_detalle   text check (destino_detalle is null or length(destino_detalle) <= 120),
  observaciones     text check (observaciones is null or length(observaciones) <= 300),

  cargado_por_id    uuid not null references perfiles (id) on delete restrict,
  -- Lo genera el celular: tocar dos veces «Guardar» no anota dos salidas.
  client_uuid       uuid not null unique,

  anulada_en        timestamptz,
  anulada_por_id    uuid references perfiles (id) on delete restrict,
  motivo_anulacion  text,

  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint destino_otro_con_detalle check (
    destino <> 'otro' or length(trim(coalesce(destino_detalle, ''))) >= 2
  ),
  constraint anulada_con_motivo check (
    anulada_en is null
    or (anulada_por_id is not null and length(trim(coalesce(motivo_anulacion, ''))) >= 3)
  )
);

comment on table salidas_contenedor is
  'Contenedor lleno que se lleva la 9 de Julio, anotado en el punto. Se cruza con el Excel de la empresa.';

create index salidas_contenedor_sitio_idx on salidas_contenedor (sitio_id, salio_en desc);
create index salidas_contenedor_fecha_idx on salidas_contenedor (salio_en desc);

-- ── Lo que llevaba ──────────────────────────────────────────────────────

create table salidas_contenedor_items (
  id         uuid primary key default gen_random_uuid(),
  salida_id  uuid not null references salidas_contenedor (id) on delete restrict,
  material_id uuid not null references materiales (id) on delete restrict,
  cantidad   numeric(12, 2) not null check (cantidad > 0),
  unidad_id  uuid not null references unidades (id) on delete restrict
);

create index salidas_contenedor_items_salida_idx on salidas_contenedor_items (salida_id);

-- ── Permisos ────────────────────────────────────────────────────────────
-- Se revoca todo primero: en Supabase cada tabla nueva nace con todos los
-- permisos para anon y authenticated (ver 0019).

revoke all on salidas_contenedor, salidas_contenedor_items from anon, authenticated;
grant select, insert, update on salidas_contenedor to authenticated;
grant select, insert on salidas_contenedor_items to authenticated;

alter table salidas_contenedor enable row level security;
alter table salidas_contenedor_items enable row level security;

create policy salidas_contenedor_leer on salidas_contenedor for select to authenticated
  using (app.es_admin() or sitio_id = app.sitio_id());

-- El vigilador anota las de su punto, a su nombre, y sólo de un punto verde:
-- la Planta no tiene contenedores que se lleve la empresa.
create policy salidas_contenedor_crear on salidas_contenedor for insert to authenticated
  with check (
    anulada_en is null
    and cargado_por_id = app.uid()
    and (app.es_admin() or sitio_id = app.sitio_id())
    and exists (select 1 from sitios s where s.id = sitio_id and s.tipo = 'punto_verde')
  );

-- Corregir es anular, y anular es de la coordinación.
create policy salidas_contenedor_anular on salidas_contenedor for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

create policy salidas_contenedor_items_leer on salidas_contenedor_items for select to authenticated
  using (exists (
    select 1 from salidas_contenedor s
     where s.id = salida_id and (app.es_admin() or s.sitio_id = app.sitio_id())
  ));

-- Los ítems entran con la salida, en la misma transacción, y sólo los de una
-- salida que cargó quien los manda. Después no se agregan: una salida que
-- llevaba otra cosa se anula y se carga de nuevo.
create policy salidas_contenedor_items_crear on salidas_contenedor_items for insert to authenticated
  with check (exists (
    select 1 from salidas_contenedor s
     where s.id = salida_id
       and s.cargado_por_id = app.uid()
       and s.anulada_en is null
       and s.creado_en > now() - interval '10 minutes'
  ));

create trigger salidas_contenedor_tocar before update on salidas_contenedor
  for each row execute function app.tocar_actualizado_en();

create trigger salidas_contenedor_auditar
  after insert or update on salidas_contenedor
  for each row execute function app.registrar_auditoria();

create trigger salidas_contenedor_items_auditar
  after insert on salidas_contenedor_items
  for each row execute function app.registrar_auditoria();

-- ── Para leer ───────────────────────────────────────────────────────────

create view v_salidas_contenedor with (security_invoker = true) as
select
  s.id,
  s.sitio_id,
  si.codigo  as sitio_codigo,
  si.nombre  as sitio_nombre,
  s.salio_en,
  s.patente,
  s.chofer,
  s.destino,
  s.destino_detalle,
  s.observaciones,
  s.cargado_por_id,
  p.nombre   as cargado_por,
  s.creado_en,
  s.anulada_en,
  pa.nombre  as anulada_por,
  s.motivo_anulacion,
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'material', m.nombre,
             'color', m.color,
             'cantidad', i.cantidad,
             'unidad', u.nombre,
             'unidad_plural', u.nombre_plural,
             'unidad_codigo', u.codigo,
             'decimales', u.decimales
           ) order by m.orden, m.nombre)
      from salidas_contenedor_items i
      join materiales m on m.id = i.material_id
      join unidades u   on u.id = i.unidad_id
     where i.salida_id = s.id
  ), '[]'::jsonb) as items
from salidas_contenedor s
  join sitios si        on si.id = s.sitio_id
  left join perfiles p  on p.id = s.cargado_por_id
  left join perfiles pa on pa.id = s.anulada_por_id;

revoke all on v_salidas_contenedor from anon, authenticated;
grant select on v_salidas_contenedor to authenticated;

-- ── Unidades por material en el punto verde ─────────────────────────────
-- Por nombre, que es la llave de los materiales. Si alguno no existe en esta
-- base, el update no toca nada.

update materiales m
   set unidad_default_id   = u.id,
       unidades_permitidas = array[u.id]
  from unidades u
 where u.codigo = 'm3'
   and lower(m.nombre) in ('poda y orgánico', 'residuos de poda');

update materiales m
   set unidad_default_id   = u.id,
       unidades_permitidas = array[u.id],
       sugerencias         = array[5, 10, 20, 50]::numeric[]
  from unidades u
 where u.codigo = 'kg'
   and lower(m.nombre) in ('cartón', 'plástico', 'vidrio y metal', 'neumáticos');
