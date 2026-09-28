-- ═══════════════════════════════════════════════════════════════════════
-- 0025 · Migue, el que contesta preguntas
--
-- Migue es el asistente de consultas: coordinación le pregunta desde el panel
-- y el vigilador desde el celular. Sólo lee. Esta migración no le da ninguna
-- puerta nueva al dominio —movimientos, vecinos, pilas siguen igual y él los
-- lee con la sesión de quien pregunta, por las mismas políticas que las
-- pantallas—. Lo que agrega es lo suyo: la conversación, lo que recuerda, el
-- vocabulario que va aprendiendo, lo que gasta y los cortes por maltrato.
--
-- Cuatro decisiones que no se deducen leyendo las tablas:
--
-- 1 · NINGUNA LLEVA DISPARADOR DE AUDITORÍA, a propósito. `auditoria` no se
--     puede borrar (0019) y la coordinación la lee entera. Una conversación
--     auditada quedaría copiada ahí para siempre, y la regla de Migue es la
--     contraria: todo lo que recuerda se ve y se olvida desde una pantalla. Lo
--     que sí se necesita saber —cuánto se gastó, cuántas veces se cortó una
--     conversación en un punto— tiene su propia tabla, sin texto.
--
-- 2 · LO QUE SE LE MANDA AL MODELO SE GUARDA COMO TEXTO, NO COMO JSONB. La
--     conversación entera se reenvía en cada pregunta, y el proveedor cobra
--     más barato —la mitad o menos, según el modelo— el principio del pedido
--     que ya vio hace un rato: el sistema, las herramientas y los mensajes
--     anteriores. Pero sólo si es idéntico.
--     jsonb reordena las claves de los objetos (por largo y después por bytes:
--     probado en PGlite con un pedido de consulta real), así que la historia
--     que vuelve de la base ya no sería la que se mandó. Con text vuelve
--     exactamente lo que se guardó, y lo que se reenvía es siempre eso.
--
-- 3 · DE QUIÉN ES CADA COSA. Coordinación son cuentas personales: lo suyo es
--     del perfil. Los puntos comparten una cuenta entre quienes rotan, así que
--     la memoria es DEL PUNTO y nunca de una persona, o se mezcla gente. La
--     conversación, en cambio, es del punto y del celular: dos teléfonos del
--     mismo punto escribiendo en el mismo hilo intercalarían mensajes y la
--     historia dejaría de ser la que el proveedor firmó.
--
-- 4 · OLVIDAR NO BORRA FILAS: LAS VACÍA. DELETE y TRUNCATE siguen revocados
--     para todos (0019) y acá no se re-otorgan. Olvidar deja la fila con el
--     contenido en blanco —como hace app.anonimizar_vecino con el vecino— y
--     cierra la conversación, porque una historia con un hueco ya no se puede
--     seguir mandando. Y como un recuerdo queda copiado en el sistema de cada
--     conversación que lo tuvo presente, olvidarlo cierra y vacía también ésas.
--
-- Todo lo que cambia estas tablas pasa por funciones con guarda. La única
-- escritura directa que se permite es abrir una conversación propia. Así, lo
-- que se puede hacer y lo que no está escrito acá, del lado de la base, y no en
-- la confianza de que la pantalla se acordó de mirarlo.
--
-- DESPLIEGUE: es aditiva. Primero este SQL, después el código. El código
-- pregunta si `migue_mensajes` existe antes de mostrar nada, así que un build
-- nuevo contra una base sin esto simplemente no muestra a Migue.
-- ═══════════════════════════════════════════════════════════════════════


-- ── Las conversaciones ──────────────────────────────────────────────────

create table migue_conversaciones (
  id                       uuid primary key default gen_random_uuid(),
  rol                      text not null check (rol in ('admin', 'vigilador')),

  -- El dueño: una coordinadora, o un punto desde un celular. Nunca los dos.
  -- `on delete cascade` acá sí, y es la única vez en todo el esquema: es charla
  -- privada que su dueña puede olvidar cuando quiera, no historia de lo que
  -- pasó. Borrar una cuenta —que app.eliminar_perfil sólo permite si nunca
  -- dejó rastro— se lleva sus conversaciones en vez de trabarse contra ellas.
  perfil_id                uuid references perfiles (id) on delete cascade,
  sitio_id                 uuid references sitios (id) on delete restrict,
  dispositivo_id           uuid,

  -- La cuenta que la abrió. En un punto es la cuenta del punto, no una
  -- persona. Existe para que db:verificar pueda encontrar y limpiar lo que
  -- dejan sus perfiles de prueba en la Planta y en PV-02.
  abierta_por_id           uuid not null references perfiles (id) on delete cascade,

  -- Congelados al abrirla y reenviados idénticos en cada turno. Así la
  -- conversación sigue con las mismas reglas y la misma lista de códigos con
  -- que empezó —un punto que el modelo eligió en la segunda pregunta no deja
  -- de existir en la quinta— y el proveedor reusa el principio del pedido
  -- (punto 2 del encabezado). Un material nuevo o una expresión aprobada
  -- entran en la conversación siguiente, no en ésta.
  modelo                   text not null check (length(modelo) between 3 and 80),
  sistema                  text not null,
  herramientas             text not null,
  recuerdos_incluidos      uuid[] not null default '{}',

  turnos                   int not null default 0 check (turnos >= 0),

  -- Una pregunta a la vez. Lo reclama app.migue_reclamar con un solo UPDATE,
  -- como sumarFallo en src/lib/acceso.ts: leer y después escribir deja pasar a
  -- dos pedidos simultáneos, y dos respuestas intercaladas rompen la historia.
  pregunta_en_curso        uuid,
  pregunta_en_curso_desde  timestamptz,

  -- La primera vez que Migue tuvo que pedir que no lo traten mal. Cortar exige
  -- que esto sea de un turno anterior: se avisa una vez antes de cortar.
  aviso_maltrato_en        timestamptz,

  creada_en                timestamptz not null default now(),
  actualizada_en           timestamptz not null default now(),

  cerrada_en               timestamptz,
  cerrada_por              text check (cerrada_por in
                             ('nueva', 'larga', 'quieta', 'maltrato', 'olvido', 'vencida', 'error')),
  vaciada_en               timestamptz,
  vaciada_por              text check (vaciada_por in ('olvido', 'maltrato', 'vencida')),

  constraint migue_conversacion_dueno check (
    (rol = 'admin' and perfil_id is not null and sitio_id is null and dispositivo_id is null)
    or (rol = 'vigilador' and sitio_id is not null and perfil_id is null and dispositivo_id is not null)
  ),
  constraint migue_conversacion_cierre check ((cerrada_en is null) = (cerrada_por is null)),
  constraint migue_conversacion_vaciado check ((vaciada_en is null) = (vaciada_por is null))
);

