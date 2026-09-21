-- ═══════════════════════════════════════════════════════════════════════
-- 0023 · Correo institucional y segundo factor
--
-- El ingreso al panel de coordinación pasa a ser correo institucional más un
-- código de seis dígitos que cambia cada treinta segundos, el de las
-- aplicaciones de autenticación que ya usa medio municipio. Acá abajo está lo
-- mínimo que eso necesita guardado: dónde escribe cada cuenta su correo, el
-- secreto que comparte con el teléfono, y los códigos de respaldo para cuando
-- el teléfono no está.
--
-- EL INGRESO DEL VIGILADOR NO CAMBIA. Usuario del punto más PIN, sesión que no
-- vence, sin correo y sin código. La cuenta es del punto y la comparten los que
-- estén de turno: trabajan en la calle, muchas veces sin señal, y pedirles un
-- código del teléfono de alguien no es rigor, es un punto verde que no puede
-- anotar lo que recibe. El primer check de más abajo deja eso escrito en la
-- base y no en la confianza de que ninguna pantalla se lo ponga sin querer.
--
-- ── POR QUÉ `correo` QUEDA NULLABLE ─────────────────────────────────────
--
-- Las dos cuentas de coordinación que existen hoy no tienen correo, y esta
-- migración corre sobre la base que ya está andando. Un `not null` obliga a
-- elegir entre dos cosas malas: inventarles una dirección —que alguien va a
-- tener que adivinar, y si adivina mal la cuenta queda con el correo de otro— o
-- que la migración falle justo el día que hay que entregar el sistema. Las dos
-- terminan igual, en que alguien que hoy entra mañana no entra, y con una sola
-- cuenta de coordinación eso no es una molestia: es la base sin dueño y sin
-- forma de volver a tenerlo.
--
-- Así que la exigencia no vive en la columna sino en el portón del panel: un
-- admin sin correo entra con su nombre de usuario, como siempre, y adentro no
-- puede ir a ninguna pantalla que no sea /cuenta hasta cargarlo. No hay ningún
-- momento en el que quede afuera. La base guarda lo que hay; la pantalla pide
-- lo que falta.
--
-- Por la misma razón el dominio tampoco se comprueba acá. Hoy tiene que
-- terminar en @smt.gob.ar y eso lo valida el código, así que el día que
-- aparezca otra dirección municipal se cambia una línea y no hay que migrar
-- nada ni tocar una base en uso.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Correo ──────────────────────────────────────────────────────────────

alter table perfiles add column correo text;

-- Con el que se entra, así que dos cuentas no pueden compartirlo: si no, el
-- ingreso por correo no sabría de quién es la contraseña que le escribieron.
-- Va por lower() porque Direccion.IA@smt.gob.ar y direccion.ia@smt.gob.ar son
-- la misma casilla y nadie se acuerda de cómo lo escribió la primera vez.
--
-- Postgres ya deja repetir nulos en un índice único; el `where` está para que
-- el índice no cargue con las cuentas que no tienen correo —los vigiladores son
-- y van a seguir siendo la mayoría— y para que la condición quede leída al lado
-- del índice.
create unique index perfiles_correo_idx on perfiles (lower(correo))
  where correo is not null;

-- ── Segundo factor ──────────────────────────────────────────────────────

-- El secreto va CIFRADO, nunca en claro (AES-256-GCM con clave derivada de
-- AUTH_SECRET; ver db/totp.ts). En claro, cualquiera que consiga una copia de
-- la base —un respaldo, un volcado, el panel del proveedor— se genera los
-- códigos de las cuentas de coordinación y el segundo factor deja de existir
-- sin que nadie se entere. Cifrado hace falta además la variable de entorno,
-- que vive en otro lado y no viaja con la base.
alter table perfiles add column totp_secreto text;

-- La diferencia entre «abrió la pantalla» y «anda». El secreto se guarda apenas
-- se genera, pero la cuenta no tiene segundo factor hasta que la persona
-- escribe un código salido de su teléfono. Sin esa distinción, alguien que
-- entró a configurarlo y no llegó a escanear el QR queda pidiéndole códigos a
-- un teléfono que no los tiene, o sea afuera y para siempre.
alter table perfiles add column totp_confirmado_en timestamptz;

-- El intervalo de 30 segundos que ya se usó. Un código vale medio minuto y la
-- tolerancia de un paso para cada lado lo estira a minuto y medio: sin esto, el
-- que lo lee por encima del hombro —o en una captura de pantalla— tiene todo
-- ese rato para entrar con el mismo número. Es bigint porque es tiempo unix
-- dividido treinta y no vale la pena hacer la cuenta de cuándo deja de entrar
-- en un int.
alter table perfiles add column totp_ultimo_paso bigint;

-- Ocho códigos de un solo uso, hasheados con el mismo scrypt que las
-- contraseñas (db/credenciales.ts): son credenciales, y una lista de ocho
-- credenciales en claro al lado del correo de la cuenta es peor que una sola
-- contraseña. `not null default '{}'` para que la columna no tenga el estado
-- ambiguo del nulo: o hay códigos sin usar, o la lista está vacía.
alter table perfiles add column codigos_respaldo text[] not null default '{}';

