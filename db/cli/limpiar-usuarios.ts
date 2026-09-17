/**
 * Escribe el SQL que deja la tabla de usuarios como la quiere db/datos-base.ts.
 *
 *     npm run db:usuarios
 *
 * Está para una base que ya se creó con la siembra vieja —once usuarios, diez
 * de ellos con la clave puesta en el repositorio— y hay que dejar sólo la
 * puerta de la Dirección de IA, para que desde ahí se creen por pantalla la
 * cuenta de coordinación y los usuarios de cada punto.
 *
 * Borra de verdad, que es lo único que se borra en este sistema, y sólo puede
 * hacerlo porque son usuarios que nunca cargaron nada: si alguno tiene un
 * movimiento, un conteo o un pedido a su nombre, la base lo rechaza —las claves
 * foráneas están en `on delete restrict`— y entonces lo que corresponde es
 * desactivarlo, no borrarlo. El archivo hace las dos cosas y avisa cuál aplicó.
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { USUARIOS } from '../datos-base'

const SALIDA = path.join(process.cwd(), 'db', 'usuarios.sql')

const literal = (s: string) => `'${s.replaceAll("'", "''")}'`

export function construirLimpieza(): string {
  const quedan = USUARIOS.map((u) => u[0])

  return `-- ${'═'.repeat(71)}
-- Registro y trazabilidad de residuos · San Miguel de Tucumán
--
-- Deja un solo usuario: ${quedan.join(', ')}.
-- Generado por \`npm run db:usuarios\`. No editar a mano.
--
-- POR QUÉ
--   La primera siembra creaba once usuarios, y diez tenían la clave escrita en
--   un repositorio público (coordinacion/ambiente2026, planta y pv01..pv08 con
--   PIN 1234). Una base que se entrega tiene que tener una sola puerta: desde
--   ahí se crean las demás por pantalla, con claves que elige quien las usa.
--
-- QUÉ HACE
--   A los usuarios que sobran los BORRA si nunca cargaron nada, y si cargaron
--   algo los DESACTIVA, que corta el acceso igual sin perder el rastro de quién
--   hizo qué. Al final devuelve la lista de lo que quedó.
--
-- CÓMO SE USA
--   Supabase → SQL Editor → New query → pegar todo esto → Run.
-- ${'═'.repeat(71)}

do $limpieza$
declare
  sobran uuid[];
  con_rastro uuid[];
begin
  select coalesce(array_agg(id), '{}')
    into sobran
    from perfiles
   where lower(usuario) <> all (array[${quedan.map((u) => literal(u.toLowerCase())).join(', ')}]);

  if array_length(sobran, 1) is null then
    raise notice 'No hay usuarios de más: no se tocó nada.';
    return;
  end if;

  -- Los que dejaron algo cargado no se pueden borrar sin romper la trazabilidad.
  select coalesce(array_agg(distinct p.id), '{}')
    into con_rastro
    from perfiles p
   where p.id = any (sobran)
     and (
       exists (select 1 from movimientos      x where x.cargado_por_id    = p.id)
       or exists (select 1 from movimientos      x where x.anulado_por_id = p.id)
       or exists (select 1 from pila_controles   x where x.registrado_por_id = p.id)
       or exists (select 1 from conteos_diarios  x where x.cargado_por_id = p.id)
       or exists (select 1 from pedidos_recambio x where x.pedido_por_id  = p.id)
       or exists (select 1 from pedidos_recambio x where x.avisado_por_id = p.id)
     );

  update perfiles set activo = false
   where id = any (con_rastro) and activo;

  delete from perfiles
   where id = any (sobran)
     and not (id = any (con_rastro));

  raise notice 'Usuarios desactivados por tener movimientos a su nombre: %',
    coalesce(array_length(con_rastro, 1), 0);
  raise notice 'Usuarios borrados: %',
    coalesce(array_length(sobran, 1), 0) - coalesce(array_length(con_rastro, 1), 0);
end
$limpieza$;

-- Que haya quedado al menos la puerta de entrada.
do $control$
declare
  n bigint;
begin
  select count(*) into n from perfiles where rol = 'admin' and activo;
  if n = 0 then
    raise exception 'Quedaría la base sin ninguna cuenta de coordinación activa. No se aplica nada.';
  end if;
end
$control$;

-- Lo que quedó. Esta es la tabla que devuelve el editor.
select usuario,
       case rol when 'admin' then 'Coordinación' else 'Punto' end as tipo,
       case when activo then 'activo' else 'desactivado' end as estado
  from perfiles
 order by rol, usuario;
`
}

async function principal() {
  const texto = construirLimpieza()

  // Contra un Postgres en memoria, para no entregar SQL sin probar. Se arma la
  // base vieja —once usuarios— y se comprueba que quede uno.
  const { PGlite } = await import('@electric-sql/pglite')
  const { readdirSync, readFileSync } = await import('node:fs')
  const carpeta = path.join(process.cwd(), 'db', 'migrations')

  const pg = await PGlite.create()
  try {
    for (const f of readdirSync(carpeta).filter((x) => x.endsWith('.sql')).sort()) {
      await pg.exec(readFileSync(path.join(carpeta, f), 'utf8'))
    }
    await pg.exec(`
      insert into sitios (codigo, nombre, tipo) values ('PVRV', 'Planta', 'planta');
      insert into perfiles (usuario, nombre, rol, credencial_hash) values
        ('direccionia', 'Dirección de IA', 'admin', 'x'),
        ('coordinacion', 'Coordinación', 'admin', 'x');
      insert into perfiles (usuario, nombre, rol, sitio_id, credencial_hash)
        select 'planta', 'Planta — turno', 'vigilador', id, 'x' from sitios where codigo = 'PVRV';
      insert into perfiles (usuario, nombre, rol, sitio_id, credencial_hash)
        select 'pv01', 'PV-01 — turno', 'vigilador', id, 'x' from sitios where codigo = 'PVRV';
      -- Y uno que ya cargó algo: ése no se puede borrar, se desactiva.
      insert into movimientos (flujo, tipo, sitio_id, origen_clase, origen_detalle,
                               destino_clase, destino_sitio_id, cargado_por_id)
        select 'planta', 'ingreso', s.id, 'texto', 'x', 'sitio', s.id, p.id
          from sitios s, perfiles p where s.codigo = 'PVRV' and p.usuario = 'pv01';
    `)
    await pg.exec(texto)

    const r = (await pg.query(
      `select usuario, activo from perfiles order by usuario`,
    )) as { rows: Array<{ usuario: string; activo: boolean }> }

    const quedaron = r.rows.map((f) => `${f.usuario}${f.activo ? '' : ' (desactivado)'}`)
    const activos = r.rows.filter((f) => f.activo).map((f) => f.usuario)

    if (activos.length !== 1 || activos[0] !== 'direccionia') {
      throw new Error(`Probándolo quedaron activos: ${activos.join(', ')}. No escribo el archivo.`)
    }
    if (!quedaron.includes('pv01 (desactivado)')) {
      throw new Error('El usuario con movimientos a su nombre tendría que quedar desactivado, no borrado.')
    }

    writeFileSync(SALIDA, texto, 'utf8')
    console.log(`
  Probado sobre una base con los once usuarios viejos. Quedó:
    ${quedaron.join('\n    ')}

  Escrito en db/usuarios.sql.
  Supabase → SQL Editor → New query → pegar el archivo entero → Run.
`)
  } finally {
    await pg.close()
  }
}

const esEntrada = process.argv[1]?.replace(/\\/g, '/').endsWith('db/cli/limpiar-usuarios.ts')
if (esEntrada) {
  principal()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`\n  ${(e as Error).message}\n`)
      process.exit(1)
    })
}
