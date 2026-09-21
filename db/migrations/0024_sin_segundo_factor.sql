-- ═══════════════════════════════════════════════════════════════════════
-- 0024 · Se va el segundo factor. Queda el correo y una contraseña propia
--
-- El segundo factor entró hace dos días y se probó: para lo que hace esta
-- herramienta resultó más ceremonia de la que necesita. Escanear un QR, tener
-- ocho códigos anotados en un papel y el teléfono a mano cada vez que se abre
-- el panel es mucho trámite para anotar cuántos kilos entraron a la planta, y
-- cada uno de esos pasos es un lugar donde alguien se queda afuera de su propia
-- cuenta. La identidad queda en el correo institucional, que es con lo que se
-- entra, y la contraseña la elige cada uno.
--
-- Esto último no es el premio consuelo: es lo que arregla lo que venía
-- arrastrándose desde el primer día. Una cuenta de coordinación nace con la
-- contraseña que le escribe quien la crea, y las que existen hoy todavía tienen
-- la de fábrica, que está publicada en el repositorio. Para eso entra
-- `credencial_cambiada_en`: en null quiere decir que esa contraseña la sabe
-- alguien más que su dueño, y el panel no lo deja hacer ninguna otra cosa hasta
-- que elija una propia.
--
-- No se pierde nada de nadie. Las tres cuentas que hay contestan «sin segundo
-- factor» —nunca llegó a configurárselo ninguna—, así que las cuatro columnas
-- que se borran acá abajo están las tres veces en null.
--
-- ── ⚠ ESTA MIGRACIÓN SE APLICA DESPUÉS DE SUBIR EL CÓDIGO, NO ANTES ─────
--
-- EL ORDEN NO ES UNA PREFERENCIA. El código que está hoy en el aire es el de la
-- 0023 y nombra `totp_secreto` y sus compañeras en la consulta del ingreso. Si
-- esto corre primero, esa consulta pasa a nombrar columnas que ya no existen y
-- entonces no entra NADIE: tampoco el vigilador con su PIN, que nunca tuvo nada
-- que ver con el segundo factor. Es la puerta de entrada, y del otro lado no
-- queda nadie adentro para arreglarlo.
--
-- Al revés no pasa nada parecido, y por eso el orden es éste: el código nuevo
-- pregunta si `credencial_cambiada_en` existe antes de nombrarla, así que en el
-- rato que va desde que sube hasta que esto corre se entra igual y lo único que
-- todavía no funciona es la marca de la contraseña propia. Una molestia de un
-- rato contra la Secretaría entera afuera.
--
--     Primero el build. Después esto.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Los dos checks de la 0023: se van, y uno vuelve partido en dos ──────
--
-- Postgres se los llevaría puestos solo, porque los dos nombran columnas que
-- abajo dejan de existir. Se los baja por nombre igual: de los dos sobrevive
-- una regla y media, y así se ve de dónde salen las que quedan escritas más
-- abajo en vez de aparecer de la nada.

alter table perfiles drop constraint perfil_vigilador_sin_correo_ni_segundo_factor;
alter table perfiles drop constraint perfil_correo_y_segundo_factor_coherentes;

-- ── Las columnas del segundo factor ─────────────────────────────────────
--
-- Se van juntas y no de a una: un secreto sin sus códigos de respaldo, o un
-- paso usado sin secreto, es una cuenta trabada en un estado que ninguna
-- pantalla sabe arreglar. Mientras exista una sola de las cuatro va a haber
-- alguien tentado de volver a usarla.

alter table perfiles
  drop column totp_secreto,
  drop column totp_confirmado_en,
  drop column totp_ultimo_paso,
  drop column codigos_respaldo;

-- ── Lo que del correo sigue valiendo igual que ayer ─────────────────────

-- La cuenta del punto la comparten los turnos y se usa en la calle. No tiene
-- correo porque no es de una persona, y eso no puede depender de que ninguna
-- pantalla se acuerde: si mañana la de usuarios ofrece el campo por error, lo
-- frena la base.
--
-- `credencial_cambiada_en` queda libre para el vigilador a propósito. Del lado
-- del punto no significa nada —el portón del panel no existe ahí, el PIN es del
-- sitio y lo comparten los que estén de turno—, y un check de más sobre una
-- columna que nadie mira es una forma de que algo falle mañana sin motivo.
alter table perfiles add constraint perfil_vigilador_sin_correo
  check (rol <> 'vigilador' or correo is null);

-- '' no es lo mismo que nulo y ahí está el problema: pasaría por «tiene correo»
-- en el portón, y al mismo tiempo el índice único de la 0023 rechazaría a la
-- segunda cuenta que lo dejara vacío, con un error que habla de un correo
-- repetido que nadie escribió.
alter table perfiles add constraint perfil_correo_no_vacio
  check (correo is null or btrim(correo) <> '');

-- ── La contraseña propia ────────────────────────────────────────────────
--
-- Null = esta cuenta todavía usa la contraseña con la que la crearon. Es lo
-- único que hace falta guardar para que el portón le pida una propia la primera
-- vez, y la fecha sirve después para saber desde cuándo.
--
-- SIN DEFAULT, y no es un olvido. Con `default now()` toda cuenta nueva nacería
-- diciendo que su dueño ya eligió su contraseña, que es exactamente al revés de
-- lo que pasa: la escribió quien la creó. El alta de la pantalla de usuarios no
-- nombra esta columna justamente para que quede en null.
--
-- Y sin relleno para las que ya están. Todas las cuentas de hoy nacieron con
-- una contraseña que escribió otro —las dos de coordinación siguen teniendo la
-- de fábrica— así que el null que les queda no es una laguna de datos: es el
-- estado en el que están de verdad, y la primera vez que entren el panel les va
-- a pedir la suya.
alter table perfiles add column credencial_cambiada_en timestamptz;

comment on column perfiles.credencial_cambiada_en is
  'Cuándo su dueño eligió la contraseña. Null = la sabe quien creó la cuenta, y el panel no la deja entrar a otra cosa que a elegir una propia.';

-- ── La lista de campos que no se copian a la auditoría ──────────────────
--
-- Queda con el único que sigue existiendo. No cambia lo que hace —de columnas
-- borradas no hay nada que restarle a ningún jsonb— pero esta función también
-- se lee, y es lo último que quedaba nombrando al segundo factor adentro de la
-- base. La lista sigue viviendo en un solo lugar por lo mismo que la 0023 la
-- puso acá: hay dos lugares que escriben en `auditoria` —el disparador y
-- app.eliminar_perfil— y dos listas separadas es cómo se filtra la próxima
-- columna que se agregue.

create or replace function app.campos_reservados() returns text[]
  language sql immutable
as $$
  select array['credencial_hash']
$$;
