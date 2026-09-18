-- ═══════════════════════════════════════════════════════════════════════
-- 0020 · Lo que dicen los formularios
--
-- La Secretaría viene registrando su operación en seis formularios de Google
-- desde antes de que existiera este sistema. Leídos campo por campo, varias
-- cosas que la base daba por ciertas resultaron supuestos nuestros: destinos
-- de material que nadie nombra así, un control de pila que no se anota de a
-- una medición, un nombre elegido de una lista donde la planilla de papel pide
-- escribirlo a mano.
--
-- Entre el formulario y el modelo, gana el formulario: es lo que la gente
-- completa todos los días y lo que va a seguir completando si el sistema no le
-- coincide. Esta migración no agrega funciones, corrige vocabulario y forma
-- para que lo que se cargue desde ahora sea comparable con lo que ya venían
-- registrando.
--
-- Los formularios que la originan, por si hay que volver a mirarlos:
--   R-05-01  Ingreso de materiales en PVRV
--   R-05-02  Control de proceso de pilas
--   R-05-06  Entrega de chips, compost y leña
--   R-05-07  Recepción de residuos en Punto Verde
--   R-05-08  Entrega para reutilizar en Punto Verde
-- ═══════════════════════════════════════════════════════════════════════

-- ═══ 1 · Para qué sale el material ══════════════════════════════════════
--
-- Los cuatro valores que tenía tipo_valorizacion —reutilizacion, venta,
-- emprendimiento, otro— los inventamos nosotros en la fase 1. Los formularios
-- de entrega preguntan otra cosa, y preguntan distinto según dónde se entrega,
-- porque son dos operaciones distintas:
--
--   En la Planta (R-05-06, entrega de chips, compost y leña) casi todo el
--   destino es municipal: el material vuelve a la huerta, a las plazas o al
--   programa TRANSFORMA, y lo que sale para afuera va a un vecino, a ecocanje,
--   al aserradero o al CIC.
--
--   En un Punto Verde (R-05-08, entrega para reutilizar) son otras tres cosas,
--   y ninguna coincide con las de la Planta: lo que se lleva alguien para
--   manualidades o su emprendimiento, lo que se vende, y los neumáticos que van
--   al proceso de asfalto de la Planta de Asfalto Municipal.
--
-- La columna sigue llamándose tipo_valorizacion —la usan las vistas, el celular
-- y el tablero—; lo que cambia es qué puede valer.
--
-- Las etiquetas para pantalla, tal cual las escribe cada formulario:
--   uso_interno_huerta      uso interno huerta
--   uso_interno_plazas      uso interno plazas
--   uso_interno_transforma  uso interno TRANSFORMA
--   vecino                  vecino
--   ecocanje                ecocanje
--   aserradero              aserradero
--   cic                     CIC
--   manualidades            manualidades, artesanías y emprendimientos
--   venta                   venta
--   asfalto                 proceso de asfalto de la Planta de Asfalto Municipal
--   otro                    otro

-- El orden es: soltar la restricción vieja, mapear, poner la nueva. No se puede
-- mapear primero, que era lo que decía este comentario: la restricción vieja
-- sigue vigente durante el UPDATE y rechaza 'manualidades' apenas se escribe la
-- primera fila. Tampoco se puede poner la nueva antes de mapear, porque
-- rechazaría las filas viejas. Queda un instante sin ninguna restricción, y por
-- eso las tres sentencias van en la misma transacción, que es como el aplicador
-- corre cada migración.
alter table movimientos drop constraint if exists movimientos_tipo_valorizacion_check;

