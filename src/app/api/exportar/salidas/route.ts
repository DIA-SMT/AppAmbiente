/**
 * Excel de las salidas de contenedores anotadas en los puntos, para cruzar con
 * el de la 9 de Julio. Solo coordinación; las políticas de la base vuelven a
 * filtrar igual.
 */
import { paraInputFechaHora } from '@/lib/formato'
import { hojaDeSalidasContenedor } from '@/lib/excel'
import { salidasDeContenedor } from '@/lib/salidasContenedor'
import { ErrorCuentaIncompleta, ErrorSinPermiso, ErrorSinSesion, exigirAdminCompleto } from '@/lib/sesion'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function respuestaDeError(mensaje: string, estado: number) {
  return new Response(`${mensaje}\n`, {
    status: estado,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** dd/mm/aaaa sin pasar por Date. */
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

export async function GET(pedido: Request) {
  let sesion
  try {
    sesion = await exigirAdminCompleto()
  } catch (e) {
    if (e instanceof ErrorCuentaIncompleta) {
      return respuestaDeError('Antes de exportar, terminá de configurar tu cuenta en «Mi cuenta».', 403)
    }
    if (e instanceof ErrorSinPermiso) return respuestaDeError('Las exportaciones son de la coordinación.', 403)
    if (e instanceof ErrorSinSesion) return respuestaDeError('Se cerró tu sesión. Entrá de nuevo y volvé a exportar.', 401)
    throw e
  }

  const p = new URL(pedido.url).searchParams
  const desde = p.get('desde') ?? ''
  const hasta = p.get('hasta') ?? ''
  const sitioId = p.get('sitioId') ?? ''
  if (desde && !ES_FECHA.test(desde)) return respuestaDeError('La fecha «desde» no es válida.', 400)
  if (hasta && !ES_FECHA.test(hasta)) return respuestaDeError('La fecha «hasta» no es válida.', 400)
  if (sitioId && !ES_UUID.test(sitioId)) return respuestaDeError('El punto pedido no es válido.', 400)
  const conAnuladas = p.get('anuladas') === '1'

  const { hayTabla, salidas } = await salidasDeContenedor(sesion, {
    desde: desde || undefined,
    hasta: hasta || undefined,
    sitioId: sitioId || undefined,
    conAnuladas,
    limite: 5000,
  })
  if (!hayTabla) return respuestaDeError('La base todavía no tiene las salidas de contenedores (falta la migración 0027).', 409)

  const rango = desde && hasta
    ? `Del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`
    : desde ? `Desde el ${fechaCorta(desde)}` : hasta ? `Hasta el ${fechaCorta(hasta)}` : undefined
  const filtros = [
    sitioId && salidas[0] ? `Punto: ${salidas[0].sitio_nombre}` : '',
    conAnuladas ? 'Incluye las anuladas' : 'Solo vigentes',
  ].filter(Boolean).join(' · ')

  const libro = hojaDeSalidasContenedor(salidas, {
    rango, filtros, generadoPor: sesion.nombre, generadoEn: new Date(),
  })
  const cuerpo = await libro.xlsx.writeBuffer()
  const hoy = paraInputFechaHora(new Date()).slice(0, 10)
  return new Response(new Uint8Array(cuerpo as ArrayBuffer), {
    headers: {
      'content-type': TIPO_XLSX,
      'content-disposition': `attachment; filename="salidas-de-contenedores-${hoy}.xlsx"`,
      'cache-control': 'no-store',
    },
  })
}
