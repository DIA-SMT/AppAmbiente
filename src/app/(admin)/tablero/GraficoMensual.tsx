import { Fragment } from 'react'
import { numero } from '@/lib/formato'
import estilos from './GraficoMensual.module.css'

export interface MesGrafico {
  clave: string
  rotulo: string
  ingreso: number
  salida: number
}

/**
 * La geometría del dibujo, en unidades del viewBox.
 *
 * El gráfico se dibuja dos veces, con dos geometrías, y CSS muestra una sola.
 * Un SVG con viewBox se escala entero y la letra viaja con el dibujo: en un
 * celular la tarjeta deja unos 324 px útiles, así que el trazado de 780 se
 * achica a 0,41 y los rótulos de 12 px terminan dibujados en 5. No hay unidad
 * de CSS que lo compense —lo que habría que compensar es el ancho del
 * contenedor, que es justamente lo que fija la escala—, así que la única salida
 * sin JavaScript es tener un trazado pensado para el ancho chico. El angosto
 * lleva además un tope de ancho en el módulo, para no agrandarse de más cuando
 * la ventana crece.
 */
interface Trazado {
  ancho: number
  alto: number
  margen: { arriba: number; derecha: number; abajo: number; izquierda: number }
  /** Cuántos rótulos de mes entran sin pisarse. */
  rotulos: number
  /** En el angosto el año no entra al lado del mes y baja a un segundo renglón. */
  anioAbajo: boolean
  clase: string
}

const PANEL: Trazado = {
  ancho: 780,
  alto: 300,
  margen: { arriba: 14, derecha: 18, abajo: 34, izquierda: 58 },
  rotulos: 12,
  anioAbajo: false,
  clase: 'marcoAncho',
}

const CELULAR: Trazado = {
  ancho: 360,
  alto: 250,
  margen: { arriba: 12, derecha: 10, abajo: 46, izquierda: 56 },
  rotulos: 6,
  anioAbajo: true,
  clase: 'marcoAngosto',
}

/**
 * Qué se escribe abajo de cada mes, y cuáles se escriben.
 *
 * En el trazado ancho va el rótulo entero, «abr 2026». En el angosto «abr 2026»
 * mide más que el lugar que le toca a cada mes, así que el año baja a un
 * segundo renglón y se escribe sólo cuando cambia: sin eso, veinticuatro meses
 * salían como «ene may sep ene may sep» y no había modo de saber de qué año era
 * cada cual.
 */
function rotulosDelEje(meses: MesGrafico[], salto: number, anioAbajo: boolean) {
  let anioEscrito = ''
  return meses.map((mes, i) => {
    // Se escribe uno de cada tantos, siempre empezando por el mes más reciente.
    if ((meses.length - 1 - i) % salto !== 0) return null
    if (!anioAbajo) return { mes: mes.rotulo, anio: '' }
    const [nombre, anio = ''] = mes.rotulo.split(' ')
    const cambio = anio !== anioEscrito
    anioEscrito = anio
    return { mes: nombre, anio: cambio ? anio : '' }
  })
}

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

  return (
    <div className="pila">
      <Trama meses={meses} maximo={maximo} trazado={PANEL} />
      <Trama meses={meses} maximo={maximo} trazado={CELULAR} />

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

function Trama({
  meses,
  maximo,
  trazado,
}: {
  meses: MesGrafico[]
  maximo: number
  trazado: Trazado
}) {
  const { ancho, alto, margen } = trazado
  const anchoTrama = ancho - margen.izquierda - margen.derecha
  const altoTrama = alto - margen.arriba - margen.abajo

  // Un poco de aire arriba para que la barra más alta no toque el borde.
  const tope = maximo * 1.04
  const { marcas, decimales } = marcasDelEje(maximo)

  const y = (valor: number) => margen.arriba + altoTrama - (valor / tope) * altoTrama
  const grupo = anchoTrama / Math.max(meses.length, 1)
  const anchoBarra = Math.max(5, Math.min(30, grupo * 0.34))
  const separacion = Math.min(6, grupo * 0.07)

  // Con muchos meses los rótulos se pisan: se escribe uno de cada tantos.
  const salto = Math.ceil(meses.length / trazado.rotulos)
  const rotulos = rotulosDelEje(meses, salto, trazado.anioAbajo)
  const yRotulo = alto - margen.abajo + 22

  const barra = (valor: number, x: number, clase: string, titulo: string) => {
    const altoBarra = valor > 0 ? Math.max(2, (valor / tope) * altoTrama) : 0
    if (!altoBarra) return null
    return (
      <rect x={x} y={margen.arriba + altoTrama - altoBarra} width={anchoBarra} height={altoBarra} rx={2} className={clase}>
        <title>{titulo}</title>
      </rect>
    )
  }

  return (
    <svg
      className={`${estilos.marco} ${estilos[trazado.clase]}`}
      viewBox={`0 0 ${ancho} ${alto}`}
      role="img"
      aria-label="Volumen mensual de ingresos y salidas de la Planta, en metros cúbicos"
    >
      {marcas.map((valor) => (
        <Fragment key={valor}>
          <line
            x1={margen.izquierda}
            x2={ancho - margen.derecha}
            y1={y(valor)}
            y2={y(valor)}
            className={valor === 0 ? estilos.base : estilos.grilla}
          />
          <text x={margen.izquierda - 10} y={y(valor)} textAnchor="end" dominantBaseline="middle" className={estilos.rotuloValor}>
            {numero(valor, decimales)}
          </text>
        </Fragment>
      ))}

      {meses.map((mes, i) => {
        const centro = margen.izquierda + grupo * (i + 0.5)
        const rotulo = rotulos[i]
        return (
          <Fragment key={mes.clave}>
            {barra(mes.ingreso, centro - separacion / 2 - anchoBarra, estilos.barraIngreso,
              `${mes.rotulo}: entraron ${numero(mes.ingreso, 1)} m³`)}
            {barra(mes.salida, centro + separacion / 2, estilos.barraSalida,
              `${mes.rotulo}: salieron ${numero(mes.salida, 1)} m³`)}
            {rotulo && (
              <text x={centro} y={yRotulo} textAnchor="middle" className={estilos.rotuloMes}>
                {rotulo.mes}
              </text>
            )}
            {rotulo?.anio && (
              <text x={centro} y={yRotulo + 16} textAnchor="middle" className={estilos.rotuloAnio}>
                {rotulo.anio}
              </text>
            )}
          </Fragment>
        )
      })}
    </svg>
  )
}
