// Generates cover.png (800x534) for gladys-feux-canada: plain Node, no dependency.
// (The drawing helpers of gladys-openems / gladys-span-panel, approved.)
// A forest of conifers at dusk with a fire on the right, a house on the left,
// a satellite overhead watching the heat, and the five colours of the fire
// danger scale (low to extreme) as a gauge (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
// Dusk sky: deep blue at the top to a warm orange at the horizon.
for (let y = 0; y < H; y += 1) {
  const t = Math.min(1, y / (H * 0.75));
  for (let x = 0; x < W; x += 1) {
    set(x, y, [20 + 220 * t ** 1.6, 30 + 110 * t ** 1.8, 70 - 20 * t]);
  }
}
const white = [255, 255, 255];
const night = [18, 28, 32];
const forest = [24, 52, 40];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const arc = (cx, cy, r, width, from, to, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - width); y <= cy + r + width; y += 1) {
    for (let x = Math.floor(cx - r - width); x <= cx + r + width; x += 1) {
      const angle = Math.atan2(y - cy, x - cx);
      if (angle < from || angle > to) continue;
      const a = Math.max(
        0,
        Math.min(1, width / 2 - Math.abs(Math.hypot(x - cx, y - cy) - r) + 0.5),
      );
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) set(x, y, color, alpha);
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};
// A filled triangle (conifer layer, flame tongue), anti-aliased on its sides.
const triangle = (ax, ay, bx, by, cx, cy, color, alpha = 1) => {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const edge = (x0, y0, x1, y1, x, y) =>
    ((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)) / Math.hypot(x1 - x0, y1 - y0);
  const sign = edge(ax, ay, bx, by, cx, cy) > 0 ? 1 : -1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const d = Math.min(
        sign * edge(ax, ay, bx, by, x, y),
        sign * edge(bx, by, cx, cy, x, y),
        sign * edge(cx, cy, ax, ay, x, y),
      );
      const a = Math.max(0, Math.min(1, d + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const tree = (x, base, h, color) => {
  for (let k = 0; k < 3; k += 1) {
    const top = base - h + k * h * 0.22;
    const w = h * (0.22 + k * 0.08);
    triangle(x, top, x - w, top + h * 0.45, x + w, top + h * 0.45, color);
  }
  box(Math.round(x - h * 0.04), Math.round(base - h * 0.1), Math.round(x + h * 0.04), base, color);
};

// The glow of the fire on the right.
for (let r = 260; r > 0; r -= 4) disc(610, 420, r, [255, 140, 40], 0.012);
// Back row of trees, then the ground and the front row.
for (let x = -10; x < W + 20; x += 34) tree(x, 430, 90 + ((x * 37) % 40), [40, 62, 52]);
box(0, 428, W, H, night);
for (let x = 10; x < W; x += 52) {
  if (x > 520 && x < 700) continue;
  tree(x, 470, 120 + ((x * 53) % 50), forest);
}
// The fire: tongues of flame among black trunks.
const flames = [
  [560, 470, 70, [230, 70, 30]],
  [600, 470, 120, [245, 110, 30]],
  [640, 470, 95, [250, 150, 40]],
  [680, 470, 75, [240, 90, 30]],
  [620, 470, 60, [255, 210, 90]],
];
for (const [x, base, h, color] of flames) {
  triangle(x - h * 0.35, base, x + h * 0.35, base, x + h * 0.08, base - h, color, 0.95);
}
for (const x of [575, 615, 660]) box(x - 3, 400, x + 3, 470, night);
box(0, 468, W, H, night);
// The house on the left, a warm window.
triangle(110, 380, 210, 380, 160, 330, [60, 50, 50]);
box(120, 380, 200, 470, [70, 60, 58]);
box(150, 400, 172, 422, [255, 200, 110]);
box(176, 440, 192, 470, [40, 32, 30]);
// The satellite overhead and the ring of its detection.
const sx = 520;
const sy = 90;
box(sx - 12, sy - 8, sx + 12, sy + 8, [210, 215, 225]);
box(sx - 52, sy - 6, sx - 16, sy + 6, [70, 110, 190]);
box(sx + 16, sy - 6, sx + 52, sy + 6, [70, 110, 190]);
for (let k = 0; k < 3; k += 1)
  line(sx + 20 + k * 28, sy + 30 + k * 60, sx + 40 + k * 32, sy + 52 + k * 64, 3, white);
for (const r of [26, 44]) arc(612, 400, r, 4, -Math.PI, 0, white, 0.8);
// The danger gauge: five arcs, low (blue) to extreme (red), a needle on "high".
const scale = [
  [0, 0, 255],
  [0, 224, 0],
  [255, 255, 0],
  [224, 160, 0],
  [255, 0, 0],
];
const gx = 160;
const gy = 200;
for (let i = 0; i < 5; i += 1) {
  const from = -Math.PI + (i * Math.PI) / 5 + 0.03;
  const to = -Math.PI + ((i + 1) * Math.PI) / 5 - 0.03;
  arc(gx, gy, 90, 26, from, to, scale[i]);
}
const needle = -Math.PI + 2.5 * (Math.PI / 5);
line(gx, gy, gx + 70 * Math.cos(needle), gy + 70 * Math.sin(needle), 7, white);
disc(gx, gy, 12, white);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
