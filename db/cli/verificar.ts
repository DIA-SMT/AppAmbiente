/**
 * Comprueba que las políticas de seguridad hagan lo que dicen.
 *
 *     npm run db:verificar
 *
 * No es un test unitario: es la prueba de que el modelo de permisos se cumple
 * en la base y no depende de que ninguna pantalla se acuerde de filtrar. Vale
 * la pena correrlo después de tocar db/migrations/0010_rls.sql y antes de
 * desplegar a Supabase, donde las mismas políticas se evalúan igual.
 */
import { comoServicio, conSesion, type Sesion } from '../sesion'
import { obtenerBase, describirMotor } from '../client'

let pasaron = 0
let fallaron = 0

function revisar(descripcion: string, condicion: boolean, detalle = '') {
  if (condicion) {
    pasaron++
    console.log(`  ✓ ${descripcion}`)
  } else {
    fallaron++
    console.log(`  ✗ ${descripcion}${detalle ? `  → ${detalle}` : ''}`)
  }
}

/** Corre una consulta esperando que la base la rechace. */
async function debeFallar(descripcion: string, sesion: Sesion, sql: string, params: unknown[] = []) {
  try {
    await conSesion(sesion, (tx) => tx.consultar(sql, params))
    revisar(descripcion, false, 'la consulta pasó y no debería')
  } catch (e) {
    revisar(descripcion, true, (e as Error).message.slice(0, 60))
  }
}

async function contar(sesion: Sesion, sql: string, params: unknown[] = []): Promise<number> {
  const filas = await conSesion(sesion, (tx) => tx.consultar<{ c: string }>(sql, params))
  return Number(filas[0]?.c ?? 0)
}