-- La lista de conversaciones de cada dueño, de la más nueva a la más vieja.
create index migue_conversaciones_perfil_idx
  on migue_conversaciones (perfil_id, actualizada_en desc) where perfil_id is not null;
create index migue_conversaciones_punto_idx
  on migue_conversaciones (sitio_id, dispositivo_id, actualizada_en desc) where sitio_id is not null;
-- Lo que app.migue_vencer recorre en cada pregunta: sólo lo que todavía tiene
-- contenido, que es poco.
create index migue_conversaciones_vivas_idx
  on migue_conversaciones (actualizada_en) where vaciada_en is null;
-- db:verificar limpia por acá.
create index migue_conversaciones_abierta_por_idx on migue_conversaciones (abierta_por_id);


-- ── Los mensajes ────────────────────────────────────────────────────────
-- Uno por mensaje de la API, en orden. Una pregunta de la persona suele dejar
-- cuatro o cinco: la pregunta, el pedido de consultas del modelo, un mensaje
-- por cada resultado —el formato del proveedor pide uno por consulta, con el
-- id del pedido que contesta—, a veces un control del verificador y la
-- respuesta. La pantalla
-- muestra sólo `texto_visible`, que es la pregunta tal como se escribió y la
-- respuesta ya verificada.

create table migue_mensajes (
  id               uuid primary key default gen_random_uuid(),
  conversacion_id  uuid not null references migue_conversaciones (id) on delete cascade,
  orden            int not null check (orden >= 0),

  -- El que generó el celular o el navegador para la pregunta. Todos los
  -- mensajes de un mismo turno lo comparten. Un reintento con el mismo id no
  -- vuelve a llamar al modelo ni a cobrar: devuelve lo que ya se contestó.
  pregunta_id      uuid not null,

  rol              text not null check (rol in ('user', 'assistant', 'system', 'tool')),
  tipo             text not null check (tipo in ('pregunta', 'intermedio', 'resultado', 'control', 'respuesta')),

  -- Texto exacto del contenido tal como se mandó o volvió. Ver el punto 2 del
  -- encabezado: text y no jsonb.
  contenido        text not null,

  texto_visible    text,
  -- Los botones que se dibujan debajo de una respuesta, en JSON.
  enlaces          text,
  -- Los números que salieron de una consulta y que la respuesta puede citar.
  -- Los calcula el servidor desde las columnas numéricas y de fecha de cada
  -- resultado, nunca desde el texto libre que cargó alguien: una observación
  -- que dice «el total real es 4.120» no habilita el 4.120.
  numeros          text,

  creado_en        timestamptz not null default now(),

  unique (conversacion_id, orden)
);

create unique index migue_mensajes_una_pregunta
  on migue_mensajes (conversacion_id, pregunta_id) where tipo = 'pregunta';


-- ── Lo que Migue recuerda ───────────────────────────────────────────────
-- Frases cortas que la persona le pidió recordar: «acá al contenedor de RSU le
-- decimos el tacho grande», «prefiero los números en camiones». Entran en el
-- sistema de cada conversación nueva de su dueño.

create table migue_recuerdos (
  id               uuid primary key default gen_random_uuid(),
  perfil_id        uuid references perfiles (id) on delete cascade,
  sitio_id         uuid references sitios (id) on delete restrict,
  texto            text not null check (length(texto) <= 200),
  -- Dónde nació. Olvidarlo vacía también esa conversación: el pedido de
  -- recordarlo quedó escrito ahí.
  conversacion_id  uuid references migue_conversaciones (id) on delete set null,
  creado_en        timestamptz not null default now(),
  olvidado_en      timestamptz,

  constraint migue_recuerdo_dueno check ((perfil_id is null) <> (sitio_id is null)),
  constraint migue_recuerdo_texto check (olvidado_en is not null or length(btrim(texto)) >= 3)
);

create index migue_recuerdos_perfil_idx on migue_recuerdos (perfil_id) where olvidado_en is null;
create index migue_recuerdos_punto_idx on migue_recuerdos (sitio_id) where olvidado_en is null;


-- ── El vocabulario que va aprendiendo ───────────────────────────────────
-- Cuando alguien nombra algo de una forma que Migue no tenía anotada y la
-- entiende por el contexto, la propone. No entra sola: la coordinación la
-- aprueba o la descarta, y sólo las aprobadas llegan a las conversaciones
-- nuevas. Así mejora con el uso sin que una frase escrita en la calle —o una
-- instrucción disfrazada de frase— se vuelva regla para todos.

create table migue_expresiones (
  id             uuid primary key default gen_random_uuid(),
  expresion      text not null check (length(expresion) between 2 and 60),
  normalizada    text not null,
  significado    text not null check (length(significado) between 2 and 160),
  tipo           text not null check (tipo in ('punto', 'material', 'recipiente', 'otro')),
  -- El código del punto, el nombre del material o del recipiente. Vacío si
  -- es 'otro'.
  referencia     text not null default '' check (length(referencia) <= 80),
  estado         text not null default 'propuesta'
                   check (estado in ('propuesta', 'aprobada', 'descartada')),
  veces          int not null default 1 check (veces >= 1),
  -- Dónde se escuchó por primera vez. Sirve para leerla: «la del Inca» tiene
  -- sentido en Garcilazo y no en Costanera.
  rol            text not null check (rol in ('admin', 'vigilador')),
  sitio_id       uuid references sitios (id) on delete restrict,
  revisada_en    timestamptz,
  creada_en      timestamptz not null default now(),
  ultima_vez_en  timestamptz not null default now(),

  unique (normalizada, tipo, referencia)
);

create index migue_expresiones_estado_idx on migue_expresiones (estado);


-- ── Lo que gasta ────────────────────────────────────────────────────────
-- Una fila por llamada al proveedor, anotada apenas vuelve y no al final de la
-- pregunta: si el celular corta o la función se cae a mitad de camino, lo que
-- ya se gastó igual queda. El tope del mes se calcula sumando esto.
--
-- El costo no se calcula acá con una tabla de precios: OpenRouter lo devuelve
-- en cada respuesta, ya con el descuento de la caché, en créditos que valen un
-- dólar cada uno (comprobado: 101 tokens de entrada y 25 de salida de
-- gpt-4o-mini dieron 0,00003015, que es exactamente su precio publicado).

