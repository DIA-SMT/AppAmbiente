import type { Metadata, Viewport } from 'next'
import RegistrarSW from './RegistrarSW'
import './globals.css'

/**
 * El isologo del Municipio dibujado como vector: las dos hojas y el sol, con
 * los colores tomados del PNG de marca. Las curvas son las mismas medidas sobre
 * ese archivo, así que a 16 píxeles se ve igual.
 *
 * Va en línea, y no como archivo, porque el favicon era un PNG de 28 KB para
 * pintar un icono de 16 píxeles, y Next sirve lo que está en public/ sin caché:
 * el navegador volvía a preguntar por él en cada pantalla. Acá viaja dentro del
 * HTML, no llega al kilobyte y no es un pedido más en una antena de 3G.
 */
const ISO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 235 235">
  <mask id="a">
    <rect width="235" height="235" fill="#fff"/>
    <path d="M193 45A135.7 135.7 0 0 1 131 221A134 134 0 0 1 193 45Z" fill="none" stroke="#000" stroke-width="30"/>
  </mask>
  <path d="M36.5 17A148.3 148.3 0 0 0 102 216A128.5 128.5 0 0 0 36.5 17Z" fill="#0166ff" mask="url(#a)"/>
  <path d="M193 45A135.7 135.7 0 0 1 131 221A134 134 0 0 1 193 45Z" fill="#2db0ff"/>
  <circle cx="134" cy="30" r="20" fill="#f4dd02"/>
</svg>`

// Codificado entero: el `#` de cada color cortaría la dirección en seco.
const FAVICON = `data:image/svg+xml,${encodeURIComponent(ISO)}`

export const metadata: Metadata = {
  title: 'Residuos SMT — Secretaría de Ambiente',
  description:
    'Registro y trazabilidad de residuos de la Secretaría de Ambiente y Desarrollo Sustentable, Municipalidad de San Miguel de Tucumán.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Residuos SMT' },
  // El de Apple sigue siendo el PNG: iOS no acepta un SVG para la pantalla de
  // inicio, y ese icono se baja una sola vez, al agregar la app.
  icons: { icon: { url: FAVICON, type: 'image/svg+xml' }, apple: '/marca/icono-192.png' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Se carga con una mano en la calle: que no haga zoom solo al tocar un campo,
  // pero que el usuario sí pueda agrandar si necesita leer algo.
  maximumScale: 5,
  themeColor: '#126ff5',
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>
        {children}
        <RegistrarSW />
      </body>
    </html>
  )
}
