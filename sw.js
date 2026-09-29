const CACHE_NAME = 'cripto-app-v1.4.0';
const APP_SHELL = [
  './',
  './index.html',
  './cripto-app.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './css/style.css',
  './js/app.js',
  './finance-engine.js',
  './secure-vault.js',
  './secure-ui.js',
  './secure-ui.css',
  './financ-icons.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('SW: falhou ao cachear', url, err);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Só cuida do "app shell" (arquivos locais). Chamadas à API de preços (CoinGecko)
  // continuam indo direto para a rede, nunca para o cache — preço nunca deve ser "antigo".
  const url = new URL(event.request.url);
  const isApiCall = url.hostname.includes('coingecko.com');
  if (isApiCall) return;

  // Rede primeiro: atualizações valem na hora; o cache só entra quando estiver offline.
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.status === 200 && event.request.method === 'GET') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