create table migue_gasto (
  id               uuid primary key default gen_random_uuid(),
  creado_en        timestamptz not null default now(),
  -- 'perfil:<uuid>' o 'sitio:<uuid>'. Sin clave foránea a propósito: el gasto
  -- del mes no puede bajar porque se eliminó una cuenta.
  dueno            text not null check (dueno ~ '^(perfil|sitio):[0-9a-f-]{36}$'),
  rol              text not null check (rol in ('admin', 'vigilador')),
  sitio_id         uuid references sitios (id) on delete restrict,
  conversacion_id  uuid references migue_conversaciones (id) on delete set null,
  pregunta_id      uuid,
  modelo_pedido    text not null,
  modelo_servido   text not null,
  -- Quién la atendió del otro lado (OpenAI, Azure…). Se pide que sea un
  -- proveedor que no guarde ni entrene con lo que se le manda, y esto deja
  -- constancia de a quién fue cada pregunta.
  proveedor        text not null default '',
  -- El `usage` tal como lo devolvió OpenRouter: tokens, caché y costo.
  uso              text not null,
  costo_usd        numeric(12, 6) not null check (costo_usd >= 0 and costo_usd < 50)
);

create index migue_gasto_fecha_idx on migue_gasto (creado_en);
create index migue_gasto_dueno_idx on migue_gasto (dueno, creado_en);


-- ── Lo que se cuenta sin guardar texto ──────────────────────────────────
-- Un punto que acumula conversaciones cortadas casi nunca es un problema de
-- conducta: es que la app le está haciendo perder tiempo. Es señal de
-- producto, y para leerla alcanza con el punto y la semana.
--
-- Por eso no hay hora, ni conversación, ni perfil: con dos coordinadoras, o
-- con un solo vigilador por turno, la hora exacta ya diría quién fue. Y los
-- maltratos sólo se anotan en los puntos: en coordinación son dos personas y
-- no hay ningún producto que mejorar contándolos.

create table migue_eventos (
  id        uuid primary key default gen_random_uuid(),
  semana    date not null,
  tipo      text not null check (tipo in ('maltrato', 'numero_sin_respaldo')),
  rol       text not null check (rol in ('admin', 'vigilador')),
  sitio_id  uuid references sitios (id) on delete restrict,

  constraint migue_evento_maltrato_de_punto check (
    tipo <> 'maltrato' or (rol = 'vigilador' and sitio_id is not null)
  )
);

create index migue_eventos_idx on migue_eventos (semana, sitio_id);


-- ── Permisos ────────────────────────────────────────────────────────────
-- La 0019 dejó los default privileges en select, insert y update para
-- `authenticated`, así que cada tabla nueva nace con las tres. Acá se saca lo
-- que no corresponde: la única escritura directa es abrir una conversación
-- propia; todo lo demás pasa por las funciones de más abajo. El truncate se
-- vuelve a sacar porque el revoke de la 0019 alcanzó sólo a las tablas que
-- existían entonces; borrar no existe para nadie.

grant select, insert on migue_conversaciones to authenticated;
revoke update on migue_conversaciones from authenticated;

grant select on migue_mensajes, migue_recuerdos, migue_expresiones, migue_gasto, migue_eventos
  to authenticated;
revoke insert, update on migue_mensajes, migue_recuerdos, migue_expresiones, migue_gasto, migue_eventos
  from authenticated;

revoke all on migue_conversaciones, migue_mensajes, migue_recuerdos, migue_expresiones,
              migue_gasto, migue_eventos
  from anon;
revoke delete, truncate on migue_conversaciones, migue_mensajes, migue_recuerdos,
                           migue_expresiones, migue_gasto, migue_eventos
  from authenticated, anon;

alter table migue_conversaciones enable row level security;
alter table migue_mensajes       enable row level security;
alter table migue_recuerdos      enable row level security;
alter table migue_expresiones    enable row level security;
alter table migue_gasto          enable row level security;
alter table migue_eventos        enable row level security;

-- Cada dueño lee lo suyo, y nada más. Acá NO va el `app.es_admin() or …` de
-- casi todas las políticas del sistema: la coordinación no lee las
-- conversaciones de los puntos ni las de la otra coordinadora. Una charla con
-- Migue no es un registro de trabajo.
create policy migue_conversaciones_leer on migue_conversaciones for select to authenticated
  using (
    (rol = 'admin' and perfil_id = app.uid() and app.es_admin())
    or (rol = 'vigilador' and sitio_id = app.sitio_id() and not app.es_admin())
  );

create policy migue_conversaciones_crear on migue_conversaciones for insert to authenticated
  with check (
    abierta_por_id = app.uid()
    and turnos = 0 and pregunta_en_curso is null and cerrada_en is null and vaciada_en is null
    and (
      (rol = 'admin' and app.es_admin() and perfil_id = app.uid())
      or (rol = 'vigilador' and not app.es_admin() and sitio_id = app.sitio_id())
    )
  );

-- Heredan la visibilidad de su conversación: la subconsulta corre con las
-- políticas de quien pregunta.
create policy migue_mensajes_leer on migue_mensajes for select to authenticated
  using (exists (select 1 from migue_conversaciones c where c.id = conversacion_id));

-- Los recuerdos de un punto son operativos —cómo se nombran las cosas ahí—, y
-- la coordinación los puede ver y olvidar. Los de una coordinadora son sólo
-- suyos: la otra no los ve.
create policy migue_recuerdos_leer on migue_recuerdos for select to authenticated
  using (
    (perfil_id is not null and perfil_id = app.uid() and app.es_admin())
    or (sitio_id is not null and (app.es_admin() or sitio_id = app.sitio_id()))
  );

-- Las aprobadas las lee cualquiera: son el vocabulario que reciben las
-- conversaciones nuevas, y donde más hace falta es en los puntos. Las
-- propuestas y las descartadas, sólo la coordinación, que es quien las revisa.
create policy migue_expresiones_leer on migue_expresiones for select to authenticated
  using (app.es_admin() or estado = 'aprobada');

create policy migue_gasto_leer on migue_gasto for select to authenticated
  using (app.es_admin());

create policy migue_eventos_leer on migue_eventos for select to authenticated
  using (app.es_admin());


-- ── Funciones: de quién es ──────────────────────────────────────────────
-- Todas las de más abajo son `security definer` —escriben en tablas donde
-- `authenticated` no puede— y por eso todas arrancan igual que las de la 0022:
-- plpgsql, la guarda como primera sentencia, y el dueño sacado de la sesión,
-- nunca de un parámetro. app.registrar_vecino recibe el sitio por parámetro y
-- escribe con el que le pasen; acá eso no se repite.

