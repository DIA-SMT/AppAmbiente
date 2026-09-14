-- ═══════════════════════════════════════════════════════════════════════
-- 0004 · Acceso
--
-- Un usuario por sitio con PIN, más el selector de "vigilador a cargo" que se
-- elige al empezar el turno. La rotación de personal no genera altas ni bajas
-- de cuentas, y cada movimiento igual queda con nombre.
--
-- El PIN se guarda con scrypt (node:crypto), nunca en claro. Si más adelante
-- se migra a Supabase Auth, `perfiles.id` pasa a referenciar auth.users y se
-- descartan las columnas de credenciales; el resto del modelo no cambia.
-- ═══════════════════════════════════════════════════════════════════════

create table perfiles (
  id               uuid primary key default gen_random_uuid(),
  usuario          text not null,
  nombre           text not null,
  rol              text not null check (rol in ('admin', 'vigilador')),
  sitio_id         uuid references sitios (id) on delete restrict,
  credencial_hash  text not null,
  -- La sesión del vigilador no vence; la de la coordinadora sí.
  sesion_horas     int,
  activo           boolean not null default true,
  ultimo_acceso    timestamptz,
  intentos_fallidos int not null default 0,
  bloqueado_hasta  timestamptz,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  -- Un vigilador siempre tiene sitio; la coordinadora ve los tres flujos.
  constraint perfil_sitio_coherente
    check ((rol = 'vigilador' and sitio_id is not null) or (rol = 'admin' and sitio_id is null))
);

create unique index perfiles_usuario_idx on perfiles (lower(usuario));
create index perfiles_sitio_idx on perfiles (sitio_id) where sitio_id is not null;

create trigger perfiles_tocar before update on perfiles
  for each row execute function app.tocar_actualizado_en();

alter table entidades
  add constraint entidades_creado_por_fk
  foreign key (creado_por_id) references perfiles (id) on delete set null;
