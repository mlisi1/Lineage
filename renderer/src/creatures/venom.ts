/**
 * A venomous strike (R5, rare genes in action): the sim's VENOM gene (drawn by bright
 * fangs and a dark-tipped tail) lets a hunter kill larger prey. On the screen its hunt is
 * as any hunter's (`hunting.ts`) but for the strike: a brief green flash at the bite, a
 * couple of green drips falling from it, green among the dust of the prey's fall
 * (`remains.ts`) and a few green wisps rising off it as the dust settles. Marks of whole
 * art pixels (`sparks.ts`), over the dust, on the scene's clock, no random draws.
 */
import type { Point } from "./chain";
import { pixelTexture, type SparkKind, type Sparks } from "./sparks";

/** The flash at the bite: the fangs' lime (`body.ts` `VENOM_FANG`), a star that shrinks. */
const FLASH = 0xc8f04a;
const FLASH_S = 0.3;
/** Drips from the bite: a sharp green, falling this fast (art pixels a second), this long. */
const DRIP = 0xa4e03c;
const DRIP_FALLS = 14;
const DRIP_S = 0.5;
/** Each drip after the one before (seconds), and how far aside of the bite (art pixels). */
const DRIP_AFTER_S = 0.08;
const DRIPS = [-1, 1] as const;
/** The wisps off the prey: a pale toxic green (as in its dust), rising this fast, drifting aside, this long. */
const PUFF = 0xbfe874;
const PUFF_RISES = 7;
const PUFF_DRIFT = 3;
const PUFF_S = 0.7;
/** Wisps, each after the one before (seconds), the first this long after the strike. */
const PUFFS = 4;
const PUFF_FIRST_S = 0.3;
const PUFF_AFTER_S = 0.12;

let kinds: { flash: SparkKind; drip: SparkKind; puff: SparkKind } | null = null;

function venomKinds(): { flash: SparkKind; drip: SparkKind; puff: SparkKind } {
  if (kinds === null) {
    const plus = pixelTexture([".#.", "###", ".#."]);
    kinds = {
      flash: {
        frames: [
          pixelTexture([
            "...#...",
            "...#...",
            "..###..",
            "#######",
            "..###..",
            "...#...",
            "...#...",
          ]),
          pixelTexture(["..#..", ".###.", "#####", ".###.", "..#.."]),
          plus,
        ],
        lasts: FLASH_S,
        fadesAt: 1,
      },
      drip: {
        frames: [pixelTexture(["#", "#"]), pixelTexture(["#"])],
        lasts: DRIP_S,
        fadesAt: 0.6,
      },
      puff: {
        frames: [pixelTexture([".##.", "####", "####", ".##."]), plus, pixelTexture(["#"])],
        lasts: PUFF_S,
        fadesAt: 0.55,
      },
    };
  }
  return kinds;
}

/**
 * The marks of a venomous strike in `sparks`: the flash and drips at `bite` (where the
 * hunter's head is in the prey), the wisps off `prey` (where it was struck), the first
 * drifting `side` (−1 or 1); `pixels` art pixels to the cell.
 */
export function envenom(
  sparks: Sparks,
  bite: Point,
  prey: Point,
  side: number,
  pixels: number,
): void {
  const { flash, drip, puff } = venomKinds();
  sparks.emit(flash, FLASH, bite.x, bite.y);
  DRIPS.forEach((aside, k) => {
    const x = bite.x + aside / pixels;
    sparks.emit(drip, DRIP, x, bite.y, 0, DRIP_FALLS, FLASH_S / 2 + k * DRIP_AFTER_S);
  });
  for (let k = 0; k < PUFFS; k++) {
    const drift = (k % 2 === 0 ? side : -side) * PUFF_DRIFT;
    sparks.emit(puff, PUFF, prey.x, prey.y, drift, -PUFF_RISES, PUFF_FIRST_S + k * PUFF_AFTER_S);
  }
}
