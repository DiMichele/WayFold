/**
 * generate-pwa-icons.js — Genera le icone PNG della PWA dal logo wayfold.
 *
 * Produce in public/img/:
 *   - icon-192.png            (any)
 *   - icon-512.png            (any)
 *   - icon-maskable-512.png   (maskable, logo nella safe zone ~80%)
 *
 * Esegui una volta (e dopo eventuali modifiche al logo):
 *   npm run generate-pwa-icons
 */

const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'public', 'img');

const BG = '#1A242B';
const FG = '#D97B5C';

/** Icona "any": riquadro arrotondato con la W, come la favicon. */
function anyIcon(size) {
  const radius = Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.62);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>
  <text x="50%" y="50%" dy="0.34em" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="${fontSize}" font-weight="700" fill="${FG}">W</text>
</svg>`;
}

/** Icona maskable: sfondo a tutto campo, logo dentro la safe zone. */
function maskableIcon(size) {
  const fontSize = Math.round(size * 0.46);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <text x="50%" y="50%" dy="0.34em" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="${fontSize}" font-weight="700" fill="${FG}">W</text>
</svg>`;
}

async function render(svg, file) {
  const out = path.join(OUT_DIR, file);
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log(`✓  ${file}`);
}

async function main() {
  await render(anyIcon(192), 'icon-192.png');
  await render(anyIcon(512), 'icon-512.png');
  await render(maskableIcon(512), 'icon-maskable-512.png');
  console.log('Icone PWA generate in public/img/');
}

main().catch(err => {
  console.error('Generazione icone fallita:', err.message);
  process.exit(1);
});