create or replace function app.migue_dueno() returns text
  language sql stable set search_path = public, app
as $$
  select case
    when app.uid() is null then null
    when app.es_admin() then 'perfil:' || app.uid()::text
    when app.sitio_id() is not null then 'sitio:' || app.sitio_id()::text
  end
$$;

-- Si la conversación es de quien pregunta. Con el uuid de una ajena devuelve
-- falso, igual que con uno que no existe: el mensaje de error no tiene que
-- distinguir «no es tuya» de «no está», o serviría para averiguar ids.
create or replace function app.migue_es_mia(p_conversacion uuid) returns boolean
  language sql stable security definer set search_path = public, app
as $$
  select exists (
    select 1 from migue_conversaciones c
     where c.id = p_conversacion
       and (
         (c.rol = 'admin' and c.perfil_id = app.uid() and app.es_admin())
         or (c.rol = 'vigilador' and c.sitio_id = app.sitio_id() and not app.es_admin())
       )
  )
$$;

create or replace function app.migue_exigir_conversacion(p_conversacion uuid) returns void
  language plpgsql stable security definer set search_path = public, app
as $$
begin
  if app.uid() is null then
    raise exception 'Se cerró la sesión. Volvé a entrar.' using errcode = 'insufficient_privilege';
  end if;
  if not app.migue_es_mia(p_conversacion) then
    raise exception 'Esa conversación no está. Empezá una nueva.' using errcode = 'insufficient_privilege';
  end if;
end
$$;


-- ── Funciones: una pregunta, de punta a punta ───────────────────────────

-- Reclama la conversación para una pregunta. Devuelve:
--   'libre'     la tomó esta pregunta, se puede contestar;
--   'hecha'     esa pregunta ya se contestó: devolver lo guardado, no cobrar;
--   'en_curso'  esa misma pregunta se está contestando (un reintento del
--               celular mientras el primer pedido sigue andando);
--   'ocupada'   se está contestando otra;
--   'cerrada'   la conversación se cerró.
-- Un reclamo de hace más de cuatro minutos se da por muerto: la función de
-- Vercel no vive más de uno, así que si pasó eso fue que se cayó.
create or replace function app.migue_reclamar(p_conversacion uuid, p_pregunta uuid) returns text
  language plpgsql security definer set search_path = public, app
as $$
declare
  v migue_conversaciones;
begin
  perform app.migue_exigir_conversacion(p_conversacion);

  if exists (select 1 from migue_mensajes
              where conversacion_id = p_conversacion and pregunta_id = p_pregunta and tipo = 'pregunta') then
    return 'hecha';
  end if;

  update migue_conversaciones
     set pregunta_en_curso = p_pregunta, pregunta_en_curso_desde = now()
   where id = p_conversacion
     and cerrada_en is null
     and (pregunta_en_curso is null or pregunta_en_curso_desde < now() - interval '4 minutes')
  returning * into v;
  if found then
    return 'libre';
  end if;

  select * into v from migue_conversaciones where id = p_conversacion;
  if v.cerrada_en is not null then
    return 'cerrada';
  end if;
  if v.pregunta_en_curso = p_pregunta then
    return 'en_curso';
  end if;
  return 'ocupada';
end
$$;

-- Cuántas preguntas tiene en curso ahora el dueño de la sesión, contando
-- todas sus conversaciones, y el bloqueo del dueño hasta el final de la
-- transacción. El orquestador la llama primero, antes de leer el gasto.
--
-- Por qué: el tope diario y el del mes se controlan leyendo lo gastado, y el
-- gasto se anota recién cuando vuelve cada llamada al modelo. migue_reclamar
-- frena dos preguntas a la vez en la MISMA conversación, pero una pregunta sin
-- conversación abre otra, y eso no tenía límite. Veinte pedidos simultáneos
-- desde la cuenta de un punto leían todos el mismo gasto, pasaban todos el
-- control y cada uno podía hacer seis llamadas: un solo punto pasaba su parte
-- del día y, con insistencia, se comía el tope del mes y apagaba a Migue para
-- todos hasta el 1°.
--
-- Con el bloqueo, la preparación de una pregunta espera a que termine la del
-- pedido anterior del mismo dueño, y como en READ COMMITTED cada sentencia ve
-- lo ya confirmado, ve su reclamo. El orquestador rechaza a partir de dos en
-- curso, y cuenta cada una con una reserva de gasto contra el tope: así lo que
-- se puede pasar queda acotado a eso, por dueño. Es volatile, lo que ya es por
-- omisión, y tiene que seguir así: una stable no vería el reclamo que se
-- confirmó mientras esperaba el bloqueo.
create or replace function app.migue_tomar_lugar() returns int
  language plpgsql security definer set search_path = public, app
as $$
declare
  v_dueno   text := app.migue_dueno();
  v_cuantas int;
begin
  if v_dueno is null then
    raise exception 'Se cerró la sesión. Volvé a entrar.' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_dueno));

  -- Los mismos cuatro minutos que migue_reclamar: un reclamo más viejo es de
  -- una función que se cayó, y no ocupa lugar.
  select count(*)::int into v_cuantas
    from migue_conversaciones c
   where c.pregunta_en_curso is not null
     and c.pregunta_en_curso_desde > now() - interval '4 minutes'
     and ((c.rol = 'admin' and v_dueno = 'perfil:' || c.perfil_id::text)
       or (c.rol = 'vigilador' and v_dueno = 'sitio:' || c.sitio_id::text));
  return v_cuantas;
end
$$;

-- Suelta el reclamo sin guardar nada: el proveedor falló, la pregunta se
-- rechazó. La historia queda como estaba antes de la pregunta.
create or replace function app.migue_soltar(p_conversacion uuid, p_pregunta uuid) returns void
  language plpgsql security definer set search_path = public, app
as $$
begin
  perform app.migue_exigir_conversacion(p_conversacion);
  update migue_conversaciones
     set pregunta_en_curso = null, pregunta_en_curso_desde = null
   where id = p_conversacion and pregunta_en_curso = p_pregunta;
end
$$;

