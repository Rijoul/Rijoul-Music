/* RIJOUL MUSIC — service worker (ouverture hors connexion)
   Met en cache la page d'accueil (index.html) et les bibliothèques externes
   (Firebase, polices, lame.js) pour que l'app s'ouvre même sans réseau.
   Les musiques téléchargées restent dans IndexedDB (gérées par le site).
   Les appels Firestore / Auth ne sont JAMAIS interceptés.
   Pense à changer VERSION à chaque mise à jour de index.html. */
const VERSION = 'v1';
const CACHE = 'rijoul-shell-' + VERSION;

const SHELL = ['./', './index.html'];
const EXTERNAL = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.0/lame.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap'
];

// Hôtes dont on met les réponses en cache (jamais firestore.googleapis.com, identitytoolkit, securetoken…)
const CACHEABLE_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (u) => {
      try { await cache.add(new Request(u, { cache: 'reload' })); } catch (e) {}
    }));
    await Promise.all(EXTERNAL.map(async (u) => {
      try { await cache.add(new Request(u, { mode: 'no-cors' })); } catch (e) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('rijoul-shell-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cachedShell(cache) {
  return (await cache.match('./index.html', { ignoreSearch: true }))
      || (await cache.match('./', { ignoreSearch: true }));
}

// Page principale : réseau d'abord (3 s max), sinon la copie en cache.
async function handleNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const net = await Promise.race([
      fetch(request),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
    ]);
    if (net && net.ok) cache.put('./index.html', net.clone()).catch(() => {});
    return net;
  } catch (e) {
    const hit = await cachedShell(cache);
    if (hit) return hit;
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#05050f;color:#f5f1fa;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h2>Hors connexion</h2><p>Ouvre l\'app une fois avec Internet pour l\'activer hors ligne.</p></div>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// Bibliothèques / polices : cache d'abord, mise à jour en arrière-plan.
async function handleStatic(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (hit) { refresh.catch(() => {}); return hit; }
  const res = await refresh;
  return res || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(handleNavigation(req));
    return;
  }
  if (CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(handleStatic(req));
  }
});