-- Qué se mapeó a qué:
--
--   emprendimiento → manualidades  en el punto verde es literalmente el mismo
--                                  destino con el nombre del formulario:
--                                  "manualidades, artesanías y emprendimientos".
--   venta          → venta         el punto verde lo sigue teniendo igual.
--   otro           → otro          queda como está, no se toca.
--   reutilizacion  → otro          NO tiene equivalente. En el punto verde toda
--                                  la entrega es para reutilizar —así se llama
--                                  el formulario— y lo que se pregunta es para
--                                  qué; "reutilizacion" no contesta esa
--                                  pregunta, así que no se puede deducir cuál
--                                  de los tres destinos era. Queda en 'otro',
--                                  que es lo honesto: no lo sabemos. Son datos
--                                  sembrados, no cargas reales de la Secretaría.
--
-- Lo mismo vale para lo que haya quedado cargado en la Planta: ninguno de los
-- cuatro valores viejos existe en el vocabulario de la Planta —ahí se pregunta
-- huerta, plazas, TRANSFORMA, vecino, ecocanje, aserradero o CIC—, así que todo
-- va a 'otro'. Sólo se tocan las filas que cambian de verdad, y el cambio queda
-- en la auditoría como cualquier otro.
update movimientos
   set tipo_valorizacion = case
         when tipo_valorizacion = 'emprendimiento' and flujo = 'punto_verde' then 'manualidades'
         when tipo_valorizacion = 'venta' and flujo <> 'planta'              then 'venta'
         else 'otro'
       end
 where tipo_valorizacion in ('reutilizacion', 'emprendimiento')
    or (tipo_valorizacion = 'venta' and flujo = 'planta');

alter table movimientos add constraint movimientos_tipo_valorizacion_check
  check (tipo_valorizacion in (
    'uso_interno_huerta', 'uso_interno_plazas', 'uso_interno_transforma',
    'vecino', 'ecocanje', 'aserradero', 'cic',
    'manualidades', 'venta', 'asfalto',
    'otro'
  ));

-- Y que no se mezclen los dos vocabularios. Un "uso interno TRANSFORMA" en un
-- punto verde no es un dato raro: es un error de carga, y sin esta restricción
-- el tablero lo suma igual.
--
-- El flujo de grandes generadores queda afuera a propósito: no tiene formulario
-- propio, así que no hay nada que verificar. La app le ofrece mientras tanto el
-- vocabulario del punto verde, que es el que más se le parece, y esta
-- restricción no se lo impide ni se lo impone.
alter table movimientos add constraint valorizacion_segun_flujo check (
  tipo_valorizacion is null
  or flujo = 'gran_generador'
  or (flujo = 'planta' and tipo_valorizacion in (
        'uso_interno_huerta', 'uso_interno_plazas', 'uso_interno_transforma',
        'vecino', 'ecocanje', 'aserradero', 'cic', 'otro'))
  or (flujo = 'punto_verde' and tipo_valorizacion in (
        'manualidades', 'venta', 'asfalto', 'otro'))
);

comment on column movimientos.tipo_valorizacion is
  'Para qué se entrega el material, con el vocabulario de cada formulario de entrega: R-05-06 en la Planta, R-05-08 en el punto verde.';

-- ═══ 2 · La bolsa vuelve a existir ══════════════════════════════════════
--
-- 0015 dio de baja 'bolsa' junto con 'tn' y 'unidad', por considerarla una
-- unidad inventada. No lo era: el formulario de entrega de chips, compost y
-- leña (R-05-06) pregunta "Cantidad en bolsas o m3". Es la unidad en la que la
-- Planta entrega compost al vecino.
--
-- Para quien vaya a 0015 a buscar el cambio: la restricción de códigos nunca
-- dejó afuera a 'bolsa' —sigue listada en unidades_codigo_check—, lo que hizo
-- 0015 fue marcar la fila como inactiva, y el vigilador sólo ve las activas.
-- Además, una base nueva ni siquiera tiene la fila, porque db/datos-base.ts
-- tampoco la siembra. Por eso acá se inserta si falta y se reactiva si está.
insert into unidades (codigo, nombre, nombre_plural, decimales, factor_m3, orden)
values ('bolsa', 'bolsa', 'bolsas', 0, null, 9)
on conflict (codigo) do update
  set nombre        = excluded.nombre,
      nombre_plural = excluded.nombre_plural,
      decimales     = excluded.decimales,
      orden         = excluded.orden,
      activo        = true;

-- factor_m3 queda en null a propósito. Una bolsa no es un recipiente rígido
-- como el tambor o la batea: no tiene volumen fijo y depende de cuánto se
-- cargue. Con factor nulo la cantidad se guarda y se informa en bolsas y no se
-- suma a los m³ del tablero, que es exactamente lo que hace 'kg' desde la fase
-- 1, y es preferible a ensuciar toda la serie con una conversión inventada.
comment on column unidades.factor_m3 is
  'Equivalencia declarada a m³. Null = no se convierte: la cantidad se informa en su propia unidad y no suma metros cúbicos, como ya pasaba con kg.';