-- Guarda el turno entero de una vez: la pregunta, cada ronda de consultas con
-- sus resultados, el control si hubo, y la respuesta. Van juntos o no va
-- ninguno. Un corte a mitad de camino no deja nunca un pedido de consulta sin
-- su resultado, que es lo que el proveedor rechaza para siempre en la
-- pregunta siguiente.
create or replace function app.migue_guardar_turno(
  p_conversacion  uuid,
  p_pregunta      uuid,
  p_roles         text[],
  p_tipos         text[],
  p_contenidos    text[],
  p_visibles      text[],
  p_enlaces       text[],
  p_numeros       text[]
) returns int
  language plpgsql security definer set search_path = public, app
as $$
declare
  v_cuantos  int := coalesce(array_length(p_roles, 1), 0);
  v_orden    int;
begin
  perform app.migue_exigir_conversacion(p_conversacion);

  perform 1 from migue_conversaciones
   where id = p_conversacion and pregunta_en_curso = p_pregunta and cerrada_en is null
     for update;
  if not found then
    raise exception 'Esa pregunta ya no está en curso. Mandala de nuevo.'
      using errcode = 'lock_not_available';
  end if;

  if v_cuantos < 2
     or coalesce(array_length(p_tipos, 1), 0) <> v_cuantos
     or coalesce(array_length(p_contenidos, 1), 0) <> v_cuantos
     or coalesce(array_length(p_visibles, 1), 0) <> v_cuantos
     or coalesce(array_length(p_enlaces, 1), 0) <> v_cuantos
     or coalesce(array_length(p_numeros, 1), 0) <> v_cuantos
     or p_tipos[1] <> 'pregunta'
     or p_tipos[v_cuantos] <> 'respuesta' then
    raise exception 'El turno llegó incompleto.' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(max(orden), -1) + 1 into v_orden
    from migue_mensajes where conversacion_id = p_conversacion;

  insert into migue_mensajes
    (conversacion_id, orden, pregunta_id, rol, tipo, contenido, texto_visible, enlaces, numeros)
  select p_conversacion, v_orden + i - 1, p_pregunta,
         p_roles[i], p_tipos[i], p_contenidos[i], p_visibles[i], p_enlaces[i], p_numeros[i]
    from generate_subscripts(p_roles, 1) as i;

  update migue_conversaciones
     set turnos = turnos + 1,
         actualizada_en = now(),
         pregunta_en_curso = null,
         pregunta_en_curso_desde = null
   where id = p_conversacion;

  return v_orden;
end
$$;

-- Cierra sin vaciar: la persona empezó otra, se hizo demasiado larga, o hubo
-- un error del que no se puede seguir. Lo escrito se sigue viendo hasta que
-- venza.
create or replace function app.migue_cerrar(p_conversacion uuid, p_motivo text) returns void
  language plpgsql security definer set search_path = public, app
as $$
begin
  perform app.migue_exigir_conversacion(p_conversacion);
  if p_motivo not in ('nueva', 'larga', 'error') then
    raise exception 'Motivo de cierre desconocido.' using errcode = 'invalid_parameter_value';
  end if;
  update migue_conversaciones
     set cerrada_en = coalesce(cerrada_en, now()),
         cerrada_por = coalesce(cerrada_por, p_motivo),
         pregunta_en_curso = null,
         pregunta_en_curso_desde = null
   where id = p_conversacion;
end
$$;


-- ── Funciones: olvidar ──────────────────────────────────────────────────

-- La que vacía. No se le da permiso a nadie: la llaman las de abajo, cada una
-- con su guarda. Se vacía todo lo que tiene texto —el sistema, que tiene los
-- recuerdos adentro; las herramientas; y cada mensaje, con su texto visible,
-- sus enlaces y sus números— y se cierra, porque una historia con huecos ya no
-- se le puede volver a mandar al proveedor.
create or replace function app.migue_vaciar(p_conversacion uuid, p_motivo text) returns void
  language plpgsql security definer set search_path = public, app
as $$
begin
  update migue_mensajes
     set contenido = '', texto_visible = null, enlaces = null, numeros = null
   where conversacion_id = p_conversacion;

  update migue_conversaciones
     set sistema = '',
         herramientas = '',
         recuerdos_incluidos = '{}',
         vaciada_en = coalesce(vaciada_en, now()),
         vaciada_por = coalesce(vaciada_por, p_motivo),
         cerrada_en = coalesce(cerrada_en, now()),
         cerrada_por = coalesce(cerrada_por, p_motivo),
         pregunta_en_curso = null,
         pregunta_en_curso_desde = null
   where id = p_conversacion;
end
$$;

-- Olvidar una conversación la puede sólo su dueño. La coordinación no, a
-- propósito: tampoco puede leerla.
create or replace function app.migue_olvidar_conversacion(p_conversacion uuid) returns void
  language plpgsql security definer set search_path = public, app
as $$
begin
  perform app.migue_exigir_conversacion(p_conversacion);
  perform app.migue_vaciar(p_conversacion, 'olvido');
end
$$;

-- Olvidar un recuerdo lo vacía y además cierra y vacía cada conversación que
-- lo tuvo presente: la que lo creó —el pedido de recordarlo quedó escrito ahí—
-- y todas las que lo recibieron en su sistema. Si no, el recuerdo «olvidado»
-- seguiría viajando al proveedor en cada turno de esas conversaciones. La
-- pantalla lo avisa antes del botón.
create or replace function app.migue_olvidar_recuerdo(p_recuerdo uuid) returns void
  language plpgsql security definer set search_path = public, app
as $$
declare
  v migue_recuerdos;
begin
  if app.uid() is null then
    raise exception 'Se cerró la sesión. Volvé a entrar.' using errcode = 'insufficient_privilege';
  end if;

  select * into v from migue_recuerdos where id = p_recuerdo;
  if not found or v.olvidado_en is not null
     or not (
       (v.perfil_id is not null and v.perfil_id = app.uid() and app.es_admin())
       or (v.sitio_id is not null and (app.es_admin() or v.sitio_id = app.sitio_id()))
     ) then
    raise exception 'Ese recuerdo ya no está. Actualizá la pantalla.' using errcode = 'no_data_found';
  end if;

  update migue_recuerdos set texto = '', olvidado_en = now() where id = p_recuerdo;

  perform app.migue_vaciar(c.id, 'olvido')
     from migue_conversaciones c
    where c.vaciada_en is null
      and (p_recuerdo = any (c.recuerdos_incluidos) or c.id = v.conversacion_id);
end
$$;

