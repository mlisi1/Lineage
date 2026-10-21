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
 * moves stays small. A film of at most 256 colours is kept exactly, in a palette; one of
 * more (a scene under a changing light) gets the 256 a median cut finds, each colour
 * moved to the mean of those it stands for.
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

/** Rows of the box (x, y, w, h) of `pixels` (`bpp` bytes each), each with the filter that leaves the least to store. */
function filtered(pixels, width, box, bpp = 3) {
  const stride = box.w * bpp;
  const out = Buffer.alloc((stride + 1) * box.h);
  const row = (y) =>
    pixels.subarray(
      ((box.y + y) * width + box.x) * bpp,
      ((box.y + y) * width + box.x) * bpp + stride,
    );
  const trial = Buffer.alloc(stride);
  for (let y = 0; y < box.h; y++) {
    const line = row(y);
    const above = y > 0 ? row(y - 1) : null;
    let bestCost = Infinity;
    for (const filter of [0, 1, 2, 4]) {
      let cost = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? line[x - bpp] : 0;
        const b = above === null ? 0 : above[x];
        const c = x >= bpp && above !== null ? above[x - bpp] : 0;
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

/**
 * At most 256 colours for `frames` (each three bytes a pixel): the palette (RGB triples)
 * and the index of every colour that occurs, by its 0xRRGGBB.
 */
export function quantize(frames) {
  const counts = new Map();
  for (const rgb of frames) {
    for (let i = 0; i < rgb.length; i += 3) {
      const colour = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
      counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }
  }
  const colours = [...counts.keys()];
  const channel = (colour, c) => (colour >> (16 - 8 * c)) & 255;
  let boxes = [colours];
  // Cut the box with the widest spread of any channel (weighted by how much of the films it
  // holds) at its median, until there are 256.
  while (boxes.length < 256) {
    let best = -1;
    let bestScore = 0;
    let bestChannel = 0;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let low = 255;
        let high = 0;
        for (const colour of box) {
          const v = channel(colour, c);
          if (v < low) low = v;
          if (v > high) high = v;
        }
        let weight = 0;
        for (const colour of box) weight += counts.get(colour);
        const score = (high - low) * Math.sqrt(weight);
        if (score > bestScore) {
          bestScore = score;
          best = index;
          bestChannel = c;
        }
      }
    });
    if (best < 0) break;
    const box = boxes[best].sort((a, b) => channel(a, bestChannel) - channel(b, bestChannel));
    let total = 0;
    for (const colour of box) total += counts.get(colour);
    let seen = 0;
    let cut = 1;
    for (; cut < box.length - 1; cut++) {
      seen += counts.get(box[cut - 1]);
      if (seen >= total / 2) break;
    }
    boxes = [...boxes.slice(0, best), box.slice(0, cut), box.slice(cut), ...boxes.slice(best + 1)];
  }
  const palette = Buffer.alloc(boxes.length * 3);
  const index = new Map();
  boxes.forEach((box, k) => {
    let weight = 0;
    const sum = [0, 0, 0];
    for (const colour of box) {
      const n = counts.get(colour);
      weight += n;
      for (let c = 0; c < 3; c++) sum[c] += channel(colour, c) * n;
      index.set(colour, k);
    }
    for (let c = 0; c < 3; c++) palette[k * 3 + c] = Math.round(sum[c] / weight);
  });
  return { palette, index };
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
    const { palette, index: lookup } = quantize(frames.map((frame) => frame.rgb));
    const indexed = frames.map((frame) => {
      const out = Buffer.alloc(width * height);
      for (let i = 0; i < out.length; i++) {
        const at = i * 3;
        out[i] = lookup.get((frame.rgb[at] << 16) | (frame.rgb[at + 1] << 8) | frame.rgb[at + 2]);
      }
      return out;
    });
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 3;
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(frames.length, 0);
    actl.writeUInt32BE(0, 4);
    const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("PLTE", palette), chunk("acTL", actl)];
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
      const data = filtered(indexed[index], width, frame.box, 1);
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

/** A still PNG of `image` in a palette of at most 256 colours (lossless when it has no more). */
export function pngIndexed(image) {
  const still = new Apng(image.width, image.height);
  still.add(image.rgb, 1000);
  return still.bytes();
}