-- ═══ 3 · El control de proceso de una pila ══════════════════════════════
--
-- pila_controles guarda una fila por control: tipo (volteo, riego,
-- temperatura…) más un valor. Eso lo inventamos nosotros. El R-05-02 es una
-- planilla: una por día y por pila, donde el operario anota de una sola vez qué
-- material incorporó, cuántos m³, TRES temperaturas, y si humedad, riego y
-- volteo están OK o NO OK, más observaciones y su nombre.
--
-- La diferencia no es cosmética. En el modelo viejo, un día sin fila de riego
-- es indistinguible de un día en que se controló el riego y estaba mal; en la
-- planilla eso se anota, y es justamente lo que hace que una pila se pierda.
--
-- Va en tabla nueva y no en columnas nuevas sobre pila_controles porque son dos
-- formas distintas de lo mismo y mezclarlas deja filas que no se sabe qué son.
-- pila_controles queda como está, con sus filas: en este sistema no se borra
-- nada. Lo que tenía cargado se copia acá abajo y las vistas pasan a leer la
-- planilla, así que la tabla vieja queda de archivo y no recibe nada nuevo.

create table pila_controles_proceso (
  id                uuid primary key default gen_random_uuid(),
  pila_id           uuid not null references pilas (id) on delete restrict,
  -- La planilla es del día, no del momento: se completa una vez por jornada.
  fecha             date not null default current_date,

  -- "Material incorporado" del formulario. Texto y no material_id a propósito:
  -- en la planilla se escribe "poda fina y descarte de verdura", y obligar a
  -- elegir uno solo de la lista maestra haría perder el resto. Lo que entra en
  -- serio a la pila ya está en los movimientos con pila_id.
  material_incorporado text,
  volumen_m3        numeric(10, 2) check (volumen_m3 is null or volumen_m3 >= 0),

  -- Tres tomas de temperatura en la misma pila, como viene la planilla. El
  -- formulario no las rotula (no dice punta, medio, punta), así que acá
  -- tampoco: son la primera, la segunda y la tercera.
  temperatura_1     numeric(5, 2),
  temperatura_2     numeric(5, 2),
  temperatura_3     numeric(5, 2),

  -- El formulario no pide el valor sino el juicio de quien controla: OK o
  -- NO OK. Null es "ese día no se controló", que no es lo mismo que NO OK; esa
  -- distinción es la que el modelo viejo no podía guardar.
  humedad           text check (humedad is null or humedad in ('ok', 'no_ok')),
  riego             text check (riego   is null or riego   in ('ok', 'no_ok')),
  volteo            text check (volteo  is null or volteo  in ('ok', 'no_ok')),

  observaciones     text,

  -- Quién completó la planilla, escrito a mano (ver la sección 4). En este
  -- formulario es personal de la Planta y son pocos, pero se escribe igual que
  -- en los otros cuatro para no tener dos formas de anotar lo mismo.
  registrado_por    text not null check (length(trim(registrado_por)) >= 2),
  -- Con qué usuario se cargó. Es lo que miran las políticas de seguridad; el
  -- nombre de arriba es quien firmó la planilla y no tienen por qué coincidir,
  -- porque el usuario del sitio es compartido.
  cargado_por_id    uuid not null references perfiles (id) on delete restrict,

  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  -- Una planilla por día y por pila: es la unidad del formulario. Si se anotó
  -- mal se corrige la misma fila y el cambio queda en la auditoría; dos filas
  -- del mismo día serían dos verdades sobre lo mismo.
  unique (pila_id, fecha)
);

-- El índice de (pila_id, fecha) ya lo crea el unique. Falta el del día, para
-- "qué pilas se controlaron hoy", que es como se usa la pantalla.
create index pila_controles_proceso_fecha_idx on pila_controles_proceso (fecha desc);

create trigger pila_controles_proceso_tocar before update on pila_controles_proceso
  for each row execute function app.tocar_actualizado_en();

create trigger pila_controles_proceso_auditar
  after insert or update on pila_controles_proceso
  for each row execute function app.registrar_auditoria();

