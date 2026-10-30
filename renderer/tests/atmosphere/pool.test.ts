import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { PARK_FRAMES, SpritePool, puffAt, tint } from "../../src/atmosphere/particles";

describe("a pool passing over what is not drawn (R5, review P1)", () => {
  it("keeps every later sprite in its place, hidden where one was passed over", () => {
    const pool = new SpritePool("add");
    const frame = (skipFirst: boolean) => {
      pool.begin();
      if (skipFirst) pool.skip();
      else pool.next(Texture.WHITE);
      const second = pool.next(Texture.EMPTY);
      pool.end();
      return second;
    };
    const before = frame(false);
    const after = frame(true);
    expect(after).toBe(before);
    expect(pool.shown).toBe(1);
    // The one passed over draws nothing (see-through), and keeps its place.
    expect(pool.container.children.map((sprite) => sprite.alpha > 0)).toEqual([false, true]);
  });

  it("writes a tint only when it changes, and a puff into the one it is handed", () => {
    const pool = new SpritePool();
    pool.begin();
    const sprite = pool.next(Texture.WHITE);
    tint(sprite, 0x123456);
    expect(sprite.tint).toBe(0x123456);
    const out = { x: 0, y: 0, size: 0, alpha: 0 };
    const plume = {
      x: 1,
      y: 2,
      spread: 0.4,
      rise: 6,
      drift: 3,
      life: 4,
      from: 3,
      to: 10,
      alpha: 0.7,
      salt: 5,
    };
    expect(puffAt(plume, 1, 2.5, 16, out)).toBe(out);
    expect(out).toEqual(puffAt(plume, 1, 2.5, 16));
  });
});

describe("a pool's sprites it has no use for (R5, the optimization plan)", () => {
  it("are see-through at once and hidden only when long unused, and come back as they were", () => {
    const pool = new SpritePool();
    pool.begin();
    const sprite = pool.next(Texture.WHITE);
    sprite.alpha = 0.6;
    pool.end();
    pool.begin();
    pool.end();
    // Not drawn: see-through, still in the draw list (no rebuild of the group's).
    expect([sprite.visible, sprite.alpha]).toEqual([true, 0]);
    for (let k = 0; k < PARK_FRAMES; k++) {
      pool.begin();
      pool.end();
    }
    expect(sprite.visible).toBe(false);
    pool.begin();
    expect(pool.next(Texture.WHITE)).toBe(sprite);
    expect([sprite.visible, sprite.alpha]).toEqual([true, 0.6]);
  });
});
