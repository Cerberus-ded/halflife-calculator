/* Service worker: офлайн-работа веб-версии и PWA.
 * Все файлы приложения кэшируются при установке; дальше ответы идут из кэша сразу,
 * а в фоне кэш обновляется из сети (stale-while-revalidate) — новая версия подхватится при следующем открытии.
 * Регистрируется из app.js только на http/https (на file:// и в Electron не нужен).
 */
'use strict';
const CACHE_PREFIX = 'halflife-calc-';
const CACHE = CACHE_PREFIX + 'v3';
const FILES = [
  'index.html', 'style.css', 'manifest.webmanifest',
  'nucdb.js', 'core.js', 'formulas.js', 'xlsx.js', 'tools.js', 'scheme.js', 'presets.js', 'help.js', 'app.js',
  'icon.svg', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // по одному: отсутствие необязательного файла (например, иконки) не должно ломать установку
    await Promise.all(FILES.map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const isPage = req.mode === 'navigate';
    // главная страница («/» или «index.html») хранится в кэше под одним ключом index.html
    const shell = isPage && /\/(index\.html)?$/.test(url.pathname);
    const cached = shell ? await cache.match('index.html')
      : await cache.match(req, { ignoreSearch: true }) || (isPage ? await cache.match('index.html') : null);
    const network = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(shell ? 'index.html' : req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    const res = await network;
    return res || new Response('Нет соединения, а файл ещё не сохранён для офлайн-работы.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  })());
});
