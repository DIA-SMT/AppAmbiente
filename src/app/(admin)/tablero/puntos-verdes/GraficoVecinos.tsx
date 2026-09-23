import { Fragment, type CSSProperties } from 'react'
import { numero } from '@/lib/formato'
import estilos from './GraficoVecinos.module.css'

export interface PuntoGrafico {
  id: string
  codigo: string
  nombre: string
  visitas: number
  sinDatos: number
  identificados: number
  /** Parte de las visitas que viene de un conteo diario, sin saber quién vino. */
  contadas: number
  /** El punto no puede usar el celular en la jornada: todo lo suyo es conteo. */
  soloConteo: boolean
}

/**
 * La geometría del dibujo, en unidades del viewBox.
 *
 * El gráfico se dibuja dos veces, con dos geometrías, y CSS muestra una sola.
 * Un SVG con viewBox se escala entero y la letra viaja con el dibujo: en un
 * celular la tarjeta deja unos 324 px útiles, así que el trazado de 780 se
 * achica a 0,41 y «PV-01» y los números arriba de cada barra terminan dibujados
 * en 5 px. No hay unidad de CSS que lo compense —lo que habría que compensar es
 * el ancho del contenedor, que es justamente lo que fija la escala—, así que la
 * única salida sin JavaScript es tener un trazado pensado para el ancho chico.
 * El angosto crece con la cantidad de puntos, para que los códigos no se pisen,
 * y lleva un tope de ancho en el módulo.
 */
interface Trazado {
  ancho: number
  alto: number
  margen: { arriba: number; derecha: number; abajo: number; izquierda: number }
  clase: string
  /** Los patrones viven en <defs> y su id tiene que ser único en la página. */
  sufijo: string
}

const PANEL = (): Trazado => ({
  ancho: 780,
  alto: 300,
  margen: { arriba: 24, derecha: 16, abajo: 44, izquierda: 54 },
  clase: 'marcoAncho',
  sufijo: 'ancho',
})

// 40 unidades por punto es lo que ocupa «PV-01» en la letra del trazado
// angosto: menos que eso y los códigos del eje se montan uno sobre otro.
const CELULAR = (puntos: number): Trazado => ({
  ancho: Math.max(340, 58 + puntos * 40),
  alto: 250,
  margen: { arriba: 20, derecha: 8, abajo: 38, izquierda: 50 },
  clase: 'marcoAngosto',
  sufijo: 'angosto',
})

// La parte contada en papel va con su propia trama y con el borde punteado. El
// estilo va en línea y no en el módulo porque el módulo no es de esta tarea;
// el color sale de las variables igual que el resto del gráfico.
const bordeConteo: CSSProperties = {
  fill: 'none',
  stroke: 'var(--celeste)',
  strokeWidth: 1.5,
  strokeDasharray: '5 3',
}
const fondoConteo: CSSProperties = { fill: 'var(--celeste)', opacity: .16 }
const puntoConteo: CSSProperties = { fill: 'var(--celeste)', opacity: .9 }

const muestraConteo: CSSProperties = {
  width: 13,
  height: 13,
  borderRadius: 3,
  flex: '0 0 auto',
  border: '1.5px dashed var(--celeste)',
  background:
    'radial-gradient(circle at 50% 50%, var(--celeste) 0 1.6px, transparent 1.7px) 0 0 / 5px 5px,'
    + ' color-mix(in srgb, var(--celeste) 16%, transparent)',
}

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
 * Una barra por punto, partida en de dónde salió cada visita.
 *
 * La barra entera son visitas: las tres partes sí suman. Lo que no es
 * comparable entre puntos es la parte contada en papel —se sabe cuántos
 * vinieron, no quiénes—, y por eso va con trama de puntos y borde punteado: un
 * punto que solo cuenta tiene toda su barra así, y no se lo puede leer al lado
 * de los demás como si midieran lo mismo.
 *
 * Los vecinos identificados son personas, no visitas, y no se apilan acá: irían
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
  const hayConteo = puntos.some((p) => p.contadas > 0)

  if (!(maximo > 0)) {
    return (
      <div className="aviso atencion">
        En {periodo} todavía no se registró ningún ingreso de vecinos. Si algún punto estuvo
        abierto, revisá con el vigilador que esté cargando desde el celular; si es de los que
        llevan el conteo en papel, el total del día se carga en Conteos.
      </div>
    )
  }

  return (
    <div className="pila">
      <Trama puntos={puntos} maximo={maximo} periodo={periodo} trazado={PANEL()} />
      <Trama puntos={puntos} maximo={maximo} periodo={periodo} trazado={CELULAR(puntos.length)} />

      <div className={`${estilos.leyenda} menor`}>
        <span className={estilos.clave}>
          <span className={estilos.muestraSolida} /> Dejaron datos
        </span>
        <span className={estilos.clave}>
          <span className={estilos.muestraTrama} /> Sin datos
        </span>
        <span className={estilos.clave}>
          <span style={muestraConteo} /> Contadas en papel
        </span>
        <span className="gris">
          Cada barra es el total de visitas del período. La parte punteada viene del conteo diario:
          se sabe cuánta gente vino, no quién, así que en esa parte no hay vecinos identificados que
          comparar. Los identificados se cuentan aparte: son personas, no visitas.
        </span>
      </div>

      {hayConteo && (
        <p className="menor gris" style={{ margin: 0 }}>
          Un punto con la barra entera punteada lleva el conteo en papel porque no puede usar el
          celular durante la jornada. Su altura sí se compara con la de los demás —son visitas—;
          lo que no se puede comparar es cuánta gente identificó.
        </p>
      )}
    </div>
  )
}

