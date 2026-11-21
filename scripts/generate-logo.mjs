import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

// Generate a compact, dependency-free 512x512 PNG brand mark.
const SIZE = 512;
const SCALE = 2;
const HI = SIZE * SCALE;
const pixels = Buffer.alloc(HI * HI * 4);
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i] = 255;
  pixels[i + 1] = 255;
  pixels[i + 2] = 255;
  pixels[i + 3] = 255;
}

function paint(x, y, radius, color = [0, 0, 0]) {
  const minX = Math.max(0, Math.floor(x - radius - 1));
  const maxX = Math.min(HI - 1, Math.ceil(x + radius + 1));
  const minY = Math.max(0, Math.floor(y - radius - 1));
  const maxY = Math.min(HI - 1, Math.ceil(y + radius + 1));
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const distance = Math.hypot(px + 0.5 - x, py + 0.5 - y);
      const alpha = Math.max(0, Math.min(1, radius + 0.75 - distance));
      if (!alpha) continue;
      const offset = (py * HI + px) * 4;
      for (let c = 0; c < 3; c += 1) pixels[offset + c] = Math.round(pixels[offset + c] * (1 - alpha) + color[c] * alpha);
    }
  }
}

function line(x1, y1, x2, y2, width = 8, color = [0, 0, 0]) {
  x1 *= SCALE; y1 *= SCALE; x2 *= SCALE; y2 *= SCALE;
  const radius = width * SCALE / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    paint(x1 + dx * t, y1 + dy * t, radius, color);
  }
}

function polyline(points, width = 8, color = [0, 0, 0], close = false) {
  for (let i = 0; i < points.length - 1; i += 1) line(...points[i], ...points[i + 1], width, color);
  if (close) line(...points.at(-1), ...points[0], width, color);
}

function bezier(p0, p1, p2, p3, count = 32) {
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count, u = 1 - t;
    points.push([
      u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0],
      u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1]
    ]);
  }
  return points;
}

function curve(a, b, c, d, width = 10) { polyline(bezier(a, b, c, d), width); }
function circle(cx, cy, radius, color = [0, 0, 0]) {
  const steps = Math.max(32, Math.ceil(radius * Math.PI / 2));
  const points = Array.from({ length: steps }, (_, i) => {
    const angle = 2 * Math.PI * i / steps;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
  polyline(points, radius * 2, color, true);
}

// Brain silhouette, with a central crease and a connected neural network.
curve([249, 149], [218, 121], [177, 130], [157, 157], 12);
curve([157, 157], [118, 148], [91, 179], [101, 216], 12);
curve([101, 216], [71, 240], [78, 284], [106, 302], 12);
curve([106, 302], [92, 337], [113, 371], [151, 370], 12);
curve([151, 370], [168, 405], [210, 405], [235, 380], 12);
curve([235, 380], [252, 359], [250, 333], [237, 313], 12);
curve([237, 313], [252, 284], [249, 251], [235, 230], 12);
curve([235, 230], [255, 202], [256, 169], [249, 149], 12);
curve([263, 151], [284, 127], [321, 128], [340, 153], 12);
curve([340, 153], [374, 151], [399, 177], [391, 210], 12);
curve([391, 210], [420, 232], [414, 273], [388, 293], 12);
curve([388, 293], [404, 326], [384, 361], [351, 365], 12);
curve([351, 365], [334, 396], [294, 402], [269, 378], 12);
curve([269, 378], [253, 360], [254, 335], [269, 313], 12);
curve([269, 313], [254, 284], [257, 251], [271, 230], 12);
curve([271, 230], [253, 203], [254, 169], [263, 151], 12);

const network = [
  [[118, 225], [165, 190]], [[165, 190], [204, 222]], [[118, 225], [132, 294]],
  [[132, 294], [181, 322]], [[181, 322], [204, 222]], [[181, 322], [222, 287]],
  [[204, 222], [222, 287]], [[165, 190], [154, 264]], [[154, 264], [222, 287]],
  [[290, 190], [338, 172]], [[338, 172], [374, 221]], [[290, 190], [280, 254]],
  [[280, 254], [345, 283]], [[345, 283], [374, 221]], [[280, 254], [300, 322]],
  [[300, 322], [350, 344]], [[350, 344], [388, 293]], [[300, 322], [263, 344]],
  [[263, 344], [222, 287]], [[263, 344], [300, 322]], [[345, 283], [388, 293]]
];
for (const [[x1, y1], [x2, y2]] of network) line(x1, y1, x2, y2, 5);
for (const [x, y, r] of [[118,225,10],[165,190,10],[204,222,10],[132,294,10],[181,322,10],[222,287,10],[154,264,9],[290,190,10],[338,172,10],[374,221,10],[280,254,10],[345,283,10],[300,322,10],[350,344,10],[388,293,10],[263,344,10]]) circle(x, y, r);

// Bold plus mark at the upper-right of the brain.
line(402, 78, 402, 148, 18);
line(367, 113, 437, 113, 18);

// Downsample 2x for antialiased edges and encode a standard RGBA PNG.
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  const row = y * (SIZE * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < SIZE; x += 1) {
    const from = ((y * SCALE * HI) + x * SCALE) * 4;
    const to = row + 1 + x * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      raw[to + channel] = Math.round((pixels[from + channel] + pixels[from + 4 + channel] + pixels[from + HI * 4 + channel] + pixels[from + HI * 4 + 4 + channel]) / 4);
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const body = Buffer.concat([name, data]);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, checksum]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);
await writeFile(new URL('../public/logo.png', import.meta.url), png);
console.log(`Generated public/logo.png (${SIZE}x${SIZE})`);