-- Una tabla nueva necesita su propio grant: sin él la base corta con
-- "permission denied" antes de evaluar ninguna política. El revoke de 0019
-- alcanzó a las tablas que existían entonces, así que el truncate se vuelve a
-- sacar acá; borrar no existe para nadie.
grant select, insert, update on pila_controles_proceso to authenticated;
revoke delete, truncate on pila_controles_proceso from authenticated, anon;

alter table pila_controles_proceso enable row level security;

-- Sin política de select la tabla devuelve cero filas en silencio, que es peor
-- que un error. Mismo criterio que en 0016: la planilla se ve desde la Planta a
-- la que pertenece la pila, y la coordinación ve todo.
create policy controles_proceso_leer on pila_controles_proceso for select to authenticated
  using (
    app.es_admin()
    or exists (select 1 from pilas p where p.id = pila_id and p.sitio_id = app.sitio_id())
  );

create policy controles_proceso_crear on pila_controles_proceso for insert to authenticated
  with check (
    app.es_admin()
    or (
      cargado_por_id = app.uid()
      and exists (select 1 from pilas p where p.id = pila_id and p.sitio_id = app.sitio_id())
    )
  );

create policy controles_proceso_editar_admin on pila_controles_proceso for update to authenticated
  using (app.es_admin()) with check (app.es_admin());

-- Corregir la planilla del día es parte de completarla: se toma la temperatura
-- a la mañana y el volteo se hace a la tarde. Del día anterior en adelante ya
-- es la coordinación, igual que con los movimientos.
create policy controles_proceso_corregir on pila_controles_proceso for update to authenticated
  using (
    not app.es_admin()
    and fecha = current_date
    and exists (select 1 from pilas p where p.id = pila_id and p.sitio_id = app.sitio_id())
  )
  with check (
    fecha = current_date
    and exists (select 1 from pilas p where p.id = pila_id and p.sitio_id = app.sitio_id())
  );

-- ── Lo ya cargado, pasado a planilla ────────────────────────────────────
-- Los controles sueltos se agrupan por pila y por día, que es la forma nueva.
-- Cómo se traduce cada uno:
--
--   volteo, riego  →  'ok'. Que exista la fila significa que se hizo; en el
--                     modelo viejo no había manera de anotar un NO OK.
--   temperatura    →  temperatura_1, _2 y _3 en el orden en que se tomaron. Si
--                     un día tuvo más de tres, las de más quedan afuera: la
--                     planilla tiene tres casilleros.
--   humedad        →  el porcentaje viejo NO se convierte a OK / NO OK: haría
--                     falta un umbral que nadie fijó. Se conserva como texto en
--                     observaciones para no perderlo.
--   registrado_por →  el nombre del perfil con el que se cargó. Es lo único que
--                     hay: el nombre a mano no existía todavía.
--
-- Si dos personas anotaron controles de la misma pila el mismo día, queda una
-- sola planilla y la otra se descarta: el formulario admite una por día. Lo
-- descartado sigue en pila_controles, que no se toca.
insert into pila_controles_proceso (
  pila_id, fecha, temperatura_1, temperatura_2, temperatura_3,
  volteo, riego, observaciones, registrado_por, cargado_por_id, creado_en
)
select
  c.pila_id,
  c.ocurrido_en::date,
  (array_agg(c.valor order by c.ocurrido_en) filter (where c.tipo = 'temperatura'))[1],
  (array_agg(c.valor order by c.ocurrido_en) filter (where c.tipo = 'temperatura'))[2],
  (array_agg(c.valor order by c.ocurrido_en) filter (where c.tipo = 'temperatura'))[3],
  case when count(*) filter (where c.tipo = 'volteo') > 0 then 'ok' end,
  case when count(*) filter (where c.tipo = 'riego')  > 0 then 'ok' end,
  nullif(concat_ws(' · ',
    string_agg(c.observacion, ' · ') filter (where c.observacion is not null),
    string_agg('humedad ' || c.valor || '%', ' · ') filter (where c.tipo = 'humedad')
  ), ''),
  coalesce(pf.nombre, 'Sin identificar'),
  c.registrado_por_id,
  min(c.creado_en)
from pila_controles c
  left join perfiles pf on pf.id = c.registrado_por_id
group by c.pila_id, c.ocurrido_en::date, c.registrado_por_id, pf.nombre
on conflict (pila_id, fecha) do nothing;

