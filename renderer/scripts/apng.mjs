/**
 * PNG in and animated PNG out, for the reports' films (Node, standard library only).
 *
 *   decodePng(bytes)        a browser's screenshot (8-bit RGB or RGBA, not interlaced)
 *                           as { width, height, rgb } with three bytes a pixel
 *   new Apng(width, height) frames of that size, each with its delay in milliseconds;
 *                           `bytes()` writes an animated PNG that loops forever
 *
 * Each frame after the first is stored as the box of pixels that changed since the one
 * before (a frame that changed nothing lengthens the one before), so a film where little
 * moves stays small. Pixel art is lossless: no colour is changed.
 */
import { Buffer } from "node:buffer";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunks(bytes) {
  const found = [];
  let at = 8;
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    found.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return found;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(bytes) {
  const all = chunks(Buffer.from(bytes));
  const header = all.find((chunk) => chunk.type === "IHDR")?.data;
  if (header === undefined) throw new Error("png: no IHDR");
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const colour = header[9];
  if (depth !== 8 || (colour !== 2 && colour !== 6) || header[12] !== 0) {
    throw new Error(`png: depth ${depth}, colour type ${colour} not read`);
  }
  const bpp = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(all.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const stride = width * bpp;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? pixels[y * stride + x - bpp] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp] : 0;
      const value = line[x];
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? (a + b) >> 1
                : paeth(a, b, c);
      pixels[y * stride + x] = (value + predicted) & 255;
    }
  }
  if (bpp === 3) return { width, height, rgb: pixels };
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) pixels.copy(rgb, i * 3, i * 4, i * 4 + 3);
  return { width, height, rgb };
}

/** Every `step`-th pixel across and down, from (`offset`, `offset`): a picture drawn `step` times too large, at its size. */
export function shrink(image, step, offset = 0) {
  const width = Math.floor(image.width / step);
  const height = Math.floor(image.height / step);
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      image.rgb.copy(
        rgb,
        (y * width + x) * 3,
        ((y * step + offset) * image.width + x * step + offset) * 3,
        ((y * step + offset) * image.width + x * step + offset) * 3 + 3,
      );
    }
  }
  return { width, height, rgb };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** Rows of the box (x, y, w, h) of `rgb`, each with the filter that leaves the least to store. */
function filtered(rgb, width, box) {
  const stride = box.w * 3;
  const out = Buffer.alloc((stride + 1) * box.h);
  const row = (y) =>
    rgb.subarray(((box.y + y) * width + box.x) * 3, ((box.y + y) * width + box.x) * 3 + stride);
  const trial = Buffer.alloc(stride);
  for (let y = 0; y < box.h; y++) {
    const line = row(y);
    const above = y > 0 ? row(y - 1) : null;
    let bestCost = Infinity;
    for (const filter of [0, 1, 2, 4]) {
      let cost = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 3 ? line[x - 3] : 0;
        const b = above === null ? 0 : above[x];
        const c = x >= 3 && above !== null ? above[x - 3] : 0;
        const predicted = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : paeth(a, b, c);
        const value = (line[x] - predicted) & 255;
        trial[x] = value;
        cost += value < 128 ? value : 256 - value;
      }
      if (cost < bestCost) {
        bestCost = cost;
        out[y * (stride + 1)] = filter;
        trial.copy(out, y * (stride + 1) + 1);
      }
    }
  }
  return deflateSync(out, { level: 9 });
}

export class Apng {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.frames = [];
    this.last = null;
  }

  /** Add a frame (`rgb`, three bytes a pixel) shown for `delayMs`. */
  add(rgb, delayMs) {
    const { width, height } = this;
    if (this.last === null) {
      this.frames.push({ box: { x: 0, y: 0, w: width, h: height }, rgb, delayMs });
      this.last = rgb;
      return;
    }
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        if (
          rgb[i] !== this.last[i] ||
          rgb[i + 1] !== this.last[i + 1] ||
          rgb[i + 2] !== this.last[i + 2]
        ) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) {
      this.frames[this.frames.length - 1].delayMs += delayMs;
      return;
    }
    this.frames.push({ box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, rgb, delayMs });
    this.last = rgb;
  }

  bytes() {
    const { width, height, frames } = this;
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(frames.length, 0);
    actl.writeUInt32BE(0, 4);
    const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("acTL", actl)];
    let sequence = 0;
    frames.forEach((frame, index) => {
      const fctl = Buffer.alloc(26);
      fctl.writeUInt32BE(sequence++, 0);
      fctl.writeUInt32BE(frame.box.w, 4);
      fctl.writeUInt32BE(frame.box.h, 8);
      fctl.writeUInt32BE(frame.box.x, 12);
      fctl.writeUInt32BE(frame.box.y, 16);
      fctl.writeUInt16BE(Math.max(1, Math.round(frame.delayMs)), 20);
      fctl.writeUInt16BE(1000, 22);
      fctl[24] = 0; // leave it
      fctl[25] = 0; // replace what is under it
      parts.push(chunk("fcTL", fctl));
      const data = filtered(frame.rgb, width, frame.box);
      if (index === 0) parts.push(chunk("IDAT", data));
      else {
        const number = Buffer.alloc(4);
        number.writeUInt32BE(sequence++, 0);
        parts.push(chunk("fdAT", Buffer.concat([number, data])));
      }
    });
    parts.push(chunk("IEND", Buffer.alloc(0)));
    return Buffer.concat(parts);
  }
}

/** A still PNG of `image`. */
export function png(image) {
  const { width, height } = image;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", filtered(image.rgb, width, { x: 0, y: 0, w: width, h: height })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
