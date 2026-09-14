/**
 * Service worker de Residuos SMT.
 *
 * Hace una sola cosa: guardar el armazón de la aplicación (iconos, logos,
 * manifiesto y los archivos con hash de Next) para que abrir la app con mala
 * señal no dependa de bajar de nuevo el CSS y el JavaScript.
 *
 * Todo lo demás va derecho a la red: pantallas, listados y /api. Un movimiento
 * de hace tres días mostrado como si fuera de hoy es peor que una pantalla que
 * avisa que no hay conexión, porque el vigilador no tiene cómo darse cuenta.
 */

const VERSION = 'v1'
const CACHE = `residuos-smt-armazon-${VERSION}`

const ARMAZON = [
  '/manifest.webmanifest',
  '/marca/icono-192.png',
  '/marca/icono-512.png',
  '/marca/logo-smt-blanco.png',
  '/marca/logo-muni-iso.png',
  '/marca/logo-ia.png',
]

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // allSettled: si mañana se renombra un logo, el service worker igual
      // se instala en vez de quedar roto para todos.
      await Promise.allSettled(ARMAZON.map((ruta) => cache.add(ruta)))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(
        nombres
          .filter((nombre) => nombre.startsWith('residuos-smt-') && nombre !== CACHE)
          .map((nombre) => caches.delete(nombre)),
      )
      await self.clients.claim()
    })(),
  )
})

/** Solo archivos estáticos con nombre estable o con hash en la ruta. */
function esArmazon(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/marca/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/favicon.ico'
  )
}

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request
  if (pedido.method !== 'GET') return

  const url = new URL(pedido.url)
  if (url.origin !== self.location.origin) return
  // Una pantalla vieja mostraría datos viejos sin decirlo.
  if (pedido.mode === 'navigate') return
  if (url.pathname.startsWith('/api/')) return
  if (!esArmazon(url)) return

  evento.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const guardado = await cache.match(pedido)
      if (guardado) return guardado

      const respuesta = await fetch(pedido)
      // waitUntil: el service worker no se duerme antes de terminar de guardar.
      if (respuesta.status === 200 && respuesta.type === 'basic') {
        evento.waitUntil(cache.put(pedido, respuesta.clone()))
      }
      return respuesta
    })(),
  )
})
