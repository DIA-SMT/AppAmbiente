/**
 * Verificación de credenciales.
 *
 * Corre como servicio porque hay que leer el perfil antes de que exista
 * sesión: es la única lectura del sistema que no pasa por las políticas.
 *
 * El PIN es corto porque se teclea en la calle. Lo que compensa esa debilidad
 * es el bloqueo por intentos: cinco fallos seguidos y el usuario del sitio
 * queda trabado cinco minutos. Sin eso, cuatro dígitos se prueban a mano.
 */
import 'server-only'
import { comoServicio } from '@db/sesion'
import { verificarCredencial } from '@db/credenciales'

const INTENTOS_MAXIMOS = 5
const MINUTOS_BLOQUEO = 5

export interface PerfilAutenticado {
  id: string
  usuario: string
  nombre: string
  rol: 'admin' | 'vigilador'
  sitio_id: string | null
  sesion_horas: number | null
}

export type ResultadoAcceso =
  | { ok: true; perfil: PerfilAutenticado }
  | { ok: false; motivo: 'credenciales' | 'bloqueado' | 'inactivo'; minutos?: number }

export async function verificarAcceso(usuario: string, credencial: string): Promise<ResultadoAcceso> {
  const limpio = usuario.trim().toLowerCase()
  if (!limpio || !credencial) return { ok: false, motivo: 'credenciales' }

  return comoServicio(async (tx) => {
    const filas = await tx.consultar<{
      id: string; usuario: string; nombre: string; rol: 'admin' | 'vigilador'
      sitio_id: string | null; sesion_horas: number | null
      credencial_hash: string; activo: boolean
      intentos_fallidos: number; bloqueado_hasta: string | null
    }>(
      `select id, usuario, nombre, rol, sitio_id, sesion_horas, credencial_hash,
              activo, intentos_fallidos, bloqueado_hasta
         from perfiles where lower(usuario) = $1`,
      [limpio],
    )

    const p = filas[0]
    // Se gasta el mismo tiempo aunque el usuario no exista, para que no se
    // pueda averiguar qué usuarios hay probando cuál responde más rápido.
    const hash = p?.credencial_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA'
    const coincide = verificarCredencial(credencial, hash)

    if (!p) return { ok: false as const, motivo: 'credenciales' as const }
    if (!p.activo) return { ok: false as const, motivo: 'inactivo' as const }

    if (p.bloqueado_hasta && new Date(p.bloqueado_hasta) > new Date()) {
      const minutos = Math.max(1, Math.ceil((new Date(p.bloqueado_hasta).getTime() - Date.now()) / 60000))
      return { ok: false as const, motivo: 'bloqueado' as const, minutos }
    }

    if (!coincide) {
      const intentos = p.intentos_fallidos + 1
      await tx.consultar(
        // Los tipos van escritos. Sin los casts, Postgres tiene que deducir el
        // de $2 dos veces —en la asignación y en la comparación— y saca dos
        // distintos: «inconsistent types deduced for parameter $2, text versus
        // integer». Reventaba el ingreso entero, y sólo en el camino de la
        // credencial equivocada, que es el que nadie prueba.
        `update perfiles
            set intentos_fallidos = $2::int,
                bloqueado_hasta = case when $2::int >= $3::int
                                       then now() + make_interval(mins => $4::int)
                                       else null end
          where id = $1`,
        [p.id, intentos, INTENTOS_MAXIMOS, MINUTOS_BLOQUEO],
      )
      if (intentos >= INTENTOS_MAXIMOS) {
        return { ok: false as const, motivo: 'bloqueado' as const, minutos: MINUTOS_BLOQUEO }
      }
      return { ok: false as const, motivo: 'credenciales' as const }
    }

    await tx.consultar(
      `update perfiles set intentos_fallidos = 0, bloqueado_hasta = null, ultimo_acceso = now() where id = $1`,
      [p.id],
    )

    return {
      ok: true as const,
      perfil: {
        id: p.id, usuario: p.usuario, nombre: p.nombre, rol: p.rol,
        sitio_id: p.sitio_id, sesion_horas: p.sesion_horas,
      },
    }
  })
}

/** Los sitios que se ofrecen en la pantalla de ingreso, con su usuario. */
export async function sitiosParaIngreso() {
  return comoServicio((tx) =>
    tx.consultar<{ usuario: string; sitio_nombre: string; sitio_tipo: string; orden: number }>(
      `select p.usuario, s.nombre as sitio_nombre, s.tipo as sitio_tipo, s.orden
         from perfiles p join sitios s on s.id = p.sitio_id
        where p.rol = 'vigilador' and p.activo and s.activo
        order by s.orden`,
    ),
  )
}
