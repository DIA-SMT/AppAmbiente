import { Fragment } from 'react'
import { numero } from '@/lib/formato'
import estilos from './GraficoVecinos.module.css'

export interface PuntoGrafico {
  id: string
  codigo: string
  nombre: string
  visitas: number
  sinDatos: number
  identificados: number
}

const ANCHO = 780
const ALTO = 300
const MARGEN = { arriba: 24, derecha: 16, abajo: 44, izquierda: 54 }

const ANCHO_TRAMA = ANCHO - MARGEN.izquierda - MARGEN.derecha
const ALTO_TRAMA = ALTO - MARGEN.arriba - MARGEN.abajo

/**
 * Marcas del eje Y en valores redondos que el gráfico efectivamente alcanza:
 * el paso más fino que no pase de tres intervalos. Acá se cuenta gente, así que
 * los pasos son enteros — media visita no existe.
 */
function marcasDelEje(maximo: number): number[] {
  const exponente = Math.floor(Math.log10(maximo))
  const pasos: number[] = []
  for (let e = 0; e <= exponente + 1; e++) for (const m of [1, 2, 5]) pasos.push(m * 10 ** e)
  pasos.sort((a, b) => a - b)

  const paso = pasos.find((p) => Math.floor(maximo / p) <= 3) ?? maximo
  const marcas: number[] = []
  for (let v = 0; v <= maximo; v += paso) marcas.push(v)
  return marcas
}

/**
 * Una barra por punto, partida en las visitas que dejaron datos y las que no.
 *
 * La barra entera son visitas: esas dos partes sí suman. Los vecinos
 * identificados son personas, no visitas, y por eso no se apilan acá — irían
 * en otra unidad y la altura dejaría de querer decir algo. Van en la etiqueta
 * de cada barra y en la tabla de abajo.
 */
export default function GraficoVecinos({
  puntos,
  periodo,
}: {
  puntos: PuntoGrafico[]
  periodo: string
}) {
  const maximo = Math.max(0, ...puntos.map((p) => p.visitas))

  if (!(maximo > 0)) {
    return (
      <div className="aviso atencion">
        En {periodo} todavía no se registró ningún ingreso de vecinos. Si algún punto estuvo
        abierto, revisá con el vigilador que esté cargando desde el celular.
      </div>
    )
  }

  // Un poco de aire arriba para que la barra más alta y su número no toquen el borde.
  const tope = maximo * 1.08
  const marcas = marcasDelEje(maximo)

  const y = (valor: number) => MARGEN.arriba + ALTO_TRAMA - (valor / tope) * ALTO_TRAMA
  const grupo = ANCHO_TRAMA / Math.max(puntos.length, 1)
  const anchoBarra = Math.max(8, Math.min(52, grupo * 0.56))

  return (
    <div className="pila">
      <svg
        className={estilos.marco}
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        role="img"
        aria-label={`Visitas por punto verde en ${periodo}, separando las que dejaron datos de las que no`}
      >
        <defs>
          <pattern
            id="trama-sin-datos"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" className={estilos.tramaFondo} />
            <line x1="0" y1="0" x2="0" y2="6" className={estilos.tramaLinea} />
          </pattern>
        </defs>

        {marcas.map((valor) => (
          <Fragment key={valor}>
            <line
              x1={MARGEN.izquierda}
              x2={ANCHO - MARGEN.derecha}
              y1={y(valor)}
              y2={y(valor)}
              className={valor === 0 ? estilos.base : estilos.grilla}
            />
            <text
              x={MARGEN.izquierda - 10}
              y={y(valor)}
              textAnchor="end"
              dominantBaseline="middle"
              className={estilos.rotuloValor}
            >
              {numero(valor)}
            </text>
          </Fragment>
        ))}

        {puntos.map((punto, i) => {
          const centro = MARGEN.izquierda + grupo * (i + 0.5)
          const x = centro - anchoBarra / 2
          // sin_datos son visitas, así que nunca puede pasarse del total; si la
          // base devolviera algo raro, la barra se recorta en vez de romperse.
          const sinDatos = Math.max(0, Math.min(punto.sinDatos, punto.visitas))
          const conDatos = punto.visitas - sinDatos
          const base = MARGEN.arriba + ALTO_TRAMA
          const altoTotal = (punto.visitas / tope) * ALTO_TRAMA
          const altoSinDatos = (sinDatos / tope) * ALTO_TRAMA
          const altoConDatos = altoTotal - altoSinDatos

          return (
            <Fragment key={punto.id}>
              {punto.visitas > 0 && (
                <g>
                  <title>
                    {`${punto.codigo} · ${punto.nombre}: ${numero(punto.visitas)} visitas en ${periodo}, `}
                    {`${numero(conDatos)} dejaron datos y ${numero(sinDatos)} no. `}
                    {`${numero(punto.identificados)} vecinos identificados.`}
                  </title>
                  {conDatos > 0 && (
                    <rect
                      x={x}
                      y={base - Math.max(2, altoConDatos)}
                      width={anchoBarra}
                      height={Math.max(2, altoConDatos)}
                      className={estilos.barraConDatos}
                    />
                  )}
                  {sinDatos > 0 && (
                    <rect
                      x={x}
                      y={base - altoTotal}
                      width={anchoBarra}
                      height={Math.max(2, altoSinDatos)}
                      fill="url(#trama-sin-datos)"
                    />
                  )}
                  <text x={centro} y={base - altoTotal - 8} textAnchor="middle" className={estilos.cifraBarra}>
                    {numero(punto.visitas)}
                  </text>
                </g>
              )}
              <text x={centro} y={ALTO - 22} textAnchor="middle" className={estilos.rotuloPunto}>
                {punto.codigo}
              </text>
            </Fragment>
          )
        })}
      </svg>

      <div className={`${estilos.leyenda} menor`}>
        <span className={estilos.clave}>
          <span className={estilos.muestraSolida} /> Dejaron datos
        </span>
        <span className={estilos.clave}>
          <span className={estilos.muestraTrama} /> Sin datos
        </span>
        <span className="gris">
          Cada barra es el total de visitas del período. Los vecinos identificados se cuentan
          aparte: son personas, no visitas.
        </span>
      </div>
    </div>
  )
}
