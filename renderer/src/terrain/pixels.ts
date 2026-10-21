/** Pixels, colours and the hashes that place things on the land the same way every time. */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA bytes, row by row. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
  /**
   * A ground's shore, when asked for (`GroundOptions.surf`): data for the sea's shader
   * (`terrain/sea.ts`), RGBA of the same size: R the distance out to sea from the shore,
   * G the distance inland (art pixels; 0 on the other side), B when the waves come there
   * (six bits of a wave's turn) and two bits of noise, A opaque where the sea moves.
   */
  shore?: Uint8ClampedArray<ArrayBuffer>;
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