-- ── Lo que no puede pasar ───────────────────────────────────────────────

-- La regla de arriba, escrita donde no depende de ninguna pantalla. Si mañana
-- la de usuarios ofrece por error el campo de correo para un punto verde, la
-- base lo frena.
alter table perfiles add constraint perfil_vigilador_sin_correo_ni_segundo_factor
  check (
    rol <> 'vigilador'
    or (correo is null
        and totp_secreto is null
        and totp_confirmado_en is null
        and totp_ultimo_paso is null
        and codigos_respaldo = '{}')
  );

-- Un segundo factor confirmado sin secreto no lo puede contestar nadie, y un
-- paso usado sin secreto es un número sin nada que comparar: las dos formas
-- dejan la cuenta trabada en un estado que ninguna pantalla sabe arreglar. El
-- reseteo de db:2fa borra las tres columnas juntas, que es como se sale de acá.
--
-- Lo del correo es más chico y más molesto: '' no es nulo, así que pasaría por
-- «tiene correo» en el portón y al mismo tiempo el índice único de arriba
-- rechazaría a la segunda cuenta que lo dejara vacío, con un error que habla de
-- un correo repetido que nadie escribió.
alter table perfiles add constraint perfil_correo_y_segundo_factor_coherentes
  check (
    (totp_confirmado_en is null or totp_secreto is not null)
    and (totp_ultimo_paso is null or totp_secreto is not null)
    and (correo is null or btrim(correo) <> '')
  );

comment on column perfiles.correo is
  'Con el que entra la coordinación. Nullable a propósito: sin él se entra con el usuario y el panel manda a /cuenta.';
comment on column perfiles.totp_secreto is
  'Cifrado con AES-256-GCM, clave derivada de AUTH_SECRET. En claro, una copia de la base es el segundo factor de todos.';
comment on column perfiles.codigos_respaldo is
  'Hasheados con scrypt, igual que las contraseñas. Se consumen de a uno: un código usado sale de la lista.';

-- ── Que nada de esto salga por la auditoría ─────────────────────────────
--
-- `perfiles` tiene disparador de auditoría desde la 0009, y la auditoría copia
-- la fila entera menos una lista de campos reservados que hasta hoy era
-- `credencial_hash` y nada más. Con las columnas de arriba, cada vez que
-- alguien confirma su segundo factor o regenera sus códigos, el secreto y los
-- ocho hashes quedarían además en `auditoria`, que la coordinación lee entera y
-- de donde no se borra nada. Un secreto guardado en un solo lugar se rota el
-- día que hace falta; uno copiado a una tabla que no se borra, no.
--
-- La lista pasa a vivir en una función porque ya hay dos lugares que escriben
-- en `auditoria` —este disparador y app.eliminar_perfil, de la 0022, que arma
-- el jsonb por su cuenta— y va a haber más. Dos listas separadas es cómo se
-- filtra la próxima columna que se agregue.

create or replace function app.campos_reservados() returns text[]
  language sql immutable
as $$
  select array['credencial_hash', 'totp_secreto', 'codigos_respaldo']
$$;

-- Igual que en la 0009; lo único que cambia es de dónde sale la lista.
create or replace function app.registrar_auditoria() returns trigger
  language plpgsql security definer set search_path = public, app
as $$
declare
  accion_detectada text;
  reservados text[] := app.campos_reservados();
begin
  if tg_op = 'INSERT' then
    accion_detectada := 'insert';
  elsif to_jsonb(new) ->> 'estado' = 'anulado' and to_jsonb(old) ->> 'estado' = 'vigente' then
    accion_detectada := 'anular';
  else
    accion_detectada := 'update';
  end if;

  insert into auditoria (tabla, registro_id, accion, actor_id, actor_rol, antes, despues)
  values (
    tg_table_name,
    (to_jsonb(coalesce(new, old)) ->> 'id')::uuid,
    accion_detectada,
    app.uid(),
    app.rol(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) - reservados end,
    to_jsonb(new) - reservados
  );

  return new;
end
$$;

-- El que alcanza a todos. La resta de arriba queda igual —no cuesta nada y así
-- el secreto ni siquiera llega a viajar en el insert—, pero sola no cubre a
-- quien escribe en `auditoria` sin pasar por el disparador, que es lo que hace
-- app.eliminar_perfil con el perfil que borra. Acá la condición deja de
-- depender de que cada nuevo lugar se acuerde de la lista.
create or replace function app.auditoria_sin_secretos() returns trigger
  language plpgsql
as $$
begin
  -- Nulo menos una lista es nulo: un insert sin `antes` sigue sin tenerlo.
  new.antes   := new.antes   - app.campos_reservados();
  new.despues := new.despues - app.campos_reservados();
  return new;
end
$$;

create trigger auditoria_sin_secretos
  before insert on auditoria
  for each row execute function app.auditoria_sin_secretos();

comment on function app.campos_reservados() is
  'Los campos que nunca se copian a la auditoría. Viven en un solo lugar porque hay más de uno que escribe ahí.';