function Trama({
  puntos,
  maximo,
  periodo,
  trazado,
}: {
  puntos: PuntoGrafico[]
  maximo: number
  periodo: string
  trazado: Trazado
}) {
  const { ancho, alto, margen, sufijo } = trazado
  const anchoTrama = ancho - margen.izquierda - margen.derecha
  const altoTrama = alto - margen.arriba - margen.abajo

  const idSinDatos = `trama-sin-datos-${sufijo}`
  const idConteo = `trama-conteo-${sufijo}`

  // Un poco de aire arriba para que la barra más alta y su número no toquen el borde.
  const tope = maximo * 1.08
  const marcas = marcasDelEje(maximo)

  const y = (valor: number) => margen.arriba + altoTrama - (valor / tope) * altoTrama
  const grupo = anchoTrama / Math.max(puntos.length, 1)
  const anchoBarra = Math.max(8, Math.min(52, grupo * 0.56))

  return (
    <svg
      className={`${estilos.marco} ${estilos[trazado.clase]}`}
      viewBox={`0 0 ${ancho} ${alto}`}
      role="img"
      aria-label={
        `Visitas por punto verde en ${periodo}, separando las que dejaron datos, las que no `
        + 'y las que vienen de un conteo diario en papel'
      }
    >
      <defs>
        <pattern
          id={idSinDatos}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" className={estilos.tramaFondo} />
          <line x1="0" y1="0" x2="0" y2="6" className={estilos.tramaLinea} />
        </pattern>

        <pattern id={idConteo} width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" style={fondoConteo} />
          <circle cx="3" cy="3" r="1.5" style={puntoConteo} />
        </pattern>
      </defs>

      {marcas.map((valor) => (
        <Fragment key={valor}>
          <line
            x1={margen.izquierda}
            x2={ancho - margen.derecha}
            y1={y(valor)}
            y2={y(valor)}
            className={valor === 0 ? estilos.base : estilos.grilla}
          />
          <text
            x={margen.izquierda - 10}
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
        const centro = margen.izquierda + grupo * (i + 0.5)
        const x = centro - anchoBarra / 2
        // Las partes nunca pueden pasarse del total; si la base devolviera
        // algo raro, la barra se recorta en vez de romperse.
        const contadas = Math.max(0, Math.min(punto.contadas, punto.visitas))
        const detalladas = punto.visitas - contadas
        const sinDatos = Math.max(0, Math.min(punto.sinDatos, detalladas))
        const conDatos = detalladas - sinDatos

        const base = margen.arriba + altoTrama
        const altoDe = (valor: number) => (valor / tope) * altoTrama
        const altoTotal = altoDe(punto.visitas)
        const altoConDatos = altoDe(conDatos)
        const altoSinDatos = altoDe(sinDatos)
        const altoContadas = Math.max(2, altoDe(contadas))

        const partes = [
          conDatos > 0 ? `${numero(conDatos)} dejaron datos` : '',
          sinDatos > 0 ? `${numero(sinDatos)} no dejaron datos` : '',
          contadas > 0 ? `${numero(contadas)} vienen del conteo diario, sin saber quién` : '',
        ].filter(Boolean)

        // El texto va armado de una sola pieza: React no acepta varios hijos en
        // un <title> y los descartaba, así que hasta acá la etiqueta de cada
        // barra salía vacía y al apoyar el mouse no aparecía nada.
        const etiqueta =
          `${punto.codigo} · ${punto.nombre}: ${numero(punto.visitas)} visitas en ${periodo}. `
          + `${partes.join('; ')}. `
          + (punto.soloConteo
            ? 'Este punto solo lleva el conteo diario: no registra vecinos identificados.'
            : `${numero(punto.identificados)} vecinos identificados.`)

        return (
          <Fragment key={punto.id}>
            {punto.visitas > 0 && (
              <g>
                <title>{etiqueta}</title>
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
                    y={base - altoConDatos - Math.max(2, altoSinDatos)}
                    width={anchoBarra}
                    height={Math.max(2, altoSinDatos)}
                    fill={`url(#${idSinDatos})`}
                  />
                )}
                {contadas > 0 && (
                  <>
                    <rect
                      x={x}
                      y={base - altoTotal}
                      width={anchoBarra}
                      height={altoContadas}
                      fill={`url(#${idConteo})`}
                    />
                    <rect
                      x={x + 0.75}
                      y={base - altoTotal + 0.75}
                      width={anchoBarra - 1.5}
                      height={Math.max(1, altoContadas - 1.5)}
                      style={bordeConteo}
                    />
                  </>
                )}
                <text x={centro} y={base - altoTotal - 8} textAnchor="middle" className={estilos.cifraBarra}>
                  {numero(punto.visitas)}
                </text>
              </g>
            )}
            <text x={centro} y={alto - 22} textAnchor="middle" className={estilos.rotuloPunto}>
              {punto.codigo}
            </text>
          </Fragment>
        )
      })}
    </svg>
  )
}
