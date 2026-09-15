-- ═══════════════════════════════════════════════════════════════════════
-- 0014 · Dos correcciones de 0013, encontradas probando el flujo completo
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Teléfonos argentinos ─────────────────────────────────────────────
--
-- Cortar por los últimos 10 dígitos no alcanza. Estos tres son el mismo
-- número y daban tres claves distintas:
--
--   0381 15 456-7890     →  0381154567890
--   +54 9 381 456 7890   →  5493814567890
--   381 456 7890         →  3814567890
--
-- El problema es el 15 de celular, que va DESPUÉS del código de área, y el
-- prefijo 54 9 de discado internacional. Hay que sacarlos en orden.

create or replace function app.normalizar_telefono(texto text) returns text
  language plpgsql immutable
as $$
declare
  d text := regexp_replace(coalesce(texto, ''), '[^0-9]', '', 'g');
begin
  if d = '' then
    return null;
  end if;

  -- Prefijo internacional, y el 9 de celular que solo existe detrás del 54.
  if left(d, 2) = '54' then
    d := substr(d, 3);
    d := regexp_replace(d, '^9', '');
  end if;

  -- El 0 de discado nacional.
  d := regexp_replace(d, '^0', '');

  -- El 15 va entre el código de área (2 a 4 dígitos) y el abonado. Si sobran
  -- dos dígitos respecto de los 10 que tiene un número argentino, es ése.
  if length(d) = 12 then
    d := regexp_replace(d, '^([0-9]{2,4})15([0-9]+)$', '\1\2');
  end if;

  return nullif(right(d, 10), '');
end
$$;

-- El índice se armó con la versión vieja de la función: hay que rehacerlo.
drop index if exists vecinos_telefono_norm_idx;
create index vecinos_telefono_norm_idx
  on vecinos (app.normalizar_telefono(telefono))
  where telefono is not null and not anonimizado;

-- Los vecinos ya cargados con la normalización vieja quedan reescritos, para
-- que a partir de ahora se reconozcan entre sí.
update vecinos
   set telefono = app.normalizar_telefono(telefono)
 where telefono is not null
   and telefono is distinct from app.normalizar_telefono(telefono);

-- ── 2. Alta rápida de contrapartes ──────────────────────────────────────
--
-- La política de 0013 no alcanzaba: un INSERT ... RETURNING necesita permiso
-- de LECTURA sobre la fila insertada, y el vigilador no puede leer entidades.
-- El alta fallaba con "violates row-level security" sin que el problema
-- estuviera en el insert.
--
-- Se resuelve igual que con los vecinos: una función definidora que es la
-- única puerta. Valida el tipo, fuerza las banderas y devuelve solo el id.
-- Así el vigilador nunca lee la tabla y la coordinadora no pierde el control
-- de la lista.

drop policy if exists entidades_alta_rapida on entidades;

create or replace function app.registrar_entidad_rapida(
  p_nombre text,
  p_tipo   text,
  p_flujo  text
) returns uuid
  language plpgsql security definer set search_path = public, app
as $$
declare
  v_nombre text := trim(p_nombre);
  v_id     uuid;
begin
  if app.uid() is null then
    raise exception 'Sin sesión' using errcode = 'insufficient_privilege';
  end if;
  if length(v_nombre) < 2 then
    raise exception 'El nombre es demasiado corto' using errcode = 'check_violation';
  end if;
  -- Un vigilador no da de alta una empresa ni una dependencia municipal: eso
  -- lo decide la coordinadora.
  if p_tipo not in ('carrero', 'emprendimiento', 'organizacion', 'otro') then
    raise exception 'Tipo no permitido en el alta rápida: %', p_tipo
      using errcode = 'insufficient_privilege';
  end if;

  -- Si ya existe con ese nombre, se reusa en vez de duplicar la lista.
  select id into v_id from entidades where lower(nombre) = lower(v_nombre);
  if v_id is not null then
    return v_id;
  end if;

  insert into entidades (
    nombre, tipo, habilitada_origen, habilitada_destino, flujos,
    pendiente_revision, creado_por_id
  )
  values (
    v_nombre, p_tipo,
    false,                       -- nunca origen: eso habilita un gran generador
    true,
    array[p_flujo]::text[],
    not app.es_admin(),          -- lo que carga la coordinadora ya viene revisado
    app.uid()
  )
  returning id into v_id;

  return v_id;
end
$$;
