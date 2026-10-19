/** Pixels, colours and the hashes that place things on the land the same way every time. */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA bytes, row by row. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
  /**
   * A ground's surf, when asked for (`GroundOptions.surf`): its bands from the shore out
   * (foam, a line, a line further out), each RGBA of the same size, clear but for it.
   */
  surf?: readonly Uint8ClampedArray<ArrayBuffer>[];
}

/** "#rrggbb" → [r, g, b]. */
export function hexToRgb(colour: string): [number, number, number] {
  const value = Number.parseInt(colour.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** A number in [0, 1) that depends only on the cell (and on `salt`, to draw several). */
export function cellHash(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
