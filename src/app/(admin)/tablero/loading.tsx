/**
 * El hueco de los dos tableros, el de la Planta y el de los Puntos Verdes.
 *
 * Tiene el suyo porque es la sección más pesada del panel —cada tablero
 * encadena el resumen mensual, los conteos del mes, los del mes anterior y los
 * volúmenes— y porque no se parece en nada al resto: pestañas, cuatro
 * indicadores y un gráfico, donde las demás secciones tienen una tabla. Es
 * además la pantalla a la que cae la coordinación al entrar.
 */
import estilos from '@/app/esqueleto.module.css'

const INDICADORES = [0, 1, 2, 3]

export default function CargandoTablero() {
  return (
    <div className="pila" style={{ gap: 20 }} aria-busy="true">
      <span className="sr-solo" role="status">Cargando el tablero</span>

      <div className={estilos.pestanas}>
        <div className={`${estilos.bloque} ${estilos.pestana}`} />
        <div className={`${estilos.bloque} ${estilos.pestana}`} />
      </div>

      <header className="pila-chica">
        <div className={`${estilos.bloque} ${estilos.titulo}`} />
        <div className={`${estilos.bloque} ${estilos.renglonCorto}`} />
      </header>

      <div className={estilos.indicadores}>
        {INDICADORES.map((n) => (
          <div key={n} className="tarjeta pila-chica">
            <div className={`${estilos.bloque} ${estilos.etiqueta}`} />
            <div className={`${estilos.bloque} ${estilos.cifra}`} />
            <div className={`${estilos.bloque} ${estilos.renglon}`} />
          </div>
        ))}
      </div>

      <div className="tarjeta pila">
        <div className={`${estilos.bloque} ${estilos.renglonCorto}`} />
        <div className={`${estilos.bloque} ${estilos.grafico}`} />
      </div>
    </div>
  )
}
