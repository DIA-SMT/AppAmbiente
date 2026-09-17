/**
 * El hueco de cualquier sección del panel.
 *
 * Uno solo para todo el grupo: nueve de las secciones terminan en una tabla
 * dentro de un .desplazable, con título y bajada arriba, así que esa es la
 * silueta que se dibuja. El marco —la cabecera y la barra de navegación— no
 * entra acá: el layout ya está montado y no se vuelve a pedir.
 */
import estilos from '@/app/esqueleto.module.css'

const FILAS = [0, 1, 2, 3, 4, 5, 6, 7]

export default function CargandoPanel() {
  return (
    <div className="pila" aria-busy="true">
      <span className="sr-solo" role="status">Cargando la sección</span>

      <header className="pila-chica">
        <div className={`${estilos.bloque} ${estilos.titulo}`} />
        <div className={`${estilos.bloque} ${estilos.renglon}`} />
      </header>

      <div className="desplazable">
        <div className={estilos.tabla}>
          <div className={`${estilos.bloque} ${estilos.cabeceraTabla}`} />
          {FILAS.map((n) => (
            <div key={n} className={`${estilos.bloque} ${estilos.filaTabla}`} />
          ))}
        </div>
      </div>
    </div>
  )
}
