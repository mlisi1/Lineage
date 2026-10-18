import { describe, expect, it } from "vitest";
import { ApngWriter, dataUri } from "../../src/spike/apng";

interface Chunk {
  type: string;
  data: Uint8Array;
  crcOk: boolean;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Split a PNG into its chunks, checking each one's checksum the slow, plain way. */
function chunks(file: Uint8Array): Chunk[] {
  const view = new DataView(file.buffer, file.byteOffset, file.length);
  const out: Chunk[] = [];
  for (let at = 8; at < file.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const data = file.subarray(at + 8, at + 8 + length);
    const crcOk = view.getUint32(at + 8 + length) === crc32(file.subarray(at + 4, at + 8 + length));
    out.push({ type, data, crcOk });
    at += 12 + length;
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const field = (data: Uint8Array, at: number, size: 1 | 2 | 4): number => {
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  return size === 4 ? view.getUint32(at) : size === 2 ? view.getUint16(at) : view.getUint8(at);
};

/** A frame of `width` × `height` in one colour, with some pixels in another. */
function frame(width: number, height: number, dots: readonly (readonly [number, number])[]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([10, 20, 30, 255], i * 4);
  for (const [x, y] of dots) rgba.set([200, 100, 50, 255], (y * width + x) * 4);
  return rgba;
}

/** Play a file back: every frame laid over the one before, as a browser does. */
async function play(file: Uint8Array, width: number, height: number): Promise<Uint8ClampedArray[]> {
  const screen = new Uint8ClampedArray(width * height * 4);
  const shown: Uint8ClampedArray[] = [];
  let box = { wide: 0, tall: 0, left: 0, top: 0 };
  for (const { type, data } of chunks(file)) {
    if (type === "fcTL") {
      box = {
        wide: field(data, 4, 4),
        tall: field(data, 8, 4),
        left: field(data, 12, 4),
        top: field(data, 16, 4),
      };
    }
    if (type !== "IDAT" && type !== "fdAT") continue;
    const rows = await inflate(type === "IDAT" ? data : data.subarray(4));
    for (let y = 0; y < box.tall; y++) {
      expect(rows[y * (1 + box.wide * 4)]).toBe(0); // stored as they are
      for (let x = 0; x < box.wide; x++) {
        const from = y * (1 + box.wide * 4) + 1 + x * 4;
        if (rows[from + 3] === 0) continue; // clear: what was there stays
        screen.set(rows.subarray(from, from + 4), ((box.top + y) * width + box.left + x) * 4);
      }
    }
    shown.push(screen.slice());
  }
  return shown;
}

describe("ApngWriter", () => {
  it("writes a looping animated PNG whose frames play back as they went in", async () => {
    const frames = [
      frame(6, 4, [[1, 1]]),
      frame(6, 4, [[2, 1]]),
      frame(6, 4, [[2, 1]]),
      frame(6, 4, [[5, 3]]),
    ];
    const writer = new ApngWriter(6, 4, 125);
    for (const rgba of frames) await writer.add(rgba);
    const file = writer.finish();

    expect([...file.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = chunks(file);
    expect(parts.every((part) => part.crcOk)).toBe(true);
    expect(parts.map((part) => part.type)).toEqual([
      "IHDR",
      "acTL",
      "fcTL",
      "IDAT",
      "fcTL",
      "fdAT",
      "fcTL",
      "fdAT",
      "fcTL",
      "fdAT",
      "IEND",
    ]);
    const [header, animation] = parts;
    // 6 × 4, eight bits a channel, red green blue alpha.
    expect([field(header?.data ?? file, 0, 4), field(header?.data ?? file, 4, 4)]).toEqual([6, 4]);
    expect([...(header?.data.subarray(8, 10) ?? [])]).toEqual([8, 6]);
    // Four frames, played for ever.
    expect([field(animation?.data ?? file, 0, 4), field(animation?.data ?? file, 4, 4)]).toEqual([
      4, 0,
    ]);
    // Frame controls and frame data are numbered in one sequence.
    const numbered = parts.filter((part) => part.type === "fcTL" || part.type === "fdAT");
    expect(numbered.map((part) => field(part.data, 0, 4))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const control of parts.filter((part) => part.type === "fcTL")) {
      expect([field(control.data, 20, 2), field(control.data, 22, 2)]).toEqual([125, 1000]);
    }
    expect(await play(file, 6, 4)).toEqual(frames);
  });

  it("stores of a later frame only the box around what changed", async () => {
    const writer = new ApngWriter(40, 30, 100);
    await writer.add(frame(40, 30, [[10, 10]]));
    await writer.add(frame(40, 30, [[12, 11]])); // the dot moved: two pixels changed
    await writer.add(frame(40, 30, [[12, 11]])); // nothing did
    const controls = chunks(writer.finish()).filter((part) => part.type === "fcTL");
    const box = (control: Chunk | undefined): number[] =>
      [4, 8, 12, 16].map((at) => field(control?.data ?? new Uint8Array(26), at, 4));
    expect(box(controls[0])).toEqual([40, 30, 0, 0]);
    expect(box(controls[1])).toEqual([3, 2, 10, 10]);
    expect(box(controls[2])).toEqual([1, 1, 0, 0]);
    // The first frame replaces what is there; the others are laid over it.
    expect(controls.map((control) => field(control.data, 25, 1))).toEqual([0, 1, 1]);
  });

  it("refuses a frame of another size, and gives an address an image can show", async () => {
    const writer = new ApngWriter(4, 4, 100);
    await expect(writer.add(new Uint8ClampedArray(12))).rejects.toThrow("wrong size");
    await writer.add(frame(4, 4, []));
    const uri = dataUri(writer.finish(), "image/png");
    expect(uri.startsWith("data:image/png;base64,iVBORw0KGgo")).toBe(true);
    expect(dataUri(new Uint8Array(100_000).fill(65), "text/plain")).toHaveLength(
      "data:text/plain;base64,".length + Math.ceil(100_000 / 3) * 4,
    );
  });
});
