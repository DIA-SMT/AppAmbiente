import type { NextConfig } from 'next'

const config: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite', 'exceljs', 'postgres'],
  experimental: { serverActions: { bodySizeLimit: '8mb' } },

  images: {
    // Sin el optimizador de imágenes de Vercel. En el plan gratuito tiene un
    // cupo por mes y, al pasarlo, /_next/image contesta 402 «Payment
    // required»: el logo y Migue salían como imagen rota en producción (17 de
    // noviembre de 2026). Las imágenes que pasan por <Image> ya están hechas
    // del tamaño justo y en WebP (isotipo-smt-112, logo-ia-160, Migue), así
    // que no hay nada que optimizar: se sirven tal cual desde public/.
    unoptimized: true,
  },

  async headers() {
    return [
      {
        // Los logos institucionales y Migue no cambian nunca: que se bajen una
        // sola vez. El nombre NO lleva hash: para reemplazar uno hay que
        // subirlo con otro nombre, si no los navegadores siguen con el viejo.
        source: '/:carpeta(institucional|marca|migue)/:archivo*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
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
