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
 * Borra de verdad, que es lo único que se borra en este sistema, y sólo a los
 * que nunca cargaron nada: al que dejó algo a su nombre lo desactiva, que corta
 * el acceso igual sin perder quién hizo qué. El archivo hace las dos cosas y
 * avisa cuál aplicó.
 *
 * Quién entra en cada grupo no lo decide este archivo: lo decide la base, con
 * app.rastro_de_perfil() y app.eliminar_perfil() de la 0022. Antes acá había una
 * lista propia de seis `exists`, y al quedarse corta —no miraba vecinos,
 * entidades, importaciones ni los controles de pila de proceso— podía mandar al
 * DELETE a alguien que la base sí retiene: las cuatro claves foráneas que están
 * en `on delete set null` lo habrían dejado pasar perdiendo en silencio quién
 * cargó esos vecinos.
 */
import '../entorno'
import { exigirConfirmacionSiEsRemota } from './guarda'
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
--   hizo qué. Quién cae en cada grupo lo decide la base, no este archivo. Al
--   final devuelve la lista de lo que quedó.
--
-- CÓMO SE USA
--   Supabase → SQL Editor → New query → pegar todo esto → Run.
--   Antes tiene que estar aplicada la migración 0022 (db/actualizacion.sql).
-- ${'═'.repeat(71)}

do $guardian$
begin
  if to_regprocedure('app.rastro_de_perfil(uuid)') is null then
    raise exception 'Falta la migración 0022. Aplicá db/actualizacion.sql antes que este archivo.';
  end if;
end
$guardian$;

-- Las dos funciones de la 0022 sólo le contestan a una sesión de coordinación, y
-- un editor SQL no tiene ninguna. Presentarse como la cuenta que va a quedar no
-- es un rodeo: es la que va a figurar como autora de estas bajas en la auditoría.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id from perfiles where lower(usuario) = ${literal(quedan[0].toLowerCase())}),
    'rol', 'admin'
  )::text,
  false);

do $limpieza$
declare
  p record;
  borrados     int := 0;
  desactivados int := 0;
begin
  for p in
    select id, usuario
      from perfiles
     where lower(usuario) <> all (array[${quedan.map((u) => literal(u.toLowerCase())).join(', ')}])
     order by usuario
  loop
    -- Lo que retiene a un usuario lo cuenta la base sobre las once tablas y la
    -- auditoría. Repetir la cuenta acá fue el error de la versión anterior.
    if app.rastro_de_perfil(p.id) is not null then
      update perfiles set activo = false where id = p.id and activo;
      desactivados := desactivados + 1;
    else
      perform app.eliminar_perfil(p.id);
      borrados := borrados + 1;
    end if;
  end loop;

  if borrados + desactivados = 0 then
    raise notice 'No hay usuarios de más: no se tocó nada.';
    return;
  end if;

  raise notice 'Usuarios desactivados por tener algo cargado a su nombre: %', desactivados;
  raise notice 'Usuarios borrados: %', borrados;
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

-- Y devolver la sesión a como estaba, que la de arriba era prestada.
select set_config('request.jwt.claims', '', false);

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
  exigirConfirmacionSiEsRemota({
    variable: 'CONFIRMO_USUARIOS',
    que: 'Esto desactiva los usuarios que dejaron rastro y elimina los que no dejaron ninguno.',
    comando: 'npm run db:usuarios',
  })
  principal()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`\n  ${(e as Error).message}\n`)
      process.exit(1)
    })
}
