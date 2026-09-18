-- ═══════════════════════════════════════════════════════════════════════
-- 0021 · Que el mismo archivo no entre dos veces
--
-- La pantalla ya revisa, antes de confirmar, que no haya otra importación
-- confirmada con el mismo hash ni con un período que se pise. Pero ese chequeo
-- es un select común adentro de una transacción READ COMMITTED: dos personas
-- confirmando el mismo archivo al mismo tiempo —dos pestañas, dos admins— no se
-- ven entre ellas y pasan las dos. Como acá no se borra nada, el resultado son
-- los kilos del mes contados dos veces para siempre; lo único que se puede
-- hacer después es revertir la importación entera.
--
-- Contra eso no sirve mirar antes: tiene que fallar el insert. Un índice único
-- parcial hace exactamente eso, y sólo entre las confirmadas, que son las que
-- cuentan en el cruce: una importación revertida puede quedar con el mismo hash
-- que la que la reemplazó, y tiene que poder.
-- ═══════════════════════════════════════════════════════════════════════

-- Si esto falla en una base en uso es porque ya hay dos confirmadas con el
-- mismo archivo, o sea que el problema ya pasó. Se avisa con el hash a la
-- vista, porque decidir cuál de las dos se revierte no lo puede hacer una
-- migración: los kilos son de alguien.
do $repetidos$
declare
  h text;
begin
  select archivo_hash into h
    from importaciones
   where estado = 'confirmada' and archivo_hash is not null
   group by archivo_hash having count(*) > 1
   limit 1;
  if h is not null then
    raise exception
      'Hay más de una importación confirmada con el archivo % . Revertí las que sobran desde la pantalla Importar y volvé a correr esta migración.', h;
  end if;
end
$repetidos$;

create unique index importaciones_hash_confirmado_idx
  on importaciones (archivo_hash)
  where estado = 'confirmada' and archivo_hash is not null;

-- El aviso de período repetido pregunta por los rangos que se tocan contra
-- todas las confirmadas, en cada confirmación. Son pocas filas hoy, pero la
-- consulta se hace adentro de la transacción que después escribe las 287 filas.
create index importaciones_periodo_confirmado_idx
  on importaciones (periodo_desde, periodo_hasta)
  where estado = 'confirmada';

comment on index importaciones_hash_confirmado_idx is
  'El portero de verdad contra el archivo repetido: el chequeo de la app no ve las confirmaciones simultáneas.';
