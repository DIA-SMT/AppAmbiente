-- ═══════════════════════════════════════════════════════════════════════
-- 0010 · Quién ve qué
--
-- Las reglas viven acá, no en el código de pantalla. Un vigilador con el token
-- de su celular en la mano no puede leer un movimiento de otro punto ni la
-- lista de vecinos, aunque consulte la base directo.
--
-- La app abre cada consulta con:
--     set local role authenticated;
--     select set_config('request.jwt.claims', '{"sub":…,"rol":…,"sitio_id":…}', true);
-- que es el mismo mecanismo de Supabase. Ver db/sesion.ts.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Permisos base ───────────────────────────────────────────────────────

grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Borrar no existe. Ni para la coordinadora: un movimiento equivocado se
-- anula con motivo y sigue en la base. Es la única forma de que el registro
-- sirva como respaldo de lo que pasó.
revoke delete on all tables in schema public from authenticated, anon;

-- La auditoría es de solo lectura incluso para quien la puede ver.
revoke insert, update on auditoria from authenticated, anon;
grant  select on auditoria to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'sitios', 'entidades', 'vehiculos', 'personas', 'unidades', 'materiales',
    'perfiles', 'vecinos', 'pilas', 'contenedores', 'movimientos',
    'movimiento_items', 'mapeos_importacion', 'importaciones', 'pesos_externos',
    'auditoria'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end
$$;

-- ═══ Listas maestras ════════════════════════════════════════════════════
-- El vigilador ve solo las filas activas. Una lista corta es una lista que no
-- se carga mal. La coordinadora administra todo.

create policy sitios_leer on sitios for select to authenticated
  using (app.es_admin() or activo);
create policy sitios_crear on sitios for insert to authenticated
  with check (app.es_admin());
create policy sitios_editar on sitios for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

create policy unidades_leer on unidades for select to authenticated
  using (app.es_admin() or activo);
create policy unidades_crear on unidades for insert to authenticated
  with check (app.es_admin());
create policy unidades_editar on unidades for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

create policy materiales_leer on materiales for select to authenticated
  using (app.es_admin() or activo);
create policy materiales_crear on materiales for insert to authenticated
  with check (app.es_admin());
create policy materiales_editar on materiales for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

create policy vehiculos_leer on vehiculos for select to authenticated
  using (app.es_admin() or activo);
create policy vehiculos_crear on vehiculos for insert to authenticated
  with check (app.es_admin());
create policy vehiculos_editar on vehiculos for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

-- ═══ Entidades ══════════════════════════════════════════════════════════
-- El vigilador no lee esta tabla: los datos de contacto y el CUIT quedan del
-- lado de la coordinadora. Para armar los selectores usa la vista
-- entidades_publicas, que expone nombre y tipo y nada más.

create policy entidades_leer on entidades for select to authenticated
  using (app.es_admin());
create policy entidades_crear on entidades for insert to authenticated
  with check (app.es_admin());
create policy entidades_editar on entidades for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

create view entidades_publicas as
  select id, nombre, tipo, habilitada_origen, habilitada_destino, flujos, activo
    from entidades
   where activo;

grant select on entidades_publicas to authenticated;

-- ═══ Personas ═══════════════════════════════════════════════════════════
-- Mismo criterio: el documento no sale a la pantalla del celular.

create policy personas_leer on personas for select to authenticated
  using (app.es_admin());
create policy personas_crear on personas for insert to authenticated
  with check (app.es_admin());
create policy personas_editar on personas for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

create view personas_publicas as
  select id, nombre, rol, sitio_id, entidad_id, activo
    from personas
   where activo;

grant select on personas_publicas to authenticated;

-- ═══ Perfiles ═══════════════════════════════════════════════════════════

create policy perfiles_leer on perfiles for select to authenticated
  using (app.es_admin() or id = app.uid());
create policy perfiles_crear on perfiles for insert to authenticated
  with check (app.es_admin());
create policy perfiles_editar on perfiles for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

-- ═══ Vecinos ════════════════════════════════════════════════════════════
-- El vigilador puede crear, nunca leer. La lista de vecinos no existe para él.
-- Éstas son las dos líneas que hacen cumplible "los datos de vecinos los ve
-- solo la coordinadora".

create policy vecinos_leer on vecinos for select to authenticated
  using (app.es_admin());
create policy vecinos_crear on vecinos for insert to authenticated
  with check (app.es_admin() or creado_por_id = app.uid());
create policy vecinos_editar on vecinos for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

-- ═══ Movimientos ════════════════════════════════════════════════════════

-- Lee lo cargado en su propio sitio en las últimas 48 horas, para poder
-- revisar el turno. Nada más.
create policy movimientos_leer on movimientos for select to authenticated
  using (
    app.es_admin()
    or (sitio_id = app.sitio_id() and creado_en > now() - interval '48 hours')
  );

-- Solo puede insertar en su propio sitio, a su propio nombre y vigente.
create policy movimientos_crear on movimientos for insert to authenticated
  with check (
    app.es_admin()
    or (
      sitio_id = app.sitio_id()
      and cargado_por_id = app.uid()
      and estado = 'vigente'
    )
  );

create policy movimientos_editar_admin on movimientos for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

-- Diez minutos para deshacer por su cuenta. Pasado ese rato, pide la
-- anulación y la resuelve la coordinadora.
create policy movimientos_deshacer on movimientos for update to authenticated
  using (
    not app.es_admin()
    and cargado_por_id = app.uid()
    and sitio_id = app.sitio_id()
    and estado = 'vigente'
    and creado_en > now() - interval '10 minutes'
  )
  with check (estado = 'anulado');

-- Los ítems siguen la suerte de su movimiento.
create policy items_leer on movimiento_items for select to authenticated
  using (exists (
    select 1 from movimientos m
     where m.id = movimiento_items.movimiento_id
  ));

create policy items_crear on movimiento_items for insert to authenticated
  with check (exists (
    select 1 from movimientos m
     where m.id = movimiento_items.movimiento_id
       and (app.es_admin() or (m.sitio_id = app.sitio_id() and m.cargado_por_id = app.uid()))
  ));

create policy items_editar on movimiento_items for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

-- ═══ Pilas y contenedores (sin pantalla en la fase 1) ═══════════════════

create policy pilas_leer on pilas for select to authenticated
  using (app.es_admin() or (activo and sitio_id = app.sitio_id()));
create policy pilas_administrar on pilas for insert to authenticated
  with check (app.es_admin());
create policy pilas_editar on pilas for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

create policy contenedores_leer on contenedores for select to authenticated
  using (app.es_admin() or activo);
create policy contenedores_administrar on contenedores for insert to authenticated
  with check (app.es_admin());
create policy contenedores_editar on contenedores for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

-- ═══ Importación y auditoría: solo la coordinadora ══════════════════════

create policy mapeos_admin on mapeos_importacion for all to authenticated
  using (app.es_admin()) with check (app.es_admin());

create policy importaciones_admin on importaciones for all to authenticated
  using (app.es_admin()) with check (app.es_admin());

create policy pesos_admin on pesos_externos for all to authenticated
  using (app.es_admin()) with check (app.es_admin());

create policy auditoria_leer on auditoria for select to authenticated
  using (app.es_admin());
