import { Fragment } from 'react'
import { numero } from '@/lib/formato'
import estilos from './GraficoMensual.module.css'

export interface MesGrafico {
  clave: string
  rotulo: string
  ingreso: number
  salida: number
}

const ANCHO = 780
const ALTO = 300
const MARGEN = { arriba: 14, derecha: 18, abajo: 34, izquierda: 58 }

const ANCHO_TRAMA = ANCHO - MARGEN.izquierda - MARGEN.derecha
const ALTO_TRAMA = ALTO - MARGEN.arriba - MARGEN.abajo

/** Decimales que hacen falta para escribir el paso sin redondearlo. */
function decimalesDe(paso: number): number {
  const texto = paso.toFixed(6).replace(/0+$/, '')
  const punto = texto.indexOf('.')
  return punto < 0 ? 0 : texto.length - punto - 1
}

/**
 * Marcas del eje Y en valores redondos que el gráfico efectivamente alcanza:
 * el paso más fino que no pase de tres intervalos, así quedan 3 o 4 marcas.
 */
function marcasDelEje(maximo: number): { marcas: number[]; decimales: number } {
  const exponente = Math.floor(Math.log10(maximo))
  const pasos: number[] = []
  for (let e = exponente - 2; e <= exponente + 1; e++) {
    for (const m of [1, 2, 2.5, 5]) pasos.push(m * 10 ** e)
  }
  pasos.sort((a, b) => a - b)

  const paso = pasos.find((p) => Math.floor(maximo / p + 1e-9) <= 3) ?? maximo
  const marcas: number[] = []
  for (let v = 0; v <= maximo + paso * 1e-9; v += paso) marcas.push(v)

  return { marcas, decimales: decimalesDe(paso) }
}

export default function GraficoMensual({ meses }: { meses: MesGrafico[] }) {
  const maximo = Math.max(0, ...meses.map((m) => Math.max(m.ingreso, m.salida)))

  if (!(maximo > 0)) {
    return (
      <div className="aviso atencion">
        Hay movimientos cargados, pero todavía no suman volumen: los materiales usados no
        tienen factor de conversión a m³. Se configura en Listas, en cada material.
      </div>
    )
  }

  // Un poco de aire arriba para que la barra más alta no toque el borde.
  const tope = maximo * 1.04
  const { marcas, decimales } = marcasDelEje(maximo)

  const y = (valor: number) => MARGEN.arriba + ALTO_TRAMA - (valor / tope) * ALTO_TRAMA
  const grupo = ANCHO_TRAMA / Math.max(meses.length, 1)
  const anchoBarra = Math.max(5, Math.min(30, grupo * 0.34))
  const separacion = Math.min(6, grupo * 0.07)

  // Con muchos meses los rótulos se pisan: se escribe uno de cada tantos,
  // siempre empezando por el mes más reciente.
  const salto = Math.ceil(meses.length / 12)

  const barra = (valor: number, x: number, clase: string, titulo: string) => {
    const alto = valor > 0 ? Math.max(2, (valor / tope) * ALTO_TRAMA) : 0
    if (!alto) return null
    return (
      <rect x={x} y={MARGEN.arriba + ALTO_TRAMA - alto} width={anchoBarra} height={alto} rx={2} className={clase}>
        <title>{titulo}</title>
      </rect>
    )
  }

  return (
    <div className="pila">
      <svg
        className={estilos.marco}
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        role="img"
        aria-label="Volumen mensual de ingresos y salidas de la Planta, en metros cúbicos"
      >
        {marcas.map((valor) => (
          <Fragment key={valor}>
            <line
              x1={MARGEN.izquierda}
              x2={ANCHO - MARGEN.derecha}
              y1={y(valor)}
              y2={y(valor)}
              className={valor === 0 ? estilos.base : estilos.grilla}
            />
            <text x={MARGEN.izquierda - 10} y={y(valor)} textAnchor="end" dominantBaseline="middle" className={estilos.rotuloValor}>
              {numero(valor, decimales)}
            </text>
          </Fragment>
        ))}

        {meses.map((mes, i) => {
          const centro = MARGEN.izquierda + grupo * (i + 0.5)
          const mostrarRotulo = (meses.length - 1 - i) % salto === 0
          return (
            <Fragment key={mes.clave}>
              {barra(mes.ingreso, centro - separacion / 2 - anchoBarra, estilos.barraIngreso,
                `${mes.rotulo}: entraron ${numero(mes.ingreso, 1)} m³`)}
              {barra(mes.salida, centro + separacion / 2, estilos.barraSalida,
                `${mes.rotulo}: salieron ${numero(mes.salida, 1)} m³`)}
              {mostrarRotulo && (
                <text x={centro} y={ALTO - 12} textAnchor="middle" className={estilos.rotuloMes}>
                  {mes.rotulo}
                </text>
              )}
            </Fragment>
          )
        })}
      </svg>

      <div className={`${estilos.leyenda} menor`}>
        <span className={estilos.clave}>
          <span className="punto" style={{ background: 'var(--ingreso)' }} /> Entró
        </span>
        <span className={estilos.clave}>
          <span className="punto" style={{ background: 'var(--salida)' }} /> Salió
        </span>
        <span className="gris">Volumen en m³ equivalentes</span>
      </div>
    </div>
  )
}
