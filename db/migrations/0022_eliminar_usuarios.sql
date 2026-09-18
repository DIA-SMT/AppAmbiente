-- ═══════════════════════════════════════════════════════════════════════
-- 0022 · Eliminar un usuario que nunca hizo nada
--
-- «Nada se borra» sigue en pie: la 0019 revocó DELETE y TRUNCATE en toda la
-- base y acá no se re-otorga ninguno de los dos. Un movimiento equivocado se
-- anula con motivo y sigue estando.
--
-- Lo que esta migración abre es otra cosa. La pantalla de usuarios junta
-- pruebas: una cuenta que se creó para ver cómo quedaba, que nunca entró y que
-- desactivada sigue ocupando un renglón en una lista que se lee de un vistazo.
-- Esa fila no es historia de nada.
--
-- La línea no está entre los usuarios que molestan y los que no: está entre los
-- que dejaron rastro y los que no dejaron ninguno. A `perfiles` la apuntan once
-- claves foráneas. Siete están en `on delete restrict` —las que contestan quién
-- cargó, quién anuló, quién pidió— y ésas la base las defiende sola. Las otras
-- cuatro están en `on delete set null`: un borrado las dejaría en null y se
-- perdería, sin un solo mensaje, quién dio de alta esa entidad o ese vecino. Y
-- `auditoria.actor_id` no tiene clave foránea a propósito, porque la auditoría
-- sobrevive a todo: un borrado le dejaría líneas apuntando a alguien que ya no
-- está en ningún lado.
--
-- O sea que el `on delete restrict` cubre siete de los doce casos y en los
-- otros cinco falla callado, que es peor que fallar. Por eso la puerta es una
-- función y no un `grant delete on perfiles`: el permiso suelto deja borrar
-- cualquier perfil, y la condición tiene que vivir del lado de la base y no de
-- la confianza en que la pantalla se acordó de mirarla.
--
-- Del perfil que se va sí quedan sus propias líneas de auditoría —cuándo se
-- creó, con qué nombre, cuándo lo desactivaron—, porque esas miran `registro_id`
-- y no `actor_id`. Se va la fila, no lo que pasó con ella. Y el borrado deja la
-- suya: es la única acción del sistema que no se puede deshacer, así que es la
-- última que puede quedar sin explicación en la pantalla de auditoría.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Una acción más para la auditoría ────────────────────────────────────
-- El disparador de la 0009 es `after insert or update`: el borrado no pasa por
-- ahí y la fila la escribe app.eliminar_perfil a mano. El check enumeraba las
-- tres acciones que existían entonces y ahora son cuatro.

alter table auditoria drop constraint if exists auditoria_accion_check;
alter table auditoria add constraint auditoria_accion_check
  check (accion in ('insert', 'update', 'anular', 'eliminar'));

-- ── Qué dejó atrás ──────────────────────────────────────────────────────
-- Null es «no dejó nada en ninguna parte». Cualquier otra cosa es una frase
-- terminada, lista para poner en pantalla, porque quien la va a leer no tiene
-- por qué saber que existen once tablas: necesita saber por qué el botón de
-- eliminar no está y qué hacer en su lugar.
--
-- Es la misma cuenta que usa db/cli/limpiar-usuarios.ts para decidir si un
-- usuario de la siembra vieja se borra o se desactiva.
--
-- Es `security definer` porque tiene que contar las once tablas enteras, y el
-- que pregunta ve, como mucho, las filas de su propio punto. Eso la vuelve la
-- única función de la base que devuelve números de atrás de RLS, así que pide
-- coordinación antes de contestar: sin esa guarda, un vigilador con el uuid de
-- una cuenta ajena —sale de `anulado_por_id`, que sí puede leer— averiguaría
-- cuántos movimientos, vecinos y conteos cargó una coordinadora, que es
-- exactamente lo que la 0010 le niega fila por fila.

create or replace function app.rastro_de_perfil(p_id uuid) returns text
  language plpgsql stable security definer set search_path = public, app
