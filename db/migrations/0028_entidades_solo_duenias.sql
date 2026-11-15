-- ═══════════════════════════════════════════════════════════════════════
-- 0028 · Entidades que sólo dicen de quién es un vehículo o una persona
--
-- Hasta ahora una entidad tenía que servir como origen o como destino de
-- material (entidad_sirve_para_algo). Pero la lista de entidades es también la
-- de «Pertenece a» en Vehículos y en Personas, y ahí hacen falta empresas que
-- no traen ni se llevan nada:
--
--   · Transporte 9 de Julio, dueña de los camiones que recambian contenedores.
--     El material no viene «de» la 9 de Julio: viene del punto verde.
--   · Benja, la empresa de los vigiladores de los puntos.
--
-- Con la restricción, la única forma de cargarlas era marcarlas como origen o
-- destino, y entonces aparecían en los formularios del celular como si alguien
-- pudiera traerles o llevarles material. Una entidad sin ninguna de las dos
-- casillas no aparece en ningún formulario de movimientos (las listas del
-- celular filtran por habilitada_origen y habilitada_destino) y sí en
-- «Pertenece a».
-- ═══════════════════════════════════════════════════════════════════════

alter table entidades drop constraint if exists entidad_sirve_para_algo;

comment on column entidades.habilitada_origen is
  'Se ofrece como origen en los formularios. Sin origen ni destino, la entidad sólo sirve para decir de quién es un vehículo o una persona.';

-- Las dos que pidió la coordinación. Si ya existen con ese nombre, no se tocan.
insert into entidades (nombre, tipo, habilitada_origen, habilitada_destino, notas)
select x.nombre, 'empresa', false, false, x.notas
  from (values
    ('Transporte 9 de Julio', 'Empresa que recambia los contenedores de los puntos verdes.'),
    ('Benja', 'Empresa del servicio de vigiladores de los puntos verdes.')
  ) as x(nombre, notas)
 where not exists (select 1 from entidades e where lower(e.nombre) = lower(x.nombre));
