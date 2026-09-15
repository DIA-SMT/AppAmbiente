-- ═══════════════════════════════════════════════════════════════════════
-- 0013 · Puntos Verdes (fase 2)
--
-- Tres cosas que el flujo de la Planta no necesitaba:
--   · registrar al vecino que trae material, sin que el vigilador pueda leer
--     la lista de vecinos
--   · dejar que el vigilador dé de alta un carrero o emprendedor en la calle,
--     sin perder el control de la lista maestra
--   · contar vecinos y visitas por punto, que no es lo mismo
-- ═══════════════════════════════════════════════════════════════════════

-- ── Teléfono normalizado ────────────────────────────────────────────────
-- "0381 15 456-7890", "+54 9 381 4567890" y "3814567890" son el mismo vecino.
-- Se guardan los últimos 10 dígitos, que es un número argentino sin prefijos.

create or replace function app.normalizar_telefono(texto text) returns text
  language sql immutable
as $$
  select nullif(right(regexp_replace(coalesce(texto, ''), '[^0-9]', '', 'g'), 10), '')
$$;

create index vecinos_telefono_norm_idx
  on vecinos (app.normalizar_telefono(telefono))
  where telefono is not null and not anonimizado;

-- ── Alta de vecino sin poder leer la lista ──────────────────────────────
--
-- El vigilador no puede hacer SELECT sobre vecinos (política de 0010), pero sí
-- necesita que el mismo vecino no se duplique cada vez que viene. Esta función
-- resuelve las dos cosas: corre como definidora, busca por teléfono y devuelve
-- solo el id. Quien la llama nunca ve un dato de nadie.

create or replace function app.registrar_vecino(
  p_nombre   text,
  p_telefono text,
  p_barrio   text,
  p_sitio    uuid
) returns uuid
  language plpgsql security definer set search_path = public, app
as $$
declare
  v_tel text := app.normalizar_telefono(p_telefono);
  v_id  uuid;
begin
  -- Sin teléfono no hay forma de saber si es el mismo de la semana pasada:
  -- se crea una fila nueva y el tablero lo cuenta como visita, no como vecino
  -- identificado.
  if v_tel is not null then
    select id into v_id
      from vecinos
     where app.normalizar_telefono(telefono) = v_tel
       and not anonimizado
     limit 1;

    if v_id is not null then
      -- Si esta vez dejó el nombre o el barrio y antes no, se completa.
      update vecinos
         set nombre = coalesce(nullif(trim(p_nombre), ''), nombre),
             barrio = coalesce(nullif(trim(p_barrio), ''), barrio)
       where id = v_id;
      return v_id;
    end if;
  end if;

  insert into vecinos (nombre, telefono, barrio, sitio_alta_id, creado_por_id)
  values (nullif(trim(p_nombre), ''), v_tel, nullif(trim(p_barrio), ''), p_sitio, app.uid())
  returning id into v_id;

  return v_id;
end
$$;

-- ── Alta rápida de contrapartes, con revisión ───────────────────────────
--
-- Tensión real: la coordinadora administra la lista de entidades, pero si un
-- carrero nuevo aparece un sábado a la tarde, el vigilador no puede quedarse
-- esperando. Puede darlo de alta, y queda marcado para que la coordinadora lo
-- confirme o lo fusione con uno existente.

alter table entidades add column pendiente_revision boolean not null default false;

create index entidades_pendientes_idx on entidades (creado_en desc)
  where pendiente_revision;

-- Solo contrapartes que se llevan material, nunca orígenes habilitados, y
-- siempre marcadas. Un vigilador no puede crear una empresa ni una dependencia
-- municipal, ni habilitar a nadie como origen.
create policy entidades_alta_rapida on entidades for insert to authenticated
  with check (
    not app.es_admin()
    and pendiente_revision
    and creado_por_id = app.uid()
    and habilitada_destino
    and not habilitada_origen
    and tipo in ('carrero', 'emprendimiento', 'organizacion', 'otro')
  );

-- La vista pública deja ver las pendientes: el vigilador que acaba de dar de
-- alta a alguien tiene que poder elegirlo en el formulario.
-- Reemplazo en vez de drop: v_movimientos cuelga de esta vista. Agregar una
-- columna al final es lo único que create or replace permite, y alcanza.
create or replace view entidades_publicas as
  select id, nombre, tipo, habilitada_origen, habilitada_destino, flujos,
         activo, pendiente_revision
    from entidades
   where activo;
grant select on entidades_publicas to authenticated;

-- ── Vecinos y visitas por punto ─────────────────────────────────────────
--
-- No son lo mismo y confundirlos es el error más fácil de cometer con este
-- indicador: una visita es una persona que vino una vez; un vecino
-- identificado es alguien que dejó su teléfono y se lo puede seguir en el
-- tiempo. El tablero muestra las dos columnas separadas a propósito.

create view v_vecinos_por_periodo with (security_invoker = true) as
select
  m.sitio_id,
  s.nombre as sitio_nombre,
  s.codigo as sitio_codigo,
  date_trunc('week',  m.ocurrido_en)::date as semana,
  date_trunc('month', m.ocurrido_en)::date as mes,
  count(*)                                                        as visitas,
  count(*) filter (where m.vecino_sin_datos)                      as sin_datos,
  count(distinct v.id) filter (where v.telefono is not null)      as identificados
from movimientos m
  join sitios s        on s.id = m.sitio_id
  left join vecinos v  on v.id = m.origen_vecino_id
where m.flujo = 'punto_verde'
  and m.tipo = 'ingreso'
  and m.estado = 'vigente'
group by 1, 2, 3, 4, 5;

grant select on v_vecinos_por_periodo to authenticated;

-- ── Material recirculado por tipo de valorización ───────────────────────

create view v_valorizacion with (security_invoker = true) as
select
  i.sitio_id,
  i.flujo,
  i.mes,
  i.semana,
  m.tipo_valorizacion,
  i.material_id,
  i.material_nombre,
  i.material_color,
  i.unidad_codigo,
  i.unidad_plural,
  count(distinct i.movimiento_id) as movimientos,
  sum(i.cantidad)                 as cantidad,
  sum(i.equivalente_m3)           as equivalente_m3
from v_movimiento_items i
  join movimientos m on m.id = i.movimiento_id
where i.tipo = 'salida'
  and i.estado = 'vigente'
  and m.tipo_valorizacion is not null
group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10;

grant select on v_valorizacion to authenticated;
