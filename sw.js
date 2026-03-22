// ─────────────────────────────────────────────
//  sw.js
//  Service Worker PWA — Cache-first pour les
//  assets statiques, réseau-first pour les API.
// ─────────────────────────────────────────────

const CACHE_NAME = 'coach-pt-v3';

const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './tprs.css',
  './transport.css',
  './app.js',
  './state.js',
  './storage.js',
  './home.js',
  './journal.js',
  './progress.js',
  './settings.js',
  './settings-openai-patch.js',
  './tprs.js',
  './tprs-generator.js',
  './tprs-recorder.js',
  './tprs-analyser.js',
  './tprs-recording-patch.js',
  './transport.js',
  './data.js',
  './shared/openai-api.js',
  './manifest.json',
];

// ── Installation : mise en cache des assets ──
// On utilise Promise.allSettled pour ne pas faire échouer l'install
// si un fichier optionnel (icône, etc.) est absent.

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        STATIC_FILES.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Impossible de mettre en cache :', url, err)
          )
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ── Activation : purge des anciens caches ────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch : cache-first pour static, réseau pour API ──

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Toujours réseau pour les appels API externes
  if (
    url.hostname === 'api.anthropic.com' ||
    url.hostname === 'api.openai.com'
  ) {
    return; // Laisser passer sans cache
  }

  // Cache-first pour les assets de l'app
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Mettre en cache les nouvelles ressources statiques
        if (
          response.ok &&
          response.type === 'basic' &&
          event.request.method === 'GET'
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Hors-ligne : retourner index.html pour les navigations
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
