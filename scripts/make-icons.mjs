// Renders the app icon SVG into the PNG sizes phones need. Run: npm run icons
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = new URL('../public/icons/', import.meta.url);

// House with a check mark, on a green rounded square.
const glyph = (scale = 1) => {
  const t = (256 - 256 * scale) / 2;
  return `<g transform="translate(${t} ${t}) scale(${scale})">
    <path d="M58 122 128 62l70 60v74a8 8 0 0 1-8 8H66a8 8 0 0 1-8-8z" fill="none" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>
    <path d="m96 146 22 22 42-44" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
};

const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="#23935f"/>${glyph()}</svg>`;
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#23935f"/>${glyph()}</svg>`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#23935f"/>${glyph(0.78)}</svg>`;
// Android status-bar badge: white silhouette on transparent.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${glyph(1.15)}</svg>`;

const png = (svg, size, name) =>
  sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(fileURLToPath(new URL(name, out)));

await writeFile(new URL('icon.svg', out), rounded);
await png(rounded, 192, 'icon-192.png');
await png(rounded, 512, 'icon-512.png');
await png(maskable, 512, 'icon-maskable-512.png');
await png(fullBleed, 180, 'apple-touch-icon.png'); // iOS rounds the corners itself
await png(badge, 96, 'badge-96.png');
console.log('Icons written to public/icons/');