as $$
declare
  v record;
begin
  if not app.es_admin() then
    raise exception 'Solo la coordinación puede ver esto.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Diez rastros que se cuentan y uno que no. De los que se cuentan gana el más
  -- grande: es el que mejor explica de un vistazo por qué este usuario trabajó.
  -- Empatados gana el de más arriba, y por eso la lista va en orden de peso.
  select r.cuantos, r.singular, r.plural into v
    from (values
      (1, (select count(*) from movimientos where cargado_por_id = p_id),
          'cargó %s movimiento'::text,          'cargó %s movimientos'::text),
      (2, (select count(*) from movimientos where anulado_por_id = p_id),
          'anuló %s movimiento',                'anuló %s movimientos'),
      -- Las dos tablas de control de pila se suman en una sola frase: para
      -- quien mira la pantalla son lo mismo —anotó lo que pasaba con una pila—,
      -- y separarlas obligaría a explicar que hay un formulario por cada una.
      (3, (select count(*) from pila_controles where registrado_por_id = p_id)
        + (select count(*) from pila_controles_proceso where cargado_por_id = p_id),
          'anotó %s control de pila',           'anotó %s controles de pila'),
      (4, (select count(*) from conteos_diarios where cargado_por_id = p_id),
          'anotó %s conteo',                    'anotó %s conteos'),
      (5, (select count(*) from pedidos_recambio where pedido_por_id = p_id),
          'pidió %s recambio',                  'pidió %s recambios'),
      (6, (select count(*) from pedidos_recambio where avisado_por_id = p_id),
          'avisó %s recambio',                  'avisó %s recambios'),
      (7, (select count(*) from vecinos where creado_por_id = p_id),
          'cargó %s vecino',                    'cargó %s vecinos'),
      (8, (select count(*) from entidades where creado_por_id = p_id),
          'dio de alta %s entidad',             'dio de alta %s entidades'),
      (9, (select count(*) from importaciones where importado_por_id = p_id),
          'hizo %s importación',                'hizo %s importaciones'),
      (10, (select count(*) from mapeos_importacion where creado_por_id = p_id),
          'guardó %s mapeo de importación',     'guardó %s mapeos de importación')
    ) as r(orden, cuantos, singular, plural)
   where r.cuantos > 0
   order by r.cuantos desc, r.orden
   limit 1;

  if found then
    return format(case when v.cuantos = 1 then v.singular else v.plural end, v.cuantos);
  end if;

  -- Va última porque un usuario que cargó algo también figura acá, y «cargó 513
  -- movimientos» dice muchísimo más que «figura en la auditoría». Cuando es lo
  -- único que queda, igual alcanza para no borrarlo: sacar la fila dejaría esas
  -- líneas apuntando a un usuario que no se puede volver a nombrar.
  if exists (select 1 from auditoria where actor_id = p_id) then
    return 'figura en la auditoría';
  end if;

  return null;
end
$$;

-- ── La única puerta ─────────────────────────────────────────────────────

create or replace function app.eliminar_perfil(p_id uuid) returns text
  language plpgsql security definer set search_path = public, app
as $$
declare
  v_usuario text;
  v_rastro  text;
  v_filas   int;
