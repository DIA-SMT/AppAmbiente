import type { Metadata, Viewport } from 'next'
import RegistrarSW from './RegistrarSW'
import './globals.css'

export const metadata: Metadata = {
  title: 'Residuos SMT — Secretaría de Ambiente',
  description:
    'Registro y trazabilidad de residuos de la Secretaría de Ambiente y Desarrollo Sustentable, Municipalidad de San Miguel de Tucumán.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Residuos SMT' },
  icons: { icon: '/marca/logo-muni-iso.png', apple: '/marca/icono-192.png' },
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
