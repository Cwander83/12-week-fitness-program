import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { config } from '../../vercel';

const DIST_DIR = path.resolve(process.cwd(), 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveHeaders(pathname: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rule of config.headers ?? []) {
    let matches = false;
    if (rule.source === '/(.*)') {
      matches = true;
    } else if (rule.source === '/_astro/(.*)') {
      matches = pathname.startsWith('/_astro/');
    } else if (rule.source === pathname) {
      matches = true;
    } else {
      const regex = new RegExp(`^${rule.source}$`);
      matches = regex.test(pathname);
    }

    if (matches) {
      for (const h of rule.headers) {
        result[h.key] = h.value;
      }
    }
  }
  return result;
}

export function resolveDistFile(urlPathname: string): string | null {
  if (urlPathname.includes('\0')) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }

  if (decoded.includes('\0')) {
    return null;
  }

  const normalized = decoded.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) {
    return null;
  }

  const relativePath = normalized.replace(/^\/+/, '');
  const candidate = path.resolve(DIST_DIR, relativePath);

  if (candidate !== DIST_DIR && !candidate.startsWith(DIST_DIR + path.sep)) {
    return null;
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  // Vercel cleanUrls: true maps /day/1 -> dist/day/1/index.html or dist/day/1.html
  const indexCandidate = path.join(candidate, 'index.html');
  if (existsSync(indexCandidate) && statSync(indexCandidate).isFile()) {
    return indexCandidate;
  }

  if (candidate !== DIST_DIR) {
    const htmlCandidate = `${candidate}.html`;
    if (existsSync(htmlCandidate) && statSync(htmlCandidate).isFile()) {
      return htmlCandidate;
    }
  }

  return null;
}

export interface StaticTestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startStaticServer(): Promise<StaticTestServer> {
  const server = http.createServer((req, res) => {
    const rawUrl = req.url ?? '/';
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    const pathname = parsed.pathname;

    const securityHeaders = resolveHeaders(pathname);
    for (const [key, value] of Object.entries(securityHeaders)) {
      res.setHeader(key, value);
    }

    const filePath = resolveDistFile(pathname);
    if (!filePath) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    if (!res.hasHeader('content-type')) {
      res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
    }
    createReadStream(filePath).pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind local static server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
