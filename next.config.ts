import type { NextConfig } from 'next'

const config: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite', 'exceljs', 'postgres'],
  experimental: { serverActions: { bodySizeLimit: '8mb' } },

  async headers() {
    return [
      {
        // La imagen de fondo de la pantalla de ingreso no cambia nunca. Sin
        // esto el navegador revalida en cada visita, que en la calle es una ida
        // y vuelta de más. Con inmutable se baja una sola vez y listo.
        //
        // El nombre NO lleva hash: para reemplazar la imagen hay que subirla
        // con otro nombre, si no los navegadores siguen con la vieja.
        source: '/fondo/:archivo*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ]
  },
}

export default config
