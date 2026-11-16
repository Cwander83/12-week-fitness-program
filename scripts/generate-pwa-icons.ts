import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const ICONS_DIR = path.join(PUBLIC_DIR, 'icons');

const CARBON = '#111214';
const CHALK = '#FAFAFA';
const VERMILION = '#D9381E';

function buildStandardBarbellSvg(cornerRadius: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">`,
    `  <rect width="512" height="512" rx="${cornerRadius}" fill="${CARBON}" />`,
    `  <rect x="64" y="156" width="54" height="200" rx="8" fill="${CHALK}" />`,
    `  <rect x="134" y="112" width="50" height="288" rx="8" fill="${CHALK}" />`,
    `  <rect x="184" y="236" width="144" height="40" fill="${VERMILION}" />`,
    `  <rect x="328" y="112" width="50" height="288" rx="8" fill="${CHALK}" />`,
    `  <rect x="394" y="156" width="54" height="200" rx="8" fill="${CHALK}" />`,
    `</svg>`,
    '',
  ].join('\n');
}

function buildMaskableBarbellSvg(): string {
  // All barbell geometry stays strictly inside [88, 424] on X and Y (central 80% safe zone).
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">`,
    `  <rect width="512" height="512" rx="0" fill="${CARBON}" />`,
    `  <rect x="96" y="176" width="44" height="160" rx="6" fill="${CHALK}" />`,
    `  <rect x="152" y="140" width="40" height="232" rx="6" fill="${CHALK}" />`,
    `  <rect x="192" y="240" width="128" height="32" fill="${VERMILION}" />`,
    `  <rect x="320" y="140" width="40" height="232" rx="6" fill="${CHALK}" />`,
    `  <rect x="372" y="176" width="44" height="160" rx="6" fill="${CHALK}" />`,
    `</svg>`,
    '',
  ].join('\n');
}

async function generateIcons(): Promise<void> {
  mkdirSync(ICONS_DIR, { recursive: true });

  const iconSvg = buildStandardBarbellSvg(96);
  const iconSvgPath = path.join(PUBLIC_DIR, 'icon.svg');
  writeFileSync(iconSvgPath, iconSvg, 'utf8');

  const fullBleedSvg = buildStandardBarbellSvg(0);
  const maskableSvg = buildMaskableBarbellSvg();

  await Promise.all([
    sharp(Buffer.from(iconSvg))
      .resize(192, 192)
      .png({ compressionLevel: 9 })
      .toFile(path.join(ICONS_DIR, 'icon-192.png')),
    sharp(Buffer.from(iconSvg))
      .resize(512, 512)
      .png({ compressionLevel: 9 })
      .toFile(path.join(ICONS_DIR, 'icon-512.png')),
    sharp(Buffer.from(maskableSvg))
      .resize(512, 512)
      .png({ compressionLevel: 9 })
      .toFile(path.join(ICONS_DIR, 'icon-maskable-512.png')),
    sharp(Buffer.from(fullBleedSvg))
      .resize(180, 180)
      .png({ compressionLevel: 9 })
      .toFile(path.join(PUBLIC_DIR, 'apple-touch-icon.png')),
  ]);

  console.log('Generated PWA icons in public/ and public/icons/.');
}

generateIcons().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
