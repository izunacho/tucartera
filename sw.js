// Service Worker minimalista para PWA Cartera
const CACHE = 'cartera-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Host exacto o subdominio real de `domain` (ej. "api.coingecko.com" matchea
// "coingecko.com", pero "evil-coingecko.com.attacker.net" no) — a diferencia
// de hostname.includes(domain), que un dominio armado a propósito puede
// falsear.
const isHostOrSubdomain = (hostname, domain) =>
  hostname === domain || hostname.endsWith('.' + domain);

const LIVE_DATA_DOMAINS = ['coingecko.com', 'yahoo.com', 'corsproxy.io', 'allorigins.win'];

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Datos de mercado SIEMPRE en vivo (nunca cachear)
  if (LIVE_DATA_DOMAINS.some((domain) => isHostOrSubdomain(url.hostname, domain))) {
    return;
  }

  // Shell: cache-first
  e.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((res) => {
        if (res.ok && request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      }).catch(() => cached)
    )
  );
});
