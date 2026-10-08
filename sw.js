const CACHE_NAME = 'cripto-app-v1.11.1';
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
  './stk-pkg-secure-vault.js',
  './stk-pkg-secure-ui.js',
  './stk-pkg-secure-ui.css',
  './stk-pkg-financ-icons.js',
  './apoio/apoio.css',
  './apoio/stk-pkg-doacao.js',
  './apoio/stk-pkg-feedback.js',
  './apoio/stk-pkg-erros.js',
  './apoio/stk-pkg-qrcode.js',
  './fonts/fonts.css',
  './fonts/ibm-plex-mono-latin-400.woff2',
  './fonts/ibm-plex-mono-latin-500.woff2',
  './fonts/ibm-plex-mono-latin-600.woff2',
  './fonts/ibm-plex-mono-latin-ext-400.woff2',
  './fonts/ibm-plex-mono-latin-ext-500.woff2',
  './fonts/ibm-plex-mono-latin-ext-600.woff2',
  './fonts/space-grotesk-latin-ext.woff2',
  './fonts/space-grotesk-latin.woff2',
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
  // Só cuida do "app shell" (arquivos locais): preço nunca deve ser "antigo".
  // Outros domínios (CoinGecko, Binance, Firebase) e envios (POST) vão direto para a rede, sem cache.
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

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
