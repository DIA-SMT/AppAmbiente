/**
 * Lo que aparece apenas se toca un acceso del celular, mientras el servidor
 * arma la pantalla.
 *
 * Uno solo alcanza para casi todo el grupo porque las pantallas del vigilador
 * comparten la silueta: un título arriba y una columna de bloques grandes
 * debajo —los accesos del turno, las tarjetas de pilas y contenedores, las
 * filas de lo de hoy—. Lo que importa acá no es acertar el contenido: es que
 * el vigilador vea que la app reaccionó al toque y no vuelva a tocar.
 */
import estilos from '@/app/esqueleto.module.css'

export default function Cargando() {
  return (
    <div className="pila" aria-busy="true">
      <span className="sr-solo" role="status">Cargando la pantalla</span>

      <div className="pila-chica">
        <div className={`${estilos.bloque} ${estilos.titulo}`} />
        <div className={`${estilos.bloque} ${estilos.renglonCorto}`} />
      </div>

      {/* Tres bloques: los accesos que tiene el inicio de turno de la Planta.
          En un punto verde hay uno o dos más, y entran abajo sin correr nada
          de lo que ya se dibujó. */}
      <div className={`${estilos.bloque} ${estilos.acceso}`} />
      <div className={`${estilos.bloque} ${estilos.acceso}`} />
      <div className={`${estilos.bloque} ${estilos.acceso}`} />

      <div className="tarjeta pila-chica">
        <div className={`${estilos.bloque} ${estilos.renglon}`} />
        <div className={`${estilos.bloque} ${estilos.renglonCorto}`} />
      </div>
    </div>
  )
}
