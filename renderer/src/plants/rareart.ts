/**
 * How a plant's rare genes show (M7's signatures, `lineage_sim.rare.PLANT_SIGNATURES`), as
 * accents on its usual drawing: carriers are rare, so none of these changes what a plant
 * is, only marks it.
 *
 *   bark      FIRE_PINE       the wood a warm red-brown
 *   clover    NITROGEN_FIXER  a few small three-lobed leaves and pale dots at its foot
 *   stilts    MANGROVE        arched stilt roots at its foot; the only plants standing in
 *                             shallow water
 *   berries   POISONOUS       clusters of dark violet berries on its leaves
 *   fruit     FRUITING        two or three large bright fruits on a woody plant; a seed head
 *                             on grass
 *   crown     EMERGENT        a tree's crown half as tall again, over its neighbours
 *
 * Bark is the drawing coloured otherwise and crown the drawing drawn taller; the others
 * are overlays the size of the drawing they lie on, with the same foot, so that a plant
 * with several rare genes carries each.
 */
import { cellHash } from "../terrain/pixels";
import { rimAll } from "./cosyart";
import { INK, blank, limb, type PlantArt } from "./plantart";

export const RARE_LOOKS = ["bark", "clover", "stilts", "berries", "fruit", "crown"] as const;
export type RareLook = (typeof RARE_LOOKS)[number];
/** The overlays: drawn over the plant, each on its own. */
export const OVERLAYS = ["clover", "stilts", "berries", "fruit"] as const;
export type Overlay = (typeof OVERLAYS)[number];

/** Each plant rare gene's look, by the gene's name (as the stream's `rare_genes` names them). */
export const LOOK_OF_GENE: Readonly<Record<string, RareLook>> = {
  FIRE_PINE: "bark",
  NITROGEN_FIXER: "clover",
  MANGROVE: "stilts",
  POISONOUS: "berries",
  FRUITING: "fruit",
  EMERGENT: "crown",
};

/** The looks of a plant whose rare-gene mask is `mask`, the genes named by bit (bit 0 first). */
export function looksOf(mask: number, genes: readonly string[]): RareLook[] {
  const out: RareLook[] = [];
  genes.forEach((name, bit) => {
    const look = LOOK_OF_GENE[name];
    if (look !== undefined && (mask & (1 << bit)) !== 0) out.push(look);
  });
  return out;
}

/** Colours of the looks: a fire pine's bark, berries that warn, bright fruit, pale clover flowers. */
export const RARE_COLOURS = {
  bark: "#a2462a",
  berries: "#5a2c86",
  fruit: "#f07a2a",
  clover: "#f2ecd0",
} as const;

/** A tree's crown with `crown` is drawn this much taller. */
export const EMERGENT_TALLER = 1.45;

const LEAVES: readonly number[] = [INK.deep, INK.dark, INK.mid, INK.light, INK.bright];

/** An empty overlay the size of `base`, with its foot. */
function overlayOf(base: PlantArt): PlantArt {
  return {
    width: base.width,
    height: base.height,
    ink: new Uint8Array(base.width * base.height),
    footX: base.footX,
    footY: base.footY,
  };
}

const inkOf = (art: PlantArt, x: number, y: number): number =>
  x >= 0 && y >= 0 && x < art.width && y < art.height ? (art.ink[y * art.width + x] ?? 0) : 0;

/** Pixels inside `art`'s leaves (leaves all round them), in the order a hash puts them. */
function leafPixels(art: PlantArt, salt: number): [number, number][] {
  const found: [number, number][] = [];
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      // Inside the leaves, not on their rim, so that a berry has leaves round it.
      if (!LEAVES.includes(inkOf(art, x, y))) continue;
      if (!LEAVES.includes(inkOf(art, x - 1, y)) || !LEAVES.includes(inkOf(art, x + 1, y)))
        continue;
      if (!LEAVES.includes(inkOf(art, x, y - 1)) || !LEAVES.includes(inkOf(art, x, y + 1)))
        continue;
      found.push([x, y]);
    }
  }
  return found.sort((a, b) => cellHash(a[0], a[1], salt) - cellHash(b[0], b[1], salt));
}

/** Set a pixel of an overlay, in drawing coordinates (not the plant's). */
function set(art: PlantArt, x: number, y: number, ink: number): void {
  if (x >= 0 && y >= 0 && x < art.width && y < art.height) art.ink[y * art.width + x] = ink;
}

/** How large one berry, fruit or clover lobe is on a drawing `width` pixels wide: a pixel in the middle view, more from close. */
const unitOf = (width: number): number => Math.max(1, Math.round(width / 26));

/** Whether a square `size` pixels across at (x, y) is all leaves on `art`. */
function onLeaves(art: PlantArt, x: number, y: number, size: number): boolean {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++)
      if (!LEAVES.includes(inkOf(art, x + dx, y + dy))) return false;
  }
  return true;
}

/** A round blob of `ink` `size` pixels across at (x, y), its upper left lit (`pale` there, if big enough). */
function blob(art: PlantArt, x: number, y: number, size: number, ink: number, lit: number): void {
  const r = size / 2;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (size >= 3 && (dx + 0.5 - r) ** 2 + (dy + 0.5 - r) ** 2 > r * r + 0.3) continue;
      const shaded = dx + dy >= size;
      set(
        art,
        x + dx,
        y + dy,
        size >= 3 && dx === 1 && dy === 1 ? lit : shaded ? INK.accentDark : ink,
      );
    }
  }
}

