import Link from 'next/link'
import { redirect } from 'next/navigation'
import { conSesion } from '@db/sesion'
import { listasDelFormularioEnTx } from '@/lib/datos'
import { ETIQUETA_DESTINO_CONTENEDOR, cantidad, fechaHora } from '@/lib/formato'
import { haySalidasDeContenedorEnTx, salidasDeContenedorEnTx } from '@/lib/salidasContenedor'
import { sesionActual } from '@/lib/sesion'
import type { SalidaContenedor } from '@/lib/tipos'
import FormularioSalida from './FormularioSalida'

export const dynamic = 'force-dynamic'

/** «Cartón 120 kg · Plástico 40 kg». */
function contenido(s: SalidaContenedor): string {
  return s.items
    .map((i) => `${i.material} ${cantidad(i.cantidad, {
      nombre: i.unidad, nombre_plural: i.unidad_plural, decimales: i.decimales,
    })}`)
    .join(' · ')
}

function destino(s: SalidaContenedor): string {
  return s.destino === 'otro' && s.destino_detalle
    ? s.destino_detalle
    : ETIQUETA_DESTINO_CONTENEDOR[s.destino] ?? s.destino
}

/**
 * El contenedor lleno que se lleva la 9 de Julio, anotado en el momento: a qué
 * hora, en qué camión, quién manejaba, qué llevaba de verdad y a dónde va.
 */
export default async function SalidaDeContenedor() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/ingresar')

  const datos = await conSesion(sesion, async (tx) => {
    if (!(await haySalidasDeContenedorEnTx(tx))) return null
    const [listas, recientes] = await Promise.all([
      listasDelFormularioEnTx(tx, sesion, 'punto_verde', 'salida'),
      // La política deja ver sólo las del propio punto.
      salidasDeContenedorEnTx(tx, { limite: 5 }),
    ])
    return { listas, recientes }
  })

  // Sin la 0027 la pantalla no tiene dónde guardar, y en la Planta no existe.
  if (!datos || datos.listas.sitio?.tipo !== 'punto_verde') redirect('/turno')

  const { listas, recientes } = datos

  return (
    <div className="pila">
      <div className="fila-entre">
        <h1>Se va un contenedor</h1>
        <Link href="/turno" className="boton fantasma chico">Volver</Link>
      </div>

      <p className="menor gris" style={{ margin: 0 }}>{listas.sitio.nombre}</p>

      <div className="aviso">
        Anotá el contenedor lleno que se lleva la 9 de Julio, con lo que tiene de verdad adentro.
        La coordinación lo cruza con lo que después informa la empresa.
      </div>

      <FormularioSalida
        sitioId={listas.sitio.id}
        materiales={listas.materiales}
        patentes={listas.vehiculos.map((v) => v.patente)}
      />

      {recientes.length > 0 && (
        <section className="pila-chica">
          <h2>Últimas anotadas</h2>
          <ul className="pila-chica" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {recientes.map((s) => (
              <li key={s.id} className="tarjeta-plana pila-chica" style={{ padding: 12 }}>
                <span className="fuerte cifras">{fechaHora(s.salio_en)} · {s.patente}</span>
                <span className="menor">{contenido(s)}</span>
                <span className="menor gris">
                  A {destino(s)}{s.chofer ? ` · chofer ${s.chofer}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
