'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker que guarda el armazón de la app.
 *
 * Solo en producción: en desarrollo, un service worker instalado guardaría los
 * archivos de un build y después serviría esos, y el próximo que levante
 * `npm run dev` no entendería por qué sus cambios no aparecen. Por eso, además,
 * si quedó uno de una prueba anterior, en desarrollo se desregistra.
 */
export default function RegistrarSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker
        .getRegistrations()
        .then((registros) => registros.forEach((registro) => registro.unregister()))
        .catch(() => { /* el navegador no deja; no importa */ })
      return
    }

    // updateViaCache 'none': el navegador vuelve a pedir sw.js en cada visita,
    // así una versión nueva del armazón llega sin esperar a que venza un cache.
    const registrar = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch(() => { /* sin service worker la app funciona igual, solo carga más lento */ })
    }

    if (document.readyState === 'complete') {
      registrar()
      return
    }
    window.addEventListener('load', registrar, { once: true })
    return () => window.removeEventListener('load', registrar)
  }, [])

  return null
}