/** Clusters of dark violet berries on the leaves: the accent colour is the berries'. */
function berries(base: PlantArt, salt: number): PlantArt {
  const out = overlayOf(base);
  const unit = unitOf(base.width);
  const span = unit > 1 ? 2 * unit + 1 : 1;
  const spots = leafPixels(base, salt).filter(([x, y]) => onLeaves(base, x, y, span));
  const clusters = Math.min(spots.length, unit > 1 ? 5 : 2);
  for (let k = 0; k < clusters; k++) {
    const [x, y] = spots[k] ?? [0, 0];
    // Three berries to a cluster from close, one in the middle view.
    const berries =
      unit > 1
        ? [
            [0, 0],
            [unit, 0],
            [unit / 2, unit],
          ]
        : [[0, 0]];
    for (const [dx = 0, dy = 0] of berries)
      blob(
        out,
        Math.round(x + dx),
        Math.round(y + dy),
        unit + (unit > 1 ? 1 : 0),
        INK.accent,
        INK.pale,
      );
  }
  if (unit > 1) rimAll(out);
  return out;
}

/** Two or three large fruits on a woody plant's leaves; on grass, a seed head on its tallest blade. */
function fruit(base: PlantArt, salt: number, grass: boolean): PlantArt {
  const out = overlayOf(base);
  if (grass) {
    // The tallest blade: the first drawn pixel from the top.
    for (let at = 0; at < base.ink.length; at++) {
      if (base.ink[at] === INK.none || base.ink[at] === INK.outline) continue;
      const x = at % base.width;
      const y = Math.floor(at / base.width);
      set(out, x, y - 1, INK.accent);
      set(out, x + 1, y - 1, INK.accentDark);
      set(out, x, y - 2, INK.accent);
      break;
    }
    return out;
  }
  const unit = unitOf(base.width);
  const size = unit > 1 ? unit + 2 : 1;
  const spots = leafPixels(base, salt).filter(
    ([x, y]) => y > base.height * 0.2 && onLeaves(base, x - 1, y - 1, size + 2),
  );
  const fruits = Math.min(spots.length, unit > 1 ? 4 : 2);
  for (let k = 0; k < fruits; k++) {
    const [x, y] = spots[k] ?? [0, 0];
    blob(out, x, y, size, INK.accent, INK.pale);
  }
  if (unit > 1) rimAll(out);
  return out;
}

/** Small three-lobed leaves round the foot, with pale flowers: the leaves in the ramp's greens. */
function clover(base: PlantArt, salt: number): PlantArt {
  const out = overlayOf(base);
  const unit = unitOf(base.width);
  const footX = Math.round(base.footX);
  const footY = Math.round(base.footY) - unit - 1;
  const reach = Math.max(2, Math.round(base.width * 0.32));
  const leaves = unit > 1 ? 5 : 2;
  const square = (x: number, y: number, ink: number): void => {
    for (let dy = 0; dy < unit; dy++)
      for (let dx = 0; dx < unit; dx++) set(out, x + dx, y + dy, ink);
  };
  for (let k = 0; k < leaves; k++) {
    const x =
      footX +
      Math.round(((k + 0.5) / leaves - 0.5) * 2 * reach + (cellHash(k, footX, salt) - 0.5) * unit);
    const y = footY - Math.floor(cellHash(k, footY, salt + 1) * unit);
    // Three lobes round a darker middle; a pale flower on every other one.
    square(x, y, INK.dark);
    square(x, y - unit, INK.light);
    square(x - unit, y, INK.mid);
    square(x + unit, y, INK.mid);
    if (k % 2 === 1) square(x, y - 2 * unit, INK.pale);
  }
  if (unit > 1) rimAll(out);
  return out;
}

/** Arched stilt roots from the trunk down to the water, in the plant's wood, outlined. */
function stilts(base: PlantArt): PlantArt {
  const out = blank(base.width - 4, base.height - 4);
  const footX = base.footX - 2;
  const footY = base.footY - 2;
  const span = Math.max(2, base.width * 0.22);
  const rise = Math.max(2, base.height * 0.12);
  const thick = base.width >= 24 ? 2 : 1;
  for (const side of [-1, -0.45, 0.45, 1]) {
    const endX = footX + side * span;
    // An arch: up from the water a little out, then in to the trunk higher up.
    const topY = footY - rise * (0.7 + 0.3 * Math.abs(side));
    const midX = footX + side * span * 0.75;
    const midY = footY - rise * 0.9;
    limb(out, endX, footY - 1, midX, midY, thick);
    limb(out, midX, midY, footX + side * thick * 0.5, topY, thick);
  }
  rimAll(out);
  // `blank` keeps a margin; the overlay is the base's size and foot exactly.
  out.footX = base.footX;
  out.footY = base.footY;
  return out;
}

/** The overlay of `look` for a drawing `base` (of grass if `grass`). */
export function overlayArt(base: PlantArt, look: Overlay, salt: number, grass = false): PlantArt {
  if (look === "berries") return berries(base, salt);
  if (look === "fruit") return fruit(base, salt, grass);
  if (look === "clover") return clover(base, salt);
  return stilts(base);
}
