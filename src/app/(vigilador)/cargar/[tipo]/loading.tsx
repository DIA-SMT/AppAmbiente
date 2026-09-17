/**
 * El hueco del formulario de carga.
 *
 * Tiene el suyo y no usa el del grupo por dos razones. Es la pantalla a la que
 * más veces se entra en un turno, y es la que más tarda: las listas de
 * materiales, entidades y pilas salen todas de la base. Y es un formulario, no
 * una columna de botones: con la silueta del grupo el vigilador vería tres
 * bloques parejos y después le saltaría todo el formulario encima.
 */
import estilos from '@/app/esqueleto.module.css'

export default function CargandoFormulario() {
  return (
    <div className="pila" aria-busy="true">
      <span className="sr-solo" role="status">Cargando el formulario</span>

      <div className="fila-entre">
        <div className={`${estilos.bloque} ${estilos.titulo}`} />
        <div className={`${estilos.bloque} ${estilos.volver}`} />
      </div>

      {/* La fecha y la hora, que vienen puestas. */}
      <div className="campo">
        <div className={`${estilos.bloque} ${estilos.etiqueta}`} />
        <div className={`${estilos.bloque} ${estilos.control}`} />
      </div>

      {/* El bloque del material: qué es y cuánto. Va en una tarjeta plana, como
          el de verdad, así el formulario entra en el mismo lugar. */}
      <div className="tarjeta-plana pila" style={{ padding: 14 }}>
        <div className="campo">
          <div className={`${estilos.bloque} ${estilos.etiqueta}`} />
          <div className={`${estilos.bloque} ${estilos.control}`} />
        </div>

        <div className="campo">
          <div className={`${estilos.bloque} ${estilos.etiqueta}`} />
          <div className={estilos.recipientes}>
            <div className={`${estilos.bloque} ${estilos.recipiente}`} />
            <div className={`${estilos.bloque} ${estilos.recipiente}`} />
            <div className={`${estilos.bloque} ${estilos.recipiente}`} />
          </div>
          <div className={`${estilos.bloque} ${estilos.control}`} />
        </div>
      </div>

      {/* Quién lo trae, o quién se lo lleva. */}
      <div className="campo">
        <div className={`${estilos.bloque} ${estilos.etiqueta}`} />
        <div className={`${estilos.bloque} ${estilos.control}`} />
      </div>

      <div className={`${estilos.bloque} ${estilos.botonGrande}`} />
    </div>
  )
}