-- ── Las vistas pasan a leer la planilla ─────────────────────────────────
-- v_pilas y v_trazabilidad_salidas contaban volteos y riegos desde
-- pila_controles. Si se quedaran ahí, una pila volteada todos los meses según
-- la planilla aparecería como "volteo atrasado" para siempre. Se rehacen
-- iguales, cambiando de dónde sacan los controles. Las columnas que devuelven
-- son las mismas: ninguna pantalla se entera.

drop view if exists v_pilas;

create view v_pilas with (security_invoker = true) as
select
  p.id,
  p.codigo,
  p.sitio_id,
  s.nombre            as sitio_nombre,
  p.estado,
  p.fecha_armado,
  p.fecha_cierre,
  app.madurez_de_pila(p.fecha_cierre, p.madurez_estimada) as madurez,
  p.largo_m, p.ancho_m, p.alto_m,
  round(p.largo_m * p.ancho_m * p.alto_m, 1)              as volumen_nominal_m3,
  p.composicion,
  p.notas,
  p.activo,
  pe.nombre           as responsable,

  (current_date - p.fecha_armado)                                        as dias_desde_armado,
  case when p.fecha_cierre is not null
       then app.madurez_de_pila(p.fecha_cierre, p.madurez_estimada) - current_date
  end                                                                    as dias_para_madurez,

  c.volteos,
  c.riegos,
  c.ultimo_volteo,
  c.ultima_temperatura,
  -- Una pila madurando que hace más de tres semanas que no se voltea necesita
  -- atención: es el dato que hoy no tienen y que hace que una pila se pierda.
  -- Solo aplica mientras madura: una que ya está lista no se voltea más, y
  -- marcarla en rojo sería ruido que enseña a ignorar el indicador.
  case
    when p.estado <> 'madurando' then false
    when p.fecha_cierre is null  then false
    else coalesce(c.ultimo_volteo, p.fecha_cierre::timestamptz) < now() - interval '21 days'
  end                                                                    as volteo_atrasado,

  coalesce(e.m3, 0)   as m3_ingresados,
  coalesce(sal.m3, 0) as m3_despachados,
  coalesce(e.movimientos, 0)   as ingresos,
  coalesce(sal.movimientos, 0) as salidas
from pilas p
  join sitios s on s.id = p.sitio_id
  left join personas pe on pe.id = p.responsable_id
  left join lateral (
    select
      (count(*) filter (where cp.volteo = 'ok'))                    as volteos,
      (count(*) filter (where cp.riego  = 'ok'))                    as riegos,
      -- La planilla es del día; la hora se pierde y no hace falta: el umbral de
      -- volteo atrasado se mide en semanas.
      (max(cp.fecha) filter (where cp.volteo = 'ok'))::timestamptz  as ultimo_volteo,
      -- La más alta de las tres tomas de la última planilla que midió. Antes
      -- era la máxima histórica, que con una pila ya fría igual mostraba 70°.
      (select greatest(u.temperatura_1, u.temperatura_2, u.temperatura_3)
         from pila_controles_proceso u
        where u.pila_id = p.id
          and coalesce(u.temperatura_1, u.temperatura_2, u.temperatura_3) is not null
        order by u.fecha desc
        limit 1)::numeric                                           as ultima_temperatura
    from pila_controles_proceso cp where cp.pila_id = p.id
  ) c on true
  left join lateral (
    select count(distinct m.id) as movimientos,
           sum(i.cantidad * coalesce(u.factor_m3, 0)) as m3
      from movimientos m
      join movimiento_items i on i.movimiento_id = m.id
      join unidades u on u.id = i.unidad_id
     where m.pila_id = p.id and m.tipo = 'ingreso' and m.estado = 'vigente'
  ) e on true
  left join lateral (
    select count(distinct m.id) as movimientos,
           sum(i.cantidad * coalesce(u.factor_m3, 0)) as m3
      from movimientos m
      join movimiento_items i on i.movimiento_id = m.id
      join unidades u on u.id = i.unidad_id
     where m.pila_id = p.id and m.tipo = 'salida' and m.estado = 'vigente'
  ) sal on true;

grant select on v_pilas to authenticated;

drop view if exists v_trazabilidad_salidas;

