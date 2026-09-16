-- ═══════════════════════════════════════════════════════════════════════
-- 0019 · Cerrar lo que Supabase deja abierto de fábrica
--
-- Un proyecto nuevo de Supabase viene con esto configurado:
--
--     alter default privileges in schema public
--       grant all on tables to postgres, anon, authenticated, service_role;
--
-- O sea: cada tabla y cada vista que se crea en `public` nace con TODOS los
-- permisos para `anon` y para `authenticated`. Las migraciones anteriores dan
-- por sentado lo contrario —que un permiso existe sólo si alguien lo otorgó—,
-- que es como se comporta el PGlite de desarrollo. Ahí las dos cosas coinciden;
-- en Supabase no, y la diferencia no da error en ningún lado: simplemente queda
-- abierto, y la app anda igual.
--
-- Tres agujeros concretos, ninguno visible usando la aplicación:
--
--   1. TRUNCATE. La 0010 revoca DELETE, no TRUNCATE, porque en una base limpia
--      nunca se había otorgado. Y TRUNCATE no pasa por las políticas: un
--      vigilador con la cadena de conexión podía vaciar `movimientos` de una.
--
--   2. `entidades_publicas` y `personas_publicas` no son security_invoker a
--      propósito: son la puerta controlada para que el celular vea nombres sin
--      ver CUIT ni teléfono. Pero son vistas simples, así que Postgres las hace
--      escribibles, y al no ser invoker el acceso a la tabla de abajo se evalúa
--      como el dueño de la vista —que, por ser dueño, esquiva RLS—. Con ALL
--      otorgado, un vigilador podía borrar entidades y personas por ahí.
--
--   3. `anon` es el rol de la API REST pública de Supabase. Esta app no lo usa
--      nunca —db/sesion.ts sólo cambia a `authenticated`—, pero con los permisos
--      de fábrica cualquiera con la clave anónima del proyecto podía leer la
--      lista completa de personas y de entidades.
--
-- Esta migración deja explícito el estado que las anteriores daban por
-- implícito. Revocar lo que nunca se otorgó no es un error, así que corre igual
-- sobre el PGlite local, donde no cambia nada.
-- ═══════════════════════════════════════════════════════════════════════

-- ── anon: nada ──────────────────────────────────────────────────────────
-- La 0001 le dio `usage` sobre los dos esquemas cuando todavía no había tablas,
-- por simetría con authenticated. Nunca se usó. Sin `usage` sobre el esquema no
-- puede nombrar un objeto aunque alguien le otorgue permisos sobre él más
-- adelante, que es la única defensa que sobrevive a una tabla nueva.

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all functions in schema app    from anon;
revoke usage on schema public from anon;
revoke usage on schema app    from anon;

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema app    revoke all on functions from anon;

-- ── authenticated: sólo lo que la app usa ───────────────────────────────
-- Se borra todo y se vuelve a otorgar lo de siempre. Lo que desaparece en el
-- camino es lo que Supabase había agregado sin que nadie lo pidiera: TRUNCATE,
-- REFERENCES y TRIGGER sobre las tablas, y la escritura sobre las vistas.

revoke all on all tables in schema public from authenticated;

grant select, insert, update on all tables    in schema public to authenticated;
grant usage,  select         on all sequences in schema public to authenticated;

-- La auditoría se lee y no se toca: es el registro de quién hizo qué.
revoke insert, update on auditoria from authenticated;

-- `all tables` también alcanza a las vistas, así que el grant de arriba les
-- devolvió insert y update. Las vistas se leen y nada más.
do $vistas$
declare
  v record;
begin
  for v in select viewname from pg_views where schemaname = 'public' loop
    execute format('revoke all on public.%I from authenticated', v.viewname);
    execute format('grant select on public.%I to authenticated', v.viewname);
  end loop;
end
$vistas$;

-- Y que una tabla o una vista nueva no vuelva a nacer con todo abierto.
alter default privileges in schema public
  revoke all on tables from authenticated;
alter default privileges in schema public
  grant select, insert, update on tables to authenticated;

-- ── Nada se borra ───────────────────────────────────────────────────────
-- Es la regla del sistema y hasta ahora se apoyaba en un solo revoke. Queda
-- escrita otra vez acá, después de los grants, para que el orden no la anule.

revoke delete, truncate on all tables in schema public from authenticated, anon;
