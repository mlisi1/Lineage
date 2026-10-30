import { BufferImageSource } from "pixi.js";
import { describe, expect, it } from "vitest";
import { pixelSprite } from "../../src/terrain/grounds";

describe("a painting as a sprite (R5, review P8)", () => {
  it("hands the painter's pixels to the GPU as they are, at the painting's size", () => {
    const rgba = new Uint8ClampedArray(6 * 4 * 4).fill(200);
    const sprite = pixelSprite({ width: 6, height: 4, rgba }, 2, 3, 5);
    const { source, frame } = sprite.texture;
    expect(source).toBeInstanceOf(BufferImageSource);
    expect((source.resource as Uint8Array).buffer).toBe(rgba.buffer);
    expect([frame.x, frame.y, frame.width, frame.height]).toEqual([0, 0, 6, 4]);
    expect([sprite.x, sprite.y, sprite.scale.x]).toEqual([3, 5, 0.5]);
  });
});