-- Lo que vence solo. Lo del punto dura 48 horas, lo mismo que el vigilador ve
-- de los movimientos: una respuesta vieja no puede seguir mostrándole al turno
-- siguiente lo que la base ya le esconde. Lo de coordinación, 90 días. Y una
-- conversación del punto quieta hace más de dos horas se cierra sin vaciarse,
-- para que el que entra al turno siguiente empiece de cero.
--
-- Se llama al principio de cada pregunta y al abrir «Lo que Migue recuerda».
-- No hay tareas programadas en este sistema, y así no hacen falta. Recorre de
-- a 50 para que una pregunta nunca pague el atraso de semanas.
create or replace function app.migue_vencer() returns int
  language plpgsql security definer set search_path = public, app
as $$
declare
  v_id      uuid;
  v_cuantas int := 0;
begin
  if app.uid() is null then
    raise exception 'Se cerró la sesión. Volvé a entrar.' using errcode = 'insufficient_privilege';
  end if;

  for v_id in
    select id from migue_conversaciones
     where vaciada_en is null
       and ((rol = 'vigilador' and actualizada_en < now() - interval '48 hours')
         or (rol = 'admin' and actualizada_en < now() - interval '90 days'))
     order by actualizada_en
     limit 50
  loop
    perform app.migue_vaciar(v_id, 'vencida');
    v_cuantas := v_cuantas + 1;
  end loop;

  update migue_conversaciones
     set cerrada_en = now(), cerrada_por = 'quieta'
   where rol = 'vigilador'
     and cerrada_en is null
     and vaciada_en is null
     and pregunta_en_curso is null
     and actualizada_en < now() - interval '2 hours';

  return v_cuantas;
end
$$;


-- ── Funciones: lo que el modelo puede pedir ─────────────────────────────
-- Las tres cosas que Migue escribe por su cuenta, y sólo en lo suyo. Los
-- límites están acá y no en el prompt: pedirle al modelo que no guarde un
-- teléfono no alcanza, y el recuerdo lo lee el del turno siguiente.

-- Si un texto trae algo con forma de teléfono, documento o correo. Es la misma
-- forma que tieneDatoPersonal() en src/lib/migue/limites.ts, que es con la que
-- el servidor rechaza la pregunta, y tienen que cambiar juntas: si la base
-- aceptara menos que el servidor, un recuerdo que el modelo arma con la
-- pregunta ya aceptada fallaría sin que nadie entienda por qué.
--
--   · Siete dígitos o más con hasta tres caracteres de separación entre uno y
--     otro: «381 - 555 - 1234», «381_555_1234», «(381) 555-1234»,
--     «DNI 30.123.456». Antes era uno solo, y los dos primeros pasaban.
--   · Antes se pasa a NFKC: algunos teclados de celular escriben dígitos de
--     ancho completo («３８１…») que \d no reconoce.
--   · Y antes se apartan las fechas. «desde el 01-10-2026 abre a las 8» son
--     ocho dígitos con guiones y no es el teléfono de nadie; con la forma de
--     antes caía como si lo fuera.
--   · Un '@' en cualquier lado, o la palabra «arroba»: «juan(arroba)gmail.com».
--
-- No se le da a nadie: sólo la llaman las de abajo.
create or replace function app.migue_tiene_dato_personal(p_texto text) returns boolean
  language plpgsql immutable set search_path = public, app
as $$
declare
  v text := normalize(coalesce(p_texto, ''), NFKC);
begin
  v := regexp_replace(v, '\y\d{4}-\d{1,2}-\d{1,2}\y', ' ', 'g');
  v := regexp_replace(v, '\y\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\y', ' ', 'g');
  v := regexp_replace(v, '\y(19|20)\d{2}\y', ' ', 'g');
  return v ~ '\d([\s._()-]{0,3}\d){6,}' or v ~ '@' or v ~* '\yarroba\y';
end
$$;

create or replace function app.migue_recordar(p_conversacion uuid, p_texto text) returns uuid
  language plpgsql security definer set search_path = public, app
