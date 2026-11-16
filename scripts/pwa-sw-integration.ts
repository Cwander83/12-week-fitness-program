import type { AstroIntegration } from 'astro';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_PRECACHE_STATIC = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
] as const;

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function isPrecachedAstroAsset(fileName: string): boolean {
  if (fileName.endsWith('.js') || fileName.endsWith('.css') || fileName.endsWith('.avif')) {
    return true;
  }
  return fileName.includes('latin') && fileName.endsWith('.woff2');
}

function toCanonicalRoute(distDir: string, htmlFile: string): string {
  const rel = path.relative(distDir, htmlFile).split(path.sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) {
    return `/${rel.slice(0, -'/index.html'.length)}`;
  }
  if (rel.endsWith('.html')) {
    return `/${rel.slice(0, -'.html'.length)}`;
  }
  return `/${rel}`;
}

function computeCacheVersion(
  distDir: string,
  staticPaths: string[],
  routes: string[],
  astroJsCssFiles: string[],
): string {
  const hash = createHash('sha256');
  for (const assetPath of [...staticPaths].sort()) {
    hash.update(`static:${assetPath}\n`);
  }
  for (const route of [...routes].sort()) {
    hash.update(`route:${route}\n`);
  }

  const indexHtmlPath = path.join(distDir, 'index.html');
  if (existsSync(indexHtmlPath)) {
    hash.update('index.html:');
    hash.update(readFileSync(indexHtmlPath));
    hash.update('\n');
  }

  const manifestPath = path.join(distDir, 'manifest.webmanifest');
  if (existsSync(manifestPath)) {
    hash.update('manifest.webmanifest:');
    hash.update(readFileSync(manifestPath));
    hash.update('\n');
  }

  for (const assetFile of [...astroJsCssFiles].sort()) {
    const rel = path.relative(distDir, assetFile).split(path.sep).join('/');
    hash.update(`file:${rel}:`);
    hash.update(readFileSync(assetFile));
    hash.update('\n');
  }

  return hash.digest('hex').slice(0, 12);
}

function renderServiceWorker(
  cacheVersion: string,
  precacheStatic: string[],
  precacheRoutes: string[],
): string {
  return `// Build-stamped offline Service Worker (auto-generated at build completion).
const CACHE_VERSION = ${JSON.stringify(cacheVersion)};
const STATIC_CACHE = 'trainer-static-' + CACHE_VERSION;
const PAGES_CACHE = 'trainer-pages-' + CACHE_VERSION;
const MAX_STATIC_ENTRIES = 120;
const PRECACHE_STATIC = ${JSON.stringify(precacheStatic, null, 2)};
const PRECACHE_ROUTES = ${JSON.stringify(precacheRoutes, null, 2)};

function toCanonicalPath(pathname) {
  if (pathname === '/') return '/';
  return pathname.replace(/\\/+$/, '') || '/';
}

async function putWithEviction(cache, key, response) {
  await cache.put(key, response);
  const keys = await cache.keys();
  while (keys.length > MAX_STATIC_ENTRIES) {
    const oldest = keys.shift();
    if (oldest) {
      await cache.delete(oldest);
    }
  }
}

async function warmRoutes(pagesCache) {
  const BATCH_SIZE = 16;
  for (let i = 0; i < PRECACHE_ROUTES.length; i += BATCH_SIZE) {
    const batch = PRECACHE_ROUTES.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (route) => {
        const response = await fetch(route, { credentials: 'same-origin' });
        if (response.ok && response.type === 'basic') {
          await pagesCache.put(route, response);
        }
      })
    );
  }
}

async function networkFirstManifest(request) {
  const staticCache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      await staticCache.put('/manifest.webmanifest', response.clone());
    }
    return response;
  } catch {
    const cached = await staticCache.match('/manifest.webmanifest');
    return cached || new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirstPage(request, canonicalPath) {
  const pagesCache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    if (response.status === 200 && response.type === 'basic') {
      await pagesCache.put(canonicalPath, response.clone());
    }
    return response;
  } catch {
    const cached = (await pagesCache.match(canonicalPath)) || (await pagesCache.match('/'));
    return (
      cached ||
      new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

async function cacheFirstStatic(request) {
  const staticCache = await caches.open(STATIC_CACHE);
  const cached = await staticCache.match(request);
  if (cached) {
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      await putWithEviction(staticCache, request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const staticCache = await caches.open(STATIC_CACHE);
      await staticCache.addAll(PRECACHE_STATIC);
      const pagesCache = await caches.open(PAGES_CACHE);
      await warmRoutes(pagesCache);
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('trainer-') && key !== STATIC_CACHE && key !== PAGES_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  if (url.pathname === '/manifest.webmanifest') {
    event.respondWith(networkFirstManifest(event.request));
    return;
  }

  const accept = event.request.headers.get('accept') || '';
  if (event.request.mode === 'navigate' || accept.includes('text/html')) {
    const canonicalPath = toCanonicalPath(url.pathname);
    event.respondWith(networkFirstPage(event.request, canonicalPath));
    return;
  }

  if (
    url.pathname.startsWith('/_astro/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/apple-touch-icon.png'
  ) {
    event.respondWith(cacheFirstStatic(event.request));
  }
});
`;
}

export function pwaServiceWorker(): AstroIntegration {
  return {
    name: 'pwa-service-worker',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const distDir = fileURLToPath(dir);
        const astroDir = path.join(distDir, '_astro');
        const allDistFiles = walkFiles(distDir);

        const htmlFiles = allDistFiles.filter((filePath) => filePath.endsWith('.html'));
        const precacheRoutes = Array.from(
          new Set(htmlFiles.map((filePath) => toCanonicalRoute(distDir, filePath))),
        ).sort((a, b) => {
          if (a === '/') return -1;
          if (b === '/') return 1;
          return a.localeCompare(b, undefined, { numeric: true });
        });

        const astroFiles = walkFiles(astroDir);
        const precachedAstroUrls = astroFiles
          .filter((filePath) => isPrecachedAstroAsset(path.basename(filePath)))
          .map((filePath) => `/${path.relative(distDir, filePath).split(path.sep).join('/')}`)
          .sort();

        const astroJsCssFiles = astroFiles.filter(
          (filePath) => filePath.endsWith('.js') || filePath.endsWith('.css'),
        );

        const precacheStatic = [...CORE_PRECACHE_STATIC, ...precachedAstroUrls];
        const cacheVersion = computeCacheVersion(
          distDir,
          precacheStatic,
          precacheRoutes,
          astroJsCssFiles,
        );

        const swSource = renderServiceWorker(cacheVersion, precacheStatic, precacheRoutes);
        const swDest = path.join(distDir, 'sw.js');
        writeFileSync(swDest, swSource, 'utf8');

        logger.info(
          `Emitted dist/sw.js (version ${cacheVersion}, ${precacheStatic.length} static assets, ${precacheRoutes.length} routes).`,
        );
      },
    },
  };
}