async function main() {
  console.log(`\n  Verificación de permisos · ${describirMotor()}\n`)

  const perfiles = await comoServicio((tx) =>
    tx.consultar<{ id: string; usuario: string; rol: 'admin' | 'vigilador'; sitio_id: string | null; nombre: string }>(
      `select id, usuario, rol, sitio_id, nombre from perfiles
        where usuario in ('coordinacion', 'planta', 'pv02')`,
    ),
  )
  const buscar = (u: string) => {
    const p = perfiles.find((x) => x.usuario === u)
    if (!p) throw new Error(`Falta el usuario ${u}. Correr: npm run db:sembrar`)
    return { perfilId: p.id, rol: p.rol, sitioId: p.sitio_id, nombre: p.nombre } satisfies Sesion
  }

  const admin = buscar('coordinacion')
  const planta = buscar('planta')
  const otroPunto = buscar('pv02')

  console.log('  Lectura de movimientos')
  const totalAdmin = await contar(admin, 'select count(*) c from movimientos')
  const desdeOtroPunto = await contar(otroPunto, 'select count(*) c from movimientos')
  revisar('la coordinadora ve los movimientos', totalAdmin > 0, `ve ${totalAdmin}`)
  revisar('un vigilador no ve movimientos de otro sitio', desdeOtroPunto === 0, `ve ${desdeOtroPunto}`)

  console.log('\n  Datos personales')
  const entidadesAdmin = await contar(admin, 'select count(*) c from entidades')
  const entidadesVig = await contar(planta, 'select count(*) c from entidades')
  const publicasVig = await contar(planta, 'select count(*) c from entidades_publicas')
  revisar('la coordinadora lee la tabla entidades (con CUIT y teléfono)', entidadesAdmin > 0)
  revisar('el vigilador no lee la tabla entidades', entidadesVig === 0, `lee ${entidadesVig}`)
  revisar('el vigilador sí lee la vista sin datos de contacto', publicasVig > 0, `lee ${publicasVig}`)

  const vecinosVig = await contar(planta, 'select count(*) c from vecinos')
  revisar('el vigilador no lee vecinos', vecinosVig === 0, `lee ${vecinosVig}`)

  const auditoriaVig = await contar(planta, 'select count(*) c from auditoria')
  revisar('el vigilador no lee la auditoría', auditoriaVig === 0, `lee ${auditoriaVig}`)

  console.log('\n  Escritura')
  await debeFallar('nadie puede borrar un movimiento (ni la coordinadora)', admin, 'delete from movimientos')
  await debeFallar(
    'un vigilador no puede cargar en otro sitio',
    otroPunto,
    `insert into movimientos (flujo, tipo, sitio_id, origen_clase, origen_detalle,
                              destino_clase, destino_sitio_id, cargado_por_id)
     values ('planta', 'ingreso', (select id from sitios where codigo = 'PLANTA'),
             'texto', 'prueba', 'sitio', (select id from sitios where codigo = 'PLANTA'), $1)`,
    [otroPunto.perfilId],
  )
  await debeFallar(
    'un vigilador no puede cargar a nombre de otro',
    planta,
    `insert into movimientos (flujo, tipo, sitio_id, origen_clase, origen_detalle,
                              destino_clase, destino_sitio_id, cargado_por_id)
     values ('planta', 'ingreso', $1, 'texto', 'prueba', 'sitio', $1, $2)`,
    [planta.sitioId, admin.perfilId],
  )
  // Una UPDATE que no alcanza ninguna fila no da error: simplemente no cambia
  // nada. Lo que hay que verificar es el efecto, no la excepción.
  await conSesion(planta, (tx) => tx.consultar(`update materiales set nombre = 'alterado'`))
  const alterados = await contar(admin, `select count(*) c from materiales where nombre = 'alterado'`)
  revisar('un vigilador no puede editar las listas maestras', alterados === 0, `${alterados} alterados`)
  await debeFallar(
    'un vigilador no puede cargar un movimiento de hace una semana',
    planta,
    `insert into movimientos (flujo, tipo, sitio_id, ocurrido_en, origen_clase, origen_detalle,
                              destino_clase, destino_sitio_id, cargado_por_id)
     values ('planta', 'ingreso', $1, now() - interval '7 days', 'texto', 'prueba',
             'sitio', $1, $2)`,
    [planta.sitioId, planta.perfilId],
  )

  console.log('\n  Auditoría')
  const antes = await contar(admin, 'select count(*) c from auditoria')
  await conSesion(planta, async (tx) => {
    const [mov] = await tx.consultar<{ id: string }>(
      `insert into movimientos (flujo, tipo, sitio_id, origen_clase, origen_detalle,
                                destino_clase, destino_sitio_id, cargado_por_id, observaciones)
       values ('planta', 'ingreso', $1, 'texto', 'Prueba de verificación', 'sitio', $1, $2,
               'Generado por db:verificar')
       returning id`,
      [planta.sitioId, planta.perfilId],
    )
    // Con su material, para que en los listados no aparezca como un movimiento roto.
    await tx.consultar(
      `insert into movimiento_items (movimiento_id, material_id, cantidad, unidad_id)
       select $1, m.id, 1, m.unidad_default_id
         from materiales m
        where m.activo and 'planta' = any(m.flujos) and 'ingreso' = any(m.tipos)
        order by m.orden limit 1`,
      [mov.id],
    )
  })
  const despues = await contar(admin, 'select count(*) c from auditoria')
  revisar('cargar un movimiento deja rastro en la auditoría', despues > antes, `${antes} → ${despues}`)

  const conActor = await contar(
    admin,
    `select count(*) c from auditoria where tabla = 'movimientos' and actor_id = $1`,
    [planta.perfilId],
  )
  revisar('la auditoría guarda quién lo cargó', conActor > 0)

  // El movimiento de prueba queda anulado, no borrado: en este sistema no se borra.
  await conSesion(admin, (tx) =>
    tx.consultar(
      `update movimientos
          set estado = 'anulado', motivo_anulacion = 'Movimiento de prueba de db:verificar',
              anulado_por_id = $1, anulado_en = now()
        where observaciones = 'Generado por db:verificar' and estado = 'vigente'`,
      [admin.perfilId],
    ),
  )

  console.log(`\n  ${pasaron} bien · ${fallaron} mal\n`)
  await (await obtenerBase()).cerrar()
  process.exit(fallaron === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
