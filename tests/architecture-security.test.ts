import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildBackupUrl,
  decodeProgressToken,
  normalizeDays,
  readCompletedDays,
} from '../src/scripts/progress-store';
import { config } from '../vercel';
import { resolveDistFile } from './e2e/server';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

function walkFiles(dir: string, predicate: (filePath: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, predicate));
    } else if (entry.isFile() && predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function getAllowedInlineScriptHashes(): Set<string> {
  const rootRule = config.headers?.find((entry) => entry.source === '/(.*)');
  const cspHeader = rootRule?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
  const scriptSrcDirective =
    cspHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('script-src')) ?? '';
  const hashes = [...scriptSrcDirective.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map(
    (m) => m[1]!,
  );
  return new Set(hashes);
}

describe('architecture & defense-in-depth security invariants', () => {
  it('audits all src/ .ts and .astro files for zero dangerous sinks, zero external origins, and safe JSON serialization', () => {
    const srcDir = path.join(ROOT_DIR, 'src');
    const sourceFiles = walkFiles(
      srcDir,
      (filePath) => filePath.endsWith('.ts') || filePath.endsWith('.astro'),
    );
    expect(sourceFiles.length).toBeGreaterThan(0);

    const dangerousSinks = [
      /\binnerHTML\b/,
      /\bouterHTML\b/,
      /\binsertAdjacentHTML\b/,
      /\bsetHTMLUnsafe\b/,
      /\bdocument\.write\b/,
      /\beval\s*\(/,
      /\bnew\s+Function\b/,
    ];

    const setHtmlUsages: Array<{ file: string; snippet: string }> = [];

    for (const filePath of sourceFiles) {
      const rel = path.relative(ROOT_DIR, filePath);
      const content = readFileSync(filePath, 'utf8');

      for (const sinkRegex of dangerousSinks) {
        expect(content, `Dangerous DOM/eval sink ${sinkRegex} found in ${rel}`).not.toMatch(
          sinkRegex,
        );
      }

      const externalUrls = [...content.matchAll(/https?:\/\/[^\s"'`)<>]+/g)].map((m) => m[0]!);
      const nonNamespaceUrls = externalUrls.filter((u) => u !== 'http://www.w3.org/2000/svg');
      expect(
        nonNamespaceUrls,
        `Unexpected external HTTP(S) runtime origin in ${rel}: ${nonNamespaceUrls.join(', ')}`,
      ).toEqual([]);

      const setHtmlMatches = [...content.matchAll(/<[^\n>]*\bset:html\b[^\n>]*>/g)];
      for (const m of setHtmlMatches) {
        setHtmlUsages.push({ file: rel, snippet: m[0]! });
      }
    }

    expect(setHtmlUsages).toHaveLength(1);
    expect(setHtmlUsages[0]!.file).toBe('src/layouts/BaseLayout.astro');
    expect(setHtmlUsages[0]!.snippet).toContain('type="application/json"');

    const baseLayoutSource = readFileSync(
      path.join(ROOT_DIR, 'src/layouts/BaseLayout.astro'),
      'utf8',
    );
    expect(baseLayoutSource).toContain("replace(/</g, '\\\\u003c')");
    expect(baseLayoutSource).toContain("replace(/>/g, '\\\\u003e')");
    expect(baseLayoutSource).toContain("replace(/&/g, '\\\\u0026')");
    expect(baseLayoutSource).toContain("replace(/\\u2028/g, '\\\\u2028')");
    expect(baseLayoutSource).toContain("replace(/\\u2029/g, '\\\\u2029')");

    const clientInitSource = readFileSync(
      path.join(ROOT_DIR, 'src/scripts/client-init.ts'),
      'utf8',
    );
    expect(clientInitSource).toContain('new Map()');
    expect(clientInitSource).toContain("pathname.replace(/^\\/+/, '/')");
    expect(clientInitSource).toContain("href.startsWith('/') && !href.startsWith('//')");
    expect(clientInitSource).toContain("createPolicy('pwa-sw'");
    expect(clientInitSource).toContain("input !== '/sw.js'");
  });

  it('confirms zero .env* files in root and zero hardcoded secret patterns across source, scripts, tests, and vercel.ts', () => {
    const rootEntries = readdirSync(ROOT_DIR);
    const envFiles = rootEntries.filter((name) => /^\.env(?:\.|$)/i.test(name));
    expect(envFiles, `Unexpected env files in workspace root: ${envFiles.join(', ')}`).toEqual([]);

    const scanTargets = [
      ...walkFiles(path.join(ROOT_DIR, 'src'), (f) => /\.(?:ts|astro|mjs|js)$/.test(f)),
      ...walkFiles(path.join(ROOT_DIR, 'scripts'), (f) => /\.(?:ts|mjs|js)$/.test(f)),
      ...walkFiles(path.join(ROOT_DIR, 'tests'), (f) => /\.(?:ts|mjs|js)$/.test(f)),
      path.join(ROOT_DIR, 'vercel.ts'),
    ];

    const secretPatterns = [
      /-----BEGIN (?:[A-Z0-9 ]+)?PRIVATE KEY-----/,
      /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
      /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/,
      /\bsk-[A-Za-z0-9_-]{20,}\b/,
      /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
      /(?:api_key|apikey|secret_key|private_key|auth_token|access_token|client_secret|password)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    ];

    for (const filePath of scanTargets) {
      const rel = path.relative(ROOT_DIR, filePath);
      const content = readFileSync(filePath, 'utf8');
      for (const pattern of secretPatterns) {
        expect(content, `Secret pattern ${pattern} matched in ${rel}`).not.toMatch(pattern);
      }
    }
  });

  it('resists adversarial inputs in decodeProgressToken, readCompletedDays, and buildBackupUrl', () => {
    const maliciousTokens = [
      '__proto__',
      'constructor',
      'prototype',
      '<script>alert(1)</script>',
      '../../../../etc/passwd',
      'AAAAAAAAAAAAAA=',
      'AAAAAAAAAAAA+AA',
      'AAAAAAAAAAAA/AA',
      'AAAAAAAAAAAA\0AA',
      '_______________',
      'AAAAAAAAAAAAAAB',
      'a'.repeat(15),
    ];

    for (const token of maliciousTokens) {
      expect(decodeProgressToken(token)).toBeNull();
    }

    const pollutedPayload = '{"__proto__":{"polluted":1}}';
    const memoryStorage = {
      value: pollutedPayload,
      getItem: () => memoryStorage.value,
    };
    expect(readCompletedDays(memoryStorage)).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    memoryStorage.value = JSON.stringify(['constructor', 1e9, -5, null, '1', 0, 85, 3.14]);
    expect(readCompletedDays(memoryStorage)).toEqual([]);
    expect(normalizeDays(['constructor', 1e9, -5, Number.NaN, null, Number.POSITIVE_INFINITY])).toEqual(
      [],
    );

    memoryStorage.value = JSON.stringify(['__proto__', 1, 84, 1e9, -5, null]);
    expect(readCompletedDays(memoryStorage)).toEqual([1, 84]);

    const strippedUrl = buildBackupUrl(
      'https://user:pass@trainer.example/day/54?phish=1&next=https://evil.example#hash',
      [1, 54],
    );
    const parsed = new URL(strippedUrl);
    expect(parsed.origin).toBe('https://trainer.example');
    expect(parsed.pathname).toBe('/day/54');
    expect(parsed.username).toBe('');
    expect(parsed.password).toBe('');
    expect(parsed.hash).toBe('');
    expect(parsed.searchParams.get('phish')).toBeNull();
    expect(parsed.searchParams.get('next')).toBeNull();
    expect(decodeProgressToken(parsed.searchParams.get('p'))).toEqual([1, 54]);

    for (const badHref of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
    ]) {
      expect(() => buildBackupUrl(badHref, [1])).toThrow();
    }
  });

  it('blocks malformed URIs, null bytes, and directory traversal in resolveDistFile', () => {
    const adversarialPaths = [
      '/%E0%A4%A',
      '/..%2f..%2fpackage.json',
      '/../dist-sibling/secret',
      '/dist-sibling/secret',
      '/index.html\0',
      '/index.html%00',
      '..\\..\\package.json',
      '/%2e%2e/%2e%2e/vercel.ts',
    ];

    for (const badPath of adversarialPaths) {
      expect(resolveDistFile(badPath), `Expected null for ${badPath}`).toBeNull();
    }

    const distDir = path.resolve(ROOT_DIR, 'dist');
    if (existsSync(path.join(distDir, 'index.html'))) {
      expect(resolveDistFile('/')).toBe(path.join(distDir, 'index.html'));
      expect(resolveDistFile('/day/54')).toBe(path.join(distDir, 'day', '54', 'index.html'));
    }
  });

  it('verifies post-build 97-route HTML CSP script integrity and client bundle budget', () => {
    const distDir = path.join(ROOT_DIR, 'dist');
    expect(
      existsSync(distDir),
      'Run `pnpm build` before running architecture-security verification',
    ).toBe(true);

    const htmlFiles = walkFiles(distDir, (f) => f.endsWith('.html'));
    expect(htmlFiles).toHaveLength(97);

    const allowedHashes = getAllowedInlineScriptHashes();
    expect(allowedHashes.size).toBeGreaterThanOrEqual(1);

    const jsFiles = walkFiles(path.join(distDir, '_astro'), (f) => f.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);
    const totalGzipBytes = jsFiles.reduce(
      (sum, jsFile) => sum + gzipSync(readFileSync(jsFile)).byteLength,
      0,
    );
    expect(totalGzipBytes).toBeLessThan(10 * 1024);

    for (const htmlFile of htmlFiles) {
      const rel = path.relative(distDir, htmlFile);
      const html = readFileSync(htmlFile, 'utf8');

      expect(html, `Unexpected javascript: URI in ${rel}`).not.toMatch(/href\s*=\s*["']\s*javascript:/i);
      expect(html, `Unexpected inline SVG data URI icon in ${rel}`).not.toContain('data:image/svg+xml');
      expect(html, `Missing manifest link in ${rel}`).toContain(
        '<link rel="manifest" href="/manifest.webmanifest">',
      );
      expect(html, `Missing SVG icon link in ${rel}`).toContain(
        '<link rel="icon" type="image/svg+xml" href="/icon.svg">',
      );
      expect(html, `Missing apple-touch-icon link in ${rel}`).toContain(
        '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
      );

      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
      expect(scripts.length, `Expected scripts in ${rel}`).toBeGreaterThanOrEqual(2);

      for (const match of scripts) {
        const attrs = match[1] ?? '';
        const body = match[2] ?? '';
        const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
        const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);

        if (typeMatch?.[1]?.toLowerCase() === 'application/json') {
          expect(body).not.toMatch(/[<>]|[\u2028\u2029]/);
          expect(() => JSON.parse(body)).not.toThrow();
          continue;
        }

        if (srcMatch) {
          expect(
            srcMatch[1],
            `External script src must be local /_astro/*.js in ${rel}`,
          ).toMatch(/^\/_astro\/[^"']+\.js$/);
          expect(body.trim()).toBe('');
          continue;
        }

        const digest = `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`;
        expect(
          allowedHashes.has(digest),
          `Unlisted inline script hash ${digest} in ${rel}`,
        ).toBe(true);
      }
    }
  });

  it('verifies built PWA manifest, icons, and offline service worker integrity', () => {
    const distDir = path.join(ROOT_DIR, 'dist');
    expect(
      existsSync(distDir),
      'Run `pnpm build` before running architecture-security verification',
    ).toBe(true);

    const manifestPath = path.join(distDir, 'manifest.webmanifest');
    expect(existsSync(manifestPath), 'Missing dist/manifest.webmanifest').toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      id: string;
      display: string;
      start_url: string;
      scope: string;
      icons: Array<{ src: string; sizes: string; purpose?: string }>;
      shortcuts: Array<{ name: string; url: string; icons?: Array<{ src: string }> }>;
    };

    expect(manifest.id).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(4);
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(2);

    const iconPaths = new Set<string>(['/apple-touch-icon.png']);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/')).toBe(true);
      iconPaths.add(icon.src);
    }
    for (const shortcut of manifest.shortcuts) {
      for (const icon of shortcut.icons ?? []) {
        expect(icon.src.startsWith('/')).toBe(true);
        iconPaths.add(icon.src);
      }
    }

    for (const iconRelUrl of iconPaths) {
      const diskPath = path.join(distDir, iconRelUrl.replace(/^\/+/, ''));
      expect(existsSync(diskPath), `Missing built icon asset ${iconRelUrl}`).toBe(true);
      expect(readFileSync(diskPath).byteLength).toBeGreaterThan(0);
    }

    const swPath = path.join(distDir, 'sw.js');
    expect(existsSync(swPath), 'Missing dist/sw.js').toBe(true);
    const swSource = readFileSync(swPath, 'utf8');

    expect(swSource).not.toMatch(/https?:\/\//i);
    expect(swSource).not.toMatch(/\bimportScripts\b/);
    expect(swSource).not.toMatch(/\beval\s*\(/);
    expect(swSource).not.toMatch(/\bnew\s+Function\b/);

    expect(swSource).toContain("const STATIC_CACHE = 'trainer-static-' + CACHE_VERSION;");
    expect(swSource).toContain("const PAGES_CACHE = 'trainer-pages-' + CACHE_VERSION;");
    expect(swSource).toContain('const MAX_STATIC_ENTRIES = 120;');

    for (const expectedRoute of ['/', '/week/1', '/week/12', '/day/1', '/day/54', '/day/84']) {
      expect(swSource).toContain(JSON.stringify(expectedRoute));
    }

    const routesMatch = swSource.match(/const PRECACHE_ROUTES = (\[[\s\S]*?\]);/);
    expect(routesMatch).not.toBeNull();
    const precachedRoutes = JSON.parse(routesMatch![1]!) as string[];
    expect(precachedRoutes).toHaveLength(97);
  });
});
