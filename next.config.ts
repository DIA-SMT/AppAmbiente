import type { NextConfig } from 'next'

const config: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite', 'exceljs', 'postgres'],
  experimental: { serverActions: { bodySizeLimit: '8mb' } },
}

export default config
