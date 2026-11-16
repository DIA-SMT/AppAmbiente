/**
 * La portada del tablero, con la estética de Applaza: la franja azul de
 * bienvenida con Migue y las olas celeste y amarilla, y abajo los cuatro
 * accesos en tarjetas de color pastel.
 */
import Image from 'next/image'
import Link from 'next/link'
import { Icono, type NombreDeIcono } from '@/app/_ui/Icono'
import { Olas } from '@/app/_ui/Olas'
import estilos from './bienvenida.module.css'

type Tono = 'azul' | 'amarillo' | 'celeste' | 'verde'

const ACCESOS: Array<{ destino: string; titulo: string; bajada: string; icono: NombreDeIcono; tono: Tono }> = [
  { destino: '/movimientos', titulo: 'Movimientos', bajada: 'Ingresos y salidas', icono: 'movimientos', tono: 'azul' },
  { destino: '/recambios', titulo: 'Recambios', bajada: 'Contenedores de los puntos', icono: 'reciclaje', tono: 'amarillo' },
  { destino: '/trazabilidad', titulo: 'Trazabilidad', bajada: 'Origen y destino', icono: 'ubicacion', tono: 'celeste' },
  { destino: '/conteos', titulo: 'Conteos', bajada: 'Lo que hay en los puntos', icono: 'conteo', tono: 'verde' },
]

function Flecha() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export default function Bienvenida({ nombre }: { nombre: string }) {
  return (
    <>
      <section className={estilos.franja} aria-labelledby="bienvenida-titulo">
        <div className={estilos.texto}>
          <p className="sobretitulo-hoja">Secretaría de Ambiente · San Miguel de Tucumán</p>
          <p className={estilos.titulo} id="bienvenida-titulo">
            Residuos SMT
            <span>Trazabilidad</span>
          </p>
          <p className={estilos.bajada}>
            Hola, {nombre}. Registro y trazabilidad de los residuos de la Planta de Valorización y
            de los puntos verdes de la Ciudad.
          </p>
          <div className={estilos.acciones}>
            <Link href="/movimientos" className={estilos.primaria}>
              Ver movimientos
              <Flecha />
            </Link>
            <Link href="/trazabilidad" className={estilos.secundaria}>
              <Icono nombre="ubicacion" tamano={18} />
              Trazabilidad
            </Link>
          </div>
        </div>
        <div className={estilos.migue} aria-hidden="true">
          <Image src="/migue/migue-cuerpo-sin-fondo.webp" alt="" width={323} height={452} priority />
        </div>
        <Olas />
      </section>

      <nav className={estilos.accesos} aria-label="Accesos rápidos">
        {ACCESOS.map((a) => (
          <Link key={a.destino} href={a.destino} className={estilos.acceso} data-tono={a.tono}>
            <span className={estilos.accesoIcono}><Icono nombre={a.icono} tamano={34} /></span>
            <span className={estilos.accesoTexto}>
              <strong>{a.titulo}</strong>
              <small>{a.bajada}</small>
            </span>
            <span className={estilos.accesoFlecha}><Flecha /></span>
            <span className={estilos.accesoFondo} aria-hidden="true"><Icono nombre={a.icono} tamano={96} /></span>
          </Link>
        ))}
      </nav>
    </>
  )
}
