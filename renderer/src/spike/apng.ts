/**
 * Animated PNG, written by hand: enough of the format for short loops of pixel art that
 * play in any browser without a script. The first frame is the whole picture; every
 * later frame holds only the pixels that changed since the one before, laid over it, so
 * a scene in which a few animals move costs little more than the animals.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Colour type 6: red, green, blue and alpha, eight bits each. */
const RGBA = 6;
/** Leave the frame in place when the next one comes. */
const DISPOSE_NONE = 0;
/** Replace what is under the frame, or lay the frame over it. */
const BLEND_SOURCE = 0;
const BLEND_OVER = 1;

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** One chunk of a PNG: length, four-letter type, data, and the checksum of type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)));
  return bytes;
}

function fields(size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Writes an animation frame by frame; nothing but the compressed frames is kept. */
export class ApngWriter {
  private previous: Uint32Array | null = null;
  private readonly chunks: Uint8Array[] = [];
  private frames = 0;
  private sequence = 0;

  /** Every frame is `width` × `height` opaque pixels and shows for `delayMs`. */
  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly delayMs: number,
  ) {}

  /** Add a frame: RGBA bytes, row by row. */
  async add(rgba: Uint8ClampedArray): Promise<void> {
    const { width, height } = this;
    if (rgba.length !== width * height * 4) throw new Error("frame of the wrong size");
    // One number per pixel, to compare and copy pixels whole.
    const pixels = new Uint32Array(
      rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.length),
    );
    const before = this.previous;
    // The box around what changed; the whole picture for the first frame.
    let left = 0;
    let top = 0;
    let right = width - 1;
    let bottom = height - 1;
    if (before !== null) {
      left = width;
      top = height;
      right = -1;
      bottom = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (pixels[y * width + x] === before[y * width + x]) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      // Nothing moved: a frame must still hold something, so one clear pixel.
      if (right < 0) [left, top, right, bottom] = [0, 0, 0, 0];
    }
    const wide = right - left + 1;
    const tall = bottom - top + 1;
    // Rows of pixels, each after a byte that says they are stored as they are.
    const rows = new Uint8Array(tall * (1 + wide * 4));
    const out = new DataView(rows.buffer);
    for (let y = 0; y < tall; y++) {
      for (let x = 0; x < wide; x++) {
        const at = (top + y) * width + left + x;
        const pixel = pixels[at] ?? 0;
        // Unchanged pixels stay clear and let the frame before show through.
        if (before !== null && pixel === before[at]) continue;
        out.setUint32(y * (1 + wide * 4) + 1 + x * 4, pixel, true);
      }
    }
    const control = fields(26, (view) => {
      view.setUint32(0, this.sequence++);
      view.setUint32(4, wide);
      view.setUint32(8, tall);
      view.setUint32(12, left);
      view.setUint32(16, top);
      view.setUint16(20, this.delayMs);
      view.setUint16(22, 1000);
      view.setUint8(24, DISPOSE_NONE);
      view.setUint8(25, before === null ? BLEND_SOURCE : BLEND_OVER);
    });
    const packed = await deflate(rows);
    this.chunks.push(chunk("fcTL", control));
    if (before === null) {
      this.chunks.push(chunk("IDAT", packed));
    } else {
      const data = new Uint8Array(4 + packed.length);
      new DataView(data.buffer).setUint32(0, this.sequence++);
      data.set(packed, 4);
      this.chunks.push(chunk("fdAT", data));
    }
    this.previous = pixels;
    this.frames += 1;
  }

  /** The finished file: it loops for ever. */
  finish(): Uint8Array {
    const header = fields(13, (view) => {
      view.setUint32(0, this.width);
      view.setUint32(4, this.height);
      view.setUint8(8, 8);
      view.setUint8(9, RGBA);
    });
    const animation = fields(8, (view) => {
      view.setUint32(0, this.frames);
      view.setUint32(4, 0);
    });
    const parts = [
      Uint8Array.from(SIGNATURE),
      chunk("IHDR", header),
      chunk("acTL", animation),
      ...this.chunks,
      chunk("IEND", new Uint8Array(0)),
    ];
    const file = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      file.set(part, at);
      at += part.length;
    }
    return file;
  }
}

/** A file's bytes as a `data:` address an `<img>` can show. */
export function dataUri(bytes: Uint8Array, type: string): string {
  let binary = "";
  // In pieces: a call cannot take a whole file's bytes as arguments.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return `data:${type};base64,${btoa(binary)}`;
}
