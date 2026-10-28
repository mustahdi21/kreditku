#!/usr/bin/env node
/**
 * generate-icons.mjs — Membuat ikon PWA/PNG tanpa dependensi eksternal.
 *
 * Encoder PNG minimal (RGBA 8-bit, satu blok IDAT) memakai zlib bawaan Node,
 * sehingga aset ikon dapat dibuat ulang kapan saja tanpa memasang perkakas
 * grafis tambahan.
 *
 * Jalankan: npm run icons:generate
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');

/* -------------------------------------------------------------------------- */
/* Encoder PNG                                                                */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Mengubah piksel RGBA menjadi berkas PNG. */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Penggambaran                                                               */
/* -------------------------------------------------------------------------- */

const BRAND = { r: 79, g: 70, b: 229 }; // indigo-600 (#4f46e5)
const WHITE = { r: 255, g: 255, b: 255 };

function createCanvas(size) {
  return { size, pixels: Buffer.alloc(size * size * 4) };
}

function setPixel(canvas, x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const offset = (y * canvas.size + x) * 4;
  canvas.pixels[offset] = color.r;
  canvas.pixels[offset + 1] = color.g;
  canvas.pixels[offset + 2] = color.b;
  canvas.pixels[offset + 3] = alpha;
}

/** Menggambar persegi panjang dengan sudut membulat (radius relatif ukuran). */
function roundedRect(canvas, x0, y0, x1, y1, radius, color) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x < x0 + radius ? x0 + radius - x : x > x1 - radius ? x - (x1 - radius) : 0;
      const dy = y < y0 + radius ? y0 + radius - y : y > y1 - radius ? y - (y1 - radius) : 0;
      if (dx * dx + dy * dy > radius * radius && (dx > 0 || dy > 0)) continue;
      setPixel(canvas, x, y, color);
    }
  }
}

/** Menggambar garis tebal (Bresenham dengan ketebalan kotak). */
function thickLine(canvas, x0, y0, x1, y1, thickness, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    for (let dy = -thickness; dy <= thickness; dy += 1) {
      for (let dx = -thickness; dx <= thickness; dx += 1) {
        if (dx * dx + dy * dy <= thickness * thickness) setPixel(canvas, x + dx, y + dy, color);
      }
    }
  }
}

/** Menggambar logo: kotak membulat indigo dengan huruf "K" putih. */
function drawLogo(size) {
  const canvas = createCanvas(size);
  const pad = Math.round(size * 0.06);
  roundedRect(canvas, pad, pad, size - pad - 1, size - pad - 1, Math.round(size * 0.22), BRAND);

  const thickness = Math.max(2, Math.round(size * 0.045));
  const left = Math.round(size * 0.32);
  const right = Math.round(size * 0.7);
  const top = Math.round(size * 0.26);
  const bottom = Math.round(size * 0.74);
  const middle = Math.round(size * 0.5);

  // Batang vertikal huruf K.
  thickLine(canvas, left, top, left, bottom, thickness, WHITE);
  // Dua diagonal huruf K.
  thickLine(canvas, left, middle, right, top, thickness, WHITE);
  thickLine(canvas, left, middle, right, bottom, thickness, WHITE);

  return canvas;
}

/* -------------------------------------------------------------------------- */
/* Keluaran                                                                   */
/* -------------------------------------------------------------------------- */

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="KreditKu">
  <rect x="4" y="4" width="56" height="56" rx="14" fill="#4f46e5" />
  <g stroke="#ffffff" stroke-width="6" stroke-linecap="round">
    <path d="M22 17v30" />
    <path d="M22 32l16-15" />
    <path d="M22 32l16 15" />
  </g>
</svg>
`;

mkdirSync(PUBLIC_DIR, { recursive: true });

const targets = [
  { file: 'pwa-192x192.png', size: 192 },
  { file: 'pwa-512x512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32x32.png', size: 32 },
];

for (const target of targets) {
  const canvas = drawLogo(target.size);
  const png = encodePng(target.size, target.size, canvas.pixels);
  writeFileSync(join(PUBLIC_DIR, target.file), png);
  console.log(`Dibuat: public/${target.file} (${target.size}×${target.size}, ${png.length} bita)`);
}

writeFileSync(join(PUBLIC_DIR, 'favicon.svg'), FAVICON_SVG, 'utf8');
console.log('Dibuat: public/favicon.svg');

writeFileSync(
  join(PUBLIC_DIR, 'robots.txt'),
  ['User-agent: *', 'Disallow: /', '# Aplikasi internal: tidak untuk diindeks mesin pencari.', ''].join('\n'),
  'utf8',
);
console.log('Dibuat: public/robots.txt');