begin
  if not app.es_admin() then
    raise exception 'Solo la coordinación puede eliminar usuarios.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Va antes que el control del rastro y no después, porque la coordinadora
  -- siempre tiene rastro de sobra: si estuviera al revés, el error le contaría
  -- cuántos movimientos cargó en vez de lo único que le sirve saber.
  --
  -- Y con esto alcanza para que la base no se quede nunca sin coordinación:
  -- quien llama es admin y acaba de quedar afuera de la lista de candidatos.
  if p_id = app.uid() then
    raise exception 'No podés eliminar tu propio usuario.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Con p_id nulo la comparación de arriba no se cumple —nulo no es falso, pero
  -- tampoco entra al if— y termina saliendo por acá, que es lo que corresponde.
  select usuario into v_usuario from perfiles where id = p_id;
  if v_usuario is null then
    raise exception 'Ese usuario ya no está. Actualizá la pantalla.'
      using errcode = 'no_data_found';
  end if;

  -- Cuando hay rastro el botón no se dibuja, así que llegar hasta acá con uno
  -- significa que el usuario trabajó entre que se cargó la lista y el momento en
  -- que alguien apretó. El texto se arma acá porque sale tal cual a la pantalla:
  -- quien lo lee no tiene por qué saber que existen once tablas.
  v_rastro := app.rastro_de_perfil(p_id);
  if v_rastro is not null then
    raise exception 'No se puede eliminar a %: %. Desactivalo y deja de entrar.',
      v_usuario, v_rastro
      using errcode = 'restrict_violation';
  end if;

  -- Antes del delete y no después, porque después ya no hay de dónde copiar el
  -- usuario ni el nombre. Va sin `credencial_hash`, igual que la auditoría de
  -- siempre. Queda como `antes`: no hay ningún «después» que mirar, y esa
  -- asimetría es justamente la que distingue un borrado de una baja.
  insert into auditoria (tabla, registro_id, accion, actor_id, actor_rol, antes)
  select 'perfiles', p.id, 'eliminar', app.uid(), app.rol(),
         to_jsonb(p) - 'credencial_hash'
    from perfiles p
   where p.id = p_id;

  delete from perfiles where id = p_id;

  -- `perfiles` tiene RLS y no hay ninguna política de borrado. Hoy no se aplica
  -- —la función corre como su dueño, que es dueño de la tabla—, pero si algún
  -- día se le pone `force row level security` el delete no fallaría: no tocaría
  -- ninguna fila y esto devolvería un nombre de usuario que sigue existiendo.
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    raise exception 'No se pudo eliminar a %. Avisá a la Dirección de IA.', v_usuario
      using errcode = 'insufficient_privilege';
  end if;

  return v_usuario;
end
$$;

-- El revoke va primero y no sobra. Postgres le da EXECUTE a PUBLIC a toda
-- función nueva, y PUBLIC incluye a anon: el grant de abajo, solo, daría la
-- impresión de que la puerta está cerrada para los demás sin estarlo. Hoy no se
-- puede explotar porque la 0019 le sacó a anon el USAGE sobre el esquema app,
-- pero ese freno es del esquema y no de la función, y estas dos son
-- `security definer`: corren como el dueño de la tabla, así que el día que
-- alguien devuelva ese USAGE —una extensión, un panel del proveedor, una mano
-- apurada— la única puerta que borra perfiles queda abierta para cualquiera.

revoke execute on function app.rastro_de_perfil(uuid) from public;
revoke execute on function app.eliminar_perfil(uuid)  from public;

grant execute on function app.rastro_de_perfil(uuid) to authenticated;
grant execute on function app.eliminar_perfil(uuid) to authenticated;

-- ── Para que contar el rastro no cueste una recorrida entera ─────────────
-- La pantalla de usuarios pide el rastro de cada perfil de la lista, o sea que
-- estas dos cuentas se hacen una vez por usuario cada vez que se abre. Las
-- otras nueve tablas son chicas y van a seguir siéndolo; éstas dos crecen para
-- siempre. `cargado_por_id` de movimientos ya tenía índice desde la 0007; los
-- que faltaban son éstos, parciales porque la enorme mayoría de las filas no
-- tienen quién las anuló ni quién las creó.

create index if not exists movimientos_anulado_por_idx
  on movimientos (anulado_por_id) where anulado_por_id is not null;

create index if not exists vecinos_creado_por_idx
  on vecinos (creado_por_id) where creado_por_id is not null;

comment on function app.eliminar_perfil(uuid) is
  'La única forma de borrar un perfil. DELETE sigue revocado: las condiciones son de la base, no de la pantalla.';