create view v_trazabilidad_salidas with (security_invoker = true) as
select
  m.id            as movimiento_id,
  m.numero,
  m.ocurrido_en,
  m.tipo_valorizacion,
  coalesce(de.nombre, m.destino_detalle, 'Sin destino declarado') as destino,
  v.patente,
  ch.nombre       as chofer,
  au.nombre       as autoriza,
  p.id            as pila_id,
  p.codigo        as pila,
  p.fecha_armado,
  p.fecha_cierre,
  app.madurez_de_pila(p.fecha_cierre, p.madurez_estimada) as madurez,
  (select count(*) from pila_controles_proceso c
    where c.pila_id = p.id and c.volteo = 'ok')                    as volteos,
  (select sum(i2.cantidad * coalesce(u2.factor_m3, 0))
     from movimientos m2
     join movimiento_items i2 on i2.movimiento_id = m2.id
     join unidades u2 on u2.id = i2.unidad_id
    where m2.pila_id = p.id and m2.tipo = 'ingreso' and m2.estado = 'vigente') as m3_que_la_formaron,
  (select string_agg(distinct coalesce(oe2.nombre, m2.origen_detalle), ' · ')
     from movimientos m2
     left join entidades_publicas oe2 on oe2.id = m2.origen_entidad_id
    where m2.pila_id = p.id and m2.tipo = 'ingreso' and m2.estado = 'vigente') as procedencias
from movimientos m
  join pilas p on p.id = m.pila_id
  left join entidades_publicas de on de.id = m.destino_entidad_id
  left join vehiculos v           on v.id = m.vehiculo_id
  left join personas_publicas ch  on ch.id = m.chofer_id
  left join personas_publicas au  on au.id = m.autorizado_por_id
where m.tipo = 'salida' and m.estado = 'vigente';

grant select on v_trazabilidad_salidas to authenticated;

-- ═══ 4 · Quién registra, escrito a mano ═════════════════════════════════
--
-- Los cinco formularios operativos piden el nombre de quien registra y lo
-- piden obligatorio, en un campo de texto libre. No es descuido: la Secretaría
-- tiene 67 vigiladores con rotación permanente, así que una lista para elegir
-- nunca va a estar al día y quien esté de turno terminaría eligiendo el nombre
-- de otro con tal de que la pantalla lo deje seguir.
--
-- El selector de personas (vigilador_id) se queda: donde el nombre está en la
-- lista, elegirlo es más rápido y deja el vínculo con la persona. Esta columna
-- es para el resto de los casos, que hoy son la mayoría.

alter table movimientos add column registrado_por text;

comment on column movimientos.registrado_por is
  'Nombre de quien registra, escrito a mano como en los cinco formularios operativos. Convive con vigilador_id porque son 67 vigiladores rotando: la lista nunca está al día.';

-- Todavía NO es obligatoria: hay movimientos cargados sin ella y ponerla not
-- null ahora los rompería. Se vuelve obligatoria cuando la pantalla la pida
-- siempre y lo viejo esté completo o dado por perdido.

-- ═══ 5 · La dirección del vecino ════════════════════════════════════════
--
-- El formulario de recepción en punto verde (R-05-07) pide la dirección. El
-- barrio se queda: la Secretaría lo pidió expresamente para poder informar por
-- distrito, y de una dirección escrita a mano no se deduce el barrio sin
-- geocodificar. Son dos datos distintos, no uno que reemplaza al otro.

alter table vecinos add column direccion text;

comment on column vecinos.direccion is
  'Dirección que pide el R-05-07. No reemplaza a barrio: el barrio es lo que permite informar por distrito.';

-- Anonimizar tiene que vaciar también la dirección, que identifica a una
-- persona tanto o más que el teléfono. Si esto no se actualiza, la fila queda
-- marcada como anonimizada con el domicilio adentro.
alter table vecinos drop constraint if exists vecino_anonimizado_sin_datos;
alter table vecinos add constraint vecino_anonimizado_sin_datos
  check (not anonimizado or (nombre is null and telefono is null
                             and barrio is null and direccion is null));

create or replace function app.anonimizar_vecino(vecino uuid) returns void
  language sql security definer set search_path = public, app
as $$
  update vecinos
     set nombre = null, telefono = null, barrio = null, direccion = null,
         anonimizado = true, anonimizado_en = now()
   where id = vecino and not anonimizado
$$;
