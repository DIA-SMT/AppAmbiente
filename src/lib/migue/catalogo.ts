/**
 * El catálogo que se lee al abrir cada conversación y queda congelado con ella.
 *
 * Es la mitad de «que se enriquezca con lo que vayan cargando» que no necesita
 * a nadie: el día que la coordinación da de alta un material o cambia la
 * dirección de un punto, la conversación siguiente ya lo sabe, sin tocar el
 * código ni reentrenar nada. La otra mitad —cómo le dice la gente a las cosas—
 * es el vocabulario aprobado, que también entra acá.
 *
 * Se lee con la sesión de quien pregunta, como todo lo de Migue. Los recuerdos
 * se filtran a mano además de por RLS: la coordinación puede LEER los de los
 * puntos (para verlos y olvidarlos), pero una conversación suya tiene que
 * recibir sólo los propios.
 */
import 'server-only'

import type { Conexion } from '@db/client'

import type { Catalogo, PuntoDeLaSesion, RolDeMigue } from './tipos'

export async function leerCatalogo(
  tx: Conexion,
  quien: { rol: RolDeMigue; perfilId: string; punto: PuntoDeLaSesion | null },
): Promise<Catalogo> {
  const puntos = await tx.consultar<{
    codigo: string
    nombre: string
    direccion: string | null
    tipo: 'planta' | 'punto_verde'
    carga_detallada: boolean
  }>(
    `select codigo, nombre, direccion, tipo, carga_detallada
       from sitios where activo order by orden, codigo`,
  )

  const materiales = await tx.consultar<{
    nombre: string
    categoria: string
    flujos: string[]
    tipos: string[]
    unidad: string | null
  }>(
    `select m.nombre, m.categoria, m.flujos, m.tipos, u.codigo as unidad
       from materiales m left join unidades u on u.id = m.unidad_default_id
      where m.activo order by m.orden, m.nombre`,
  )

  const recipientes = await tx.consultar<{ codigo: string; nombre: string; factor_m3: string | number | null }>(
    `select codigo, nombre, factor_m3 from unidades where activo order by orden, codigo`,
  )

  // Para el vigilador, RLS ya deja sólo las de su predio.
  const pilas = await tx.consultar<{ codigo: string }>(
    `select codigo from pilas where activo order by codigo`,
  )

  // Una expresión aprobada entra sólo si lo que nombra sigue existiendo. Es la
  // segunda baranda contra una frase que alguien haya querido colar como regla
  // —la primera es que la aprobó una persona—: la referencia tiene que ser un
  // punto, un material o un recipiente del catálogo de hoy, o ser de tipo 'otro'.
  const expresiones = await tx.consultar<{ expresion: string; significado: string; tipo: string; referencia: string }>(
    `select expresion, significado, tipo, referencia
       from migue_expresiones where estado = 'aprobada'
      order by veces desc, expresion
      limit 150`,
  )
  const existe = (tipo: string, referencia: string) =>
    tipo === 'otro' ||
    (tipo === 'punto' && puntos.some((p) => p.codigo === referencia)) ||
    (tipo === 'material' && materiales.some((m) => m.nombre.toLowerCase() === referencia.toLowerCase())) ||
    (tipo === 'recipiente' && recipientes.some((r) => r.codigo === referencia || r.nombre === referencia))

  const recuerdos =
    quien.rol === 'admin'
      ? await tx.consultar<{ id: string; texto: string }>(
          `select id, texto from migue_recuerdos
            where olvidado_en is null and perfil_id = $1 order by creado_en`,
          [quien.perfilId],
        )
      : quien.punto
        ? await tx.consultar<{ id: string; texto: string }>(
            `select id, texto from migue_recuerdos
              where olvidado_en is null and sitio_id = $1 order by creado_en`,
            [quien.punto.id],
          )
        : []

  return {
    puntos: puntos.map((p) => ({
      codigo: p.codigo,
      nombre: p.nombre,
      direccion: p.direccion ?? '',
      tipo: p.tipo,
      cargaDetallada: p.carga_detallada,
    })),
    materiales: materiales.map((m) => ({
      nombre: m.nombre,
      categoria: m.categoria,
      flujos: m.flujos ?? [],
      tipos: m.tipos ?? [],
      unidad: m.unidad ?? 'm3',
    })),
    recipientes: recipientes.map((r) => ({
      codigo: r.codigo,
      nombre: r.nombre,
      factorM3: r.factor_m3 === null ? null : Number(r.factor_m3),
    })),
    pilas: pilas.map((p) => p.codigo),
    expresionesAprobadas: expresiones.filter((e) => existe(e.tipo, e.referencia)),
    recuerdos,
  }
}