as $$
declare
  v_c       migue_conversaciones;
  v_texto   text := btrim(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g'));
  v_activos int;
  v_id      uuid;
begin
  perform app.migue_exigir_conversacion(p_conversacion);
  select * into v_c from migue_conversaciones where id = p_conversacion;

  if length(v_texto) < 3 or length(v_texto) > 200 then
    raise exception 'Lo que recuerdo tiene que ser una frase corta, de hasta 200 letras.'
      using errcode = 'check_violation';
  end if;
  if app.migue_tiene_dato_personal(v_texto) then
    raise exception 'No guardo teléfonos, documentos ni correos. Eso va en su pantalla.'
      using errcode = 'check_violation';
  end if;

  -- Si ya lo recuerda, se devuelve el que está. Recordar corre en su propia
  -- transacción y queda confirmado aunque después falle la vuelta siguiente
  -- del modelo: con «acordate que al contenedor de RSU le decimos el tacho
  -- grande» y un 429 al final, el reintento con el mismo id no ve la historia
  -- descartada, vuelve a pedir recordar y quedaban dos iguales, que ocupaban
  -- dos de los veinte lugares en cada conversación nueva. Va antes del tope:
  -- con veinte, repetir uno no es pedir uno más.
  select id into v_id from migue_recuerdos
   where olvidado_en is null
     and lower(texto) = lower(v_texto)
     and ((v_c.perfil_id is not null and perfil_id = v_c.perfil_id)
       or (v_c.sitio_id is not null and sitio_id = v_c.sitio_id))
   limit 1;
  if found then
    return v_id;
  end if;

  select count(*) into v_activos from migue_recuerdos
   where olvidado_en is null
     and ((v_c.perfil_id is not null and perfil_id = v_c.perfil_id)
       or (v_c.sitio_id is not null and sitio_id = v_c.sitio_id));
  if v_activos >= 20 then
    raise exception 'Ya recuerdo 20 cosas. Olvidá alguna desde «Lo que Migue recuerda».'
      using errcode = 'check_violation';
  end if;

  insert into migue_recuerdos (perfil_id, sitio_id, texto, conversacion_id)
  values (v_c.perfil_id, v_c.sitio_id, v_texto, p_conversacion)
  returning id into v_id;
  return v_id;
end
$$;

create or replace function app.migue_anotar_expresion(
  p_expresion   text,
  p_significado text,
  p_tipo        text,
  p_referencia  text
) returns void
  language plpgsql security definer set search_path = public, app
as $$
declare
  v_expresion   text := btrim(regexp_replace(coalesce(p_expresion, ''), '\s+', ' ', 'g'));
  v_significado text := btrim(regexp_replace(coalesce(p_significado, ''), '\s+', ' ', 'g'));
  v_referencia  text := btrim(coalesce(p_referencia, ''));
begin
  if app.uid() is null then
    raise exception 'Se cerró la sesión. Volvé a entrar.' using errcode = 'insufficient_privilege';
  end if;
  if length(v_expresion) not between 2 and 60 or length(v_significado) not between 2 and 160
     or length(v_referencia) > 80 or p_tipo not in ('punto', 'material', 'recipiente', 'otro') then
    raise exception 'La expresión llegó mal armada.' using errcode = 'check_violation';
  end if;
  -- El significado también: una expresión aprobada entra en el sistema de
  -- todas las conversaciones nuevas, y «el de la señora del 381 555 1234» en
  -- el significado viajaría al proveedor en cada una.
  if app.migue_tiene_dato_personal(v_expresion) or app.migue_tiene_dato_personal(v_significado) then
    raise exception 'Eso no es vocabulario.' using errcode = 'check_violation';
  end if;

  insert into migue_expresiones
    (expresion, normalizada, significado, tipo, referencia, rol, sitio_id)
  values (
    v_expresion,
    lower(translate(v_expresion, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
    v_significado,
    p_tipo,
    v_referencia,
    case when app.es_admin() then 'admin' else 'vigilador' end,
    case when app.es_admin() then null else app.sitio_id() end
  )
  on conflict (normalizada, tipo, referencia)
  do update set veces = migue_expresiones.veces + 1, ultima_vez_en = now();
end
$$;

create or replace function app.migue_avisar_maltrato(p_conversacion uuid) returns void
  language plpgsql security definer set search_path = public, app
as $$
begin
  perform app.migue_exigir_conversacion(p_conversacion);
  update migue_conversaciones
     set aviso_maltrato_en = coalesce(aviso_maltrato_en, now())
   where id = p_conversacion;
end
$$;

-- Corta sólo si ya se avisó en una pregunta ANTERIOR a la que está en curso.
-- Si el modelo quiere cortar de entrada, devuelve falso y el servidor se lo
-- dice: primero se redirige, una vez, con calma. La cuenta no se toca —es del
-- punto y dejaría sin cargar al del turno siguiente— y se puede empezar otra
-- conversación enseguida.
create or replace function app.migue_cortar_por_maltrato(p_conversacion uuid) returns boolean
  language plpgsql security definer set search_path = public, app
as $$
declare
  v migue_conversaciones;
begin
  perform app.migue_exigir_conversacion(p_conversacion);
  select * into v from migue_conversaciones where id = p_conversacion for update;

  -- Y el aviso tiene que haber llegado a la persona: una respuesta guardada
  -- después. Avisar corre en su propia transacción y queda aunque el turno se
  -- descarte. Con un 429 después del aviso, el reintento reclamaba con una hora
  -- más nueva que la del aviso, y si el modelo cortaba de entrada la
  -- conversación se vaciaba al primer insulto, sin que nadie hubiera visto la
  -- redirección.
  if v.aviso_maltrato_en is null
     or v.pregunta_en_curso_desde is null
     or v.aviso_maltrato_en >= v.pregunta_en_curso_desde
     or not exists (select 1 from migue_mensajes
                     where conversacion_id = p_conversacion and tipo = 'respuesta'
                       and creado_en > v.aviso_maltrato_en) then
    return false;
  end if;

  perform app.migue_vaciar(p_conversacion, 'maltrato');

  if v.rol = 'vigilador' then
    insert into migue_eventos (semana, tipo, rol, sitio_id)
    values (date_trunc('week', now() at time zone 'America/Argentina/Tucuman')::date,
            'maltrato', 'vigilador', v.sitio_id);
  end if;
  return true;
end
$$;

create or replace function app.migue_anotar_evento(p_tipo text) returns void
  language plpgsql security definer set search_path = public, app
as $$
begin
  if app.uid() is null then
    raise exception 'Se cerró la sesión. Volvé a entrar.' using errcode = 'insufficient_privilege';
  end if;
  -- El maltrato se anota sólo al cortar, con su control. Por acá, nada más lo
  -- que no dice nada de nadie.
  if p_tipo <> 'numero_sin_respaldo' then
    raise exception 'Evento desconocido.' using errcode = 'invalid_parameter_value';
  end if;
  insert into migue_eventos (semana, tipo, rol, sitio_id)
  values (date_trunc('week', now() at time zone 'America/Argentina/Tucuman')::date,
          p_tipo,
          case when app.es_admin() then 'admin' else 'vigilador' end,
          case when app.es_admin() then null else app.sitio_id() end);
end
$$;


-- ── Funciones: el gasto ─────────────────────────────────────────────────
-- El mes y el día se cortan en hora de Tucumán escrita a mano, sin depender de
-- la zona que tenga la sesión: el tope tiene que dar lo mismo desde cualquier
-- lado que se lo pregunte.

create or replace function app.migue_anotar_gasto(
  p_conversacion    uuid,
  p_pregunta        uuid,
  p_modelo_pedido   text,
  p_modelo_servido  text,
  p_proveedor       text,
  p_uso             text,
  p_costo           numeric
) returns void
  language plpgsql security definer set search_path = public, app
as $$
begin
  if app.uid() is null then
    raise exception 'Se cerró la sesión. Volvé a entrar.' using errcode = 'insufficient_privilege';
  end if;
  if p_conversacion is not null and not app.migue_es_mia(p_conversacion) then
    raise exception 'Esa conversación no está.' using errcode = 'insufficient_privilege';
  end if;

  insert into migue_gasto
    (dueno, rol, sitio_id, conversacion_id, pregunta_id, modelo_pedido, modelo_servido, proveedor, uso, costo_usd)
  values (
    app.migue_dueno(),
    case when app.es_admin() then 'admin' else 'vigilador' end,
    case when app.es_admin() then null else app.sitio_id() end,
    p_conversacion, p_pregunta, p_modelo_pedido, p_modelo_servido,
    coalesce(p_proveedor, ''), coalesce(p_uso, ''), p_costo
  );
end
$$;

-- Lo gastado este mes, de todos. Cualquiera con sesión lo puede preguntar: es
-- un número, el mismo para todos, y sin él no hay forma de saber si Migue
-- todavía puede contestar.
create or replace function app.migue_gasto_del_mes() returns numeric
  language plpgsql stable security definer set search_path = public, app
as $$
begin
  if app.uid() is null then
    raise exception 'Se cerró la sesión. Volvé a entrar.' using errcode = 'insufficient_privilege';
  end if;
  return (
    select coalesce(sum(costo_usd), 0) from migue_gasto
     where creado_en >= (date_trunc('month', now() at time zone 'America/Argentina/Tucuman')
                         at time zone 'America/Argentina/Tucuman')
  );
end
$$;

-- Lo gastado hoy por el dueño de la sesión: el punto entero, o la persona.
create or replace function app.migue_gasto_de_hoy() returns numeric
  language plpgsql stable security definer set search_path = public, app
as $$
begin
  if app.uid() is null then
    raise exception 'Se cerró la sesión. Volvé a entrar.' using errcode = 'insufficient_privilege';
  end if;
  return (
    select coalesce(sum(costo_usd), 0) from migue_gasto
     where dueno = app.migue_dueno()
       and creado_en >= (date_trunc('day', now() at time zone 'America/Argentina/Tucuman')
                         at time zone 'America/Argentina/Tucuman')
  );
end
$$;


-- ── Funciones: la revisión del vocabulario ──────────────────────────────

create or replace function app.migue_revisar_expresion(p_expresion uuid, p_estado text) returns void
  language plpgsql security definer set search_path = public, app
as $$
begin
  if not app.es_admin() then
    raise exception 'Solo la coordinación revisa el vocabulario.' using errcode = 'insufficient_privilege';
  end if;
  if p_estado not in ('propuesta', 'aprobada', 'descartada') then
    raise exception 'Estado desconocido.' using errcode = 'invalid_parameter_value';
  end if;
  update migue_expresiones
     set estado = p_estado,
         revisada_en = case when p_estado = 'propuesta' then null else now() end
   where id = p_expresion;
  if not found then
    raise exception 'Esa expresión ya no está. Actualizá la pantalla.' using errcode = 'no_data_found';
  end if;
end
$$;


-- ── Quién puede llamar a qué ────────────────────────────────────────────
-- El revoke va primero por lo mismo que en la 0022: Postgres le da EXECUTE a
-- PUBLIC a toda función nueva, y éstas corren como el dueño de las tablas. Las
-- cuatro de adentro —migue_es_mia, migue_exigir_conversacion, migue_vaciar y
-- migue_tiene_dato_personal— no se le dan a nadie: sólo las llaman las demás,
-- que ya corren como el dueño.

revoke execute on function app.migue_dueno() from public;
revoke execute on function app.migue_es_mia(uuid) from public;
revoke execute on function app.migue_exigir_conversacion(uuid) from public;
revoke execute on function app.migue_reclamar(uuid, uuid) from public;
revoke execute on function app.migue_tomar_lugar() from public;
revoke execute on function app.migue_soltar(uuid, uuid) from public;
revoke execute on function app.migue_guardar_turno(uuid, uuid, text[], text[], text[], text[], text[], text[]) from public;
revoke execute on function app.migue_cerrar(uuid, text) from public;
revoke execute on function app.migue_vaciar(uuid, text) from public;
revoke execute on function app.migue_olvidar_conversacion(uuid) from public;
revoke execute on function app.migue_olvidar_recuerdo(uuid) from public;
revoke execute on function app.migue_vencer() from public;
revoke execute on function app.migue_tiene_dato_personal(text) from public;
revoke execute on function app.migue_recordar(uuid, text) from public;
revoke execute on function app.migue_anotar_expresion(text, text, text, text) from public;
revoke execute on function app.migue_avisar_maltrato(uuid) from public;
revoke execute on function app.migue_cortar_por_maltrato(uuid) from public;
revoke execute on function app.migue_anotar_evento(text) from public;
revoke execute on function app.migue_anotar_gasto(uuid, uuid, text, text, text, text, numeric) from public;
revoke execute on function app.migue_gasto_del_mes() from public;
revoke execute on function app.migue_gasto_de_hoy() from public;
revoke execute on function app.migue_revisar_expresion(uuid, text) from public;

-- Las de adentro también se le sacan a authenticated, que las recibió por el
-- default privilege del esquema app que puso la 0001.
revoke execute on function app.migue_es_mia(uuid) from authenticated;
revoke execute on function app.migue_exigir_conversacion(uuid) from authenticated;
revoke execute on function app.migue_vaciar(uuid, text) from authenticated;
revoke execute on function app.migue_tiene_dato_personal(text) from authenticated;

grant execute on function app.migue_dueno() to authenticated;
grant execute on function app.migue_reclamar(uuid, uuid) to authenticated;
grant execute on function app.migue_tomar_lugar() to authenticated;
grant execute on function app.migue_soltar(uuid, uuid) to authenticated;
grant execute on function app.migue_guardar_turno(uuid, uuid, text[], text[], text[], text[], text[], text[]) to authenticated;
grant execute on function app.migue_cerrar(uuid, text) to authenticated;
grant execute on function app.migue_olvidar_conversacion(uuid) to authenticated;
grant execute on function app.migue_olvidar_recuerdo(uuid) to authenticated;
grant execute on function app.migue_vencer() to authenticated;
grant execute on function app.migue_recordar(uuid, text) to authenticated;
grant execute on function app.migue_anotar_expresion(text, text, text, text) to authenticated;
grant execute on function app.migue_avisar_maltrato(uuid) to authenticated;
grant execute on function app.migue_cortar_por_maltrato(uuid) to authenticated;
grant execute on function app.migue_anotar_evento(text) to authenticated;
grant execute on function app.migue_anotar_gasto(uuid, uuid, text, text, text, text, numeric) to authenticated;
grant execute on function app.migue_gasto_del_mes() to authenticated;
grant execute on function app.migue_gasto_de_hoy() to authenticated;
grant execute on function app.migue_revisar_expresion(uuid, text) to authenticated;


comment on table migue_conversaciones is
  'Conversaciones con Migue. Cada dueño lee las suyas; la coordinación no lee las de los puntos. Sin auditoría a propósito: se olvidan.';
comment on table migue_mensajes is
  'Cada mensaje tal como se mandó o volvió del proveedor, en texto y no jsonb: la historia tiene que volver idéntica.';
comment on table migue_recuerdos is
  'Lo que Migue recuerda: de la persona en coordinación, del punto en los celulares. Se ve y se olvida desde una pantalla.';
comment on table migue_expresiones is
  'Vocabulario propuesto por Migue. Sólo las aprobadas por la coordinación entran en las conversaciones nuevas.';
comment on table migue_gasto is
  'Una fila por llamada al proveedor. El tope mensual suma esto.';
comment on table migue_eventos is
  'Conteos sin texto, por semana y por punto. Los maltratos sólo de los puntos, y nunca con hora ni perfil.';
