import { Texture, type Renderer } from "pixi.js";
import { describe, expect, it } from "vitest";
import { GENE_COUNT } from "../../src/creatures/genome";
import { PORTRAIT_SIZE, Portraits, type Portrait } from "../../src/creatures/portrait";
import { localBody, LOCAL_PIXELS } from "../../src/creatures/views";
import { installCanvas } from "./canvas";

installCanvas();

const ATLAS = {
  plants: new Map<string, Texture>(),
  disc: Texture.WHITE,
  white: Texture.WHITE,
  wedge: Texture.WHITE,
};

/**
 * A renderer whose read-back is a solid block the size of the frame asked for, with a
 * see-through row and column round it and a half see-through red corner pixel.
 */
function fakeRenderer(): { renderer: Renderer; frames: { width: number; height: number }[] } {
  const frames: { width: number; height: number }[] = [];
  const pixels = ({ frame }: { frame: { width: number; height: number } }) => {
    const width = frame.width + 2;
    const height = frame.height + 2;
    frames.push({ width: frame.width, height: frame.height });
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 1; y <= frame.height; y++) {
      for (let x = 1; x <= frame.width; x++) rgba.set([200, 100, 50, 255], (y * width + x) * 4);
    }
    // Premultiplied by its alpha, as read back: 100 red at half alpha is 200 red.
    rgba.set([100, 0, 0, 128], (1 * width + 1) * 4);
    return { pixels: rgba, width, height };
  };
  // The read without waiting (`asynchronous`): a texture made of the frame, read back
  // (with no WebGL2 here, at once).
  const generateTexture = ({ frame }: { frame: { width: number; height: number } }) => ({
    frame: { x: 0, y: 0, ...frame },
    source: { resolution: 1 },
    destroy: () => undefined,
  });
  const getPixels = (texture: { frame: { width: number; height: number } }) =>
    pixels({ frame: texture.frame });
  return {
    renderer: {
      extract: { pixels },
      textureGenerator: { generateTexture },
      texture: { getPixels },
    } as unknown as Renderer,
    frames,
  };
}

function portrait(key: string, shape = key): Portrait {
  return {
    id: 1,
    key,
    shape,
    seed: {
      mass: 2,
      limbPairs: 2,
      landSpeed: 3,
      swimSpeed: 1,
      diet: 0.2,
      speed: 0.5,
      armour: 0,
      sense: 0.4,
      aquatic: 0,
      jaw: 0.5,
      hue: 0.9,
      pattern: 0,
      x: 0,
      y: 0,
      genome: Array.from({ length: GENE_COUNT }, () => 0.5),
      species: 1,
      slots: 0,
      torpid: false,
    },
    plans: new Map(),
    body: localBody(LOCAL_PIXELS),
  };
}

describe("the name card's portrait", () => {
  it("is a square of its size, the animal cropped to what it covers and centred in it", () => {
    const { renderer } = fakeRenderer();
    const picture = new Portraits(renderer, ATLAS).of(portrait("a"));
    if (picture === null) throw new Error("drawn at once, never null");
    expect([picture.width, picture.height]).toEqual([PORTRAIT_SIZE, PORTRAIT_SIZE]);
    const opaque = (x: number, y: number): boolean =>
      (picture.rgba[(y * PORTRAIT_SIZE + x) * 4 + 3] ?? 0) > 0;
    let x0 = PORTRAIT_SIZE;
    let x1 = -1;
    let y0 = PORTRAIT_SIZE;
    let y1 = -1;
    for (let y = 0; y < PORTRAIT_SIZE; y++) {
      for (let x = 0; x < PORTRAIT_SIZE; x++) {
        if (!opaque(x, y)) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    expect(x1).toBeGreaterThanOrEqual(x0);
    // As far from the left as from the right, give or take a pixel; the same up and down.
    expect(Math.abs(x0 - (PORTRAIT_SIZE - 1 - x1))).toBeLessThanOrEqual(1);
    expect(Math.abs(y0 - (PORTRAIT_SIZE - 1 - y1))).toBeLessThanOrEqual(1);
    // Within the 40 pixels the body is fitted to.
    expect(x1 - x0 + 1).toBeLessThanOrEqual(40);
    expect(y1 - y0 + 1).toBeLessThanOrEqual(40);
    // A half see-through pixel's colour is divided out of its alpha again.
    const corner = (y0 * PORTRAIT_SIZE + x0) * 4;
    expect(picture.rgba[corner]).toBe(199);
    expect(picture.rgba[corner + 3]).toBe(128);
  });

  it("is drawn once for each key, and a few are kept", () => {
    const { renderer, frames } = fakeRenderer();
    const portraits = new Portraits(renderer, ATLAS);
    const first = portraits.of(portrait("a"));
    const drawn = frames.length;
    expect(drawn).toBeGreaterThan(0);
    expect(portraits.of(portrait("a"))).toBe(first);
    expect(frames.length).toBe(drawn);
    // Eight more: the first drawn goes, and is drawn again when asked for.
    for (let k = 0; k < 8; k++) portraits.of(portrait(`other ${k}`));
    const again = frames.length;
    expect(portraits.of(portrait("other 7"))).toBeDefined();
    expect(frames.length).toBe(again);
    expect(portraits.of(portrait("a"))).not.toBe(first);
    expect(frames.length).toBeGreaterThan(again);
  });

  it("is drawn once when only its colours change, the same as drawn afresh", () => {
    const { renderer, frames } = fakeRenderer();
    const portraits = new Portraits(renderer, ATLAS);
    portraits.of(portrait("a", "shape"));
    const fitted = frames.length;
    expect(fitted).toBeGreaterThan(1);
    const recoloured = portraits.of(portrait("a, new colours", "shape"));
    expect(frames.length).toBe(fitted + 1);
    const fresh = new Portraits(fakeRenderer().renderer, ATLAS).of(portrait("b", "other shape"));
    expect(recoloured?.rgba).toEqual(fresh?.rgba);
  });

  it("drawn without waiting, comes a few frames later, the same as drawn at once", () => {
    const { renderer, frames } = fakeRenderer();
    const portraits = new Portraits(renderer, ATLAS, true);
    let picture = portraits.of(portrait("a"));
    let asked = 1;
    while (picture === null && asked < 10) {
      picture = portraits.of(portrait("a"));
      asked += 1;
    }
    expect(asked).toBeGreaterThan(1);
    const atOnce = new Portraits(fakeRenderer().renderer, ATLAS).of(portrait("a"));
    expect(picture?.rgba).toEqual(atOnce?.rgba);
    expect(portraits.latestOf(1)).toBe(picture);
    // Asked again: kept.
    const drawn = frames.length;
    expect(portraits.of(portrait("a"))).toBe(picture);
    expect(frames.length).toBe(drawn);
  });
});
