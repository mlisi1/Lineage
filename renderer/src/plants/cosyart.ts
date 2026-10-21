/**
 * Plants in the cosy look, after Stardew Valley's (R1 proposal, ADR 0014): the same
 * plants in the same places and sizes as the bundles of `plantart.ts`, drawn the way
 * Stardew draws its trees and forage, seen from above as before.
 *
 *   broadleaf  a crown of a few large puffs piled like a cloud, three rows of them on a
 *              grown tree, each puff scalloped at its rim, lit gold on its upper left
 *              with flecks of leaves, violet in shade below, and throwing a band of
 *              shade on the puffs behind it; a stout trunk that shows under the crown
 *              and flares into roots
 *   conifer    a few bold tiers with large teeth to their hems, each shading the next
 *   bush       a dome of three to five puffs, sitting on the ground
 *   grass      a tuft of broad blades that fan out, light at the tips
 *   the rest   the small plants and stones as before, every one outlined
 *
 * Everything is outlined on its outside, wood as well as leaves: a bare branch carrying
 * snow keeps its edge against snow on the ground. The outline is the drawing's own
 * darkest tone taken toward plum (`looks.ts`), wood's toward plum from the bark.
 */
import { cellHash } from "../terrain/pixels";
import type { Random } from "../rng";
import {
  BARE_TAPER,
  INK,
  inkAt,
  LIGHT_X,
  LIGHT_Y,
  RICH_FROM,
  berries,
  blank,
  blossom,
  cast,
  drawSmall,
  girth,
  limb,
  put,
  settle,
  shadowOf,
  snowCap,
  tiers,
  toneOf,
  trim,
  trunk,
  underCrown,
  type Ink,
  type PlantArt,
  type Size,
  type Small,
  type Standing,
} from "./plantart";

/** Inks that are wood: their outline is the bark's. (A function: `INK` is not there yet when this module loads.) */
const isWood = (ink: number): boolean =>
  ink === INK.trunk || ink === INK.trunkDark || ink === INK.trunkLight || ink === INK.trunkDeep;

/**
 * Outline everything drawn, on its outside: every clear pixel next to a drawn one takes
 * the outline of what it is next to (wood's if any wood, else the leaves').
 */
export function rimAll(art: PlantArt, fromRow = 0): void {
  const rim: [number, Ink][] = [];
  const at = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < art.width && y < art.height ? (art.ink[y * art.width + x] ?? 0) : 0;
  for (let y = fromRow; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      if (at(x, y) !== INK.none) continue;
      const near = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].filter(
        (ink) => ink !== INK.none && ink !== INK.outline && ink !== INK.woodOutline,
      );
      if (near.length === 0) continue;
      rim.push([y * art.width + x, near.some(isWood) ? INK.woodOutline : INK.outline]);
    }
  }
  for (const [index, ink] of rim) art.ink[index] = ink;
}

/** A puff's rim has this many scallops for each pixel of its radius, and bulges this much. */
const SCALLOPS_PER_PIXEL = 0.9;
const SCALLOP = 0.1;
/** From this radius a puff carries flecks of leaves. */
const FLECKS_FROM = 4;
/** Where a puff's highlight is: this share of its radius toward the light. */
const HIGHLIGHT = 0.42;

/**
 * One puff of leaves: a disc with a scalloped rim, lit from the upper left in five
 * tones, with small flecks of leaves lighter on the lit side and darker in the shade.
 * `lift` shifts all of its tones: +1 is a tone lighter.
 */
function puff(art: PlantArt, x: number, y: number, r: number, lift: number, salt: number): void {
  const scallops = Math.max(5, Math.round(r * SCALLOPS_PER_PIXEL));
  const phase = cellHash(Math.round(x * 5), Math.round(y * 5), salt) * Math.PI * 2;
  for (let py = Math.floor(y - r - 1); py <= Math.ceil(y + r + 1); py++) {
    for (let px = Math.floor(x - r - 1); px <= Math.ceil(x + r + 1); px++) {
      const dx = px + 0.5 - x;
      const dy = py + 0.5 - y;
      const angle = Math.atan2(dy, dx);
      // Scallops: bulges with dents between them.
      const rim =
        r * (1 - SCALLOP + SCALLOP * 2 * Math.abs(Math.sin((scallops * angle) / 2 + phase)));
      const far = Math.hypot(dx, dy);
      if (far > rim) continue;
      // Lit as a ball: brightest round a spot up and to the left of its middle, in shade
      // along its far rim, so that the tones curve with the puff instead of cutting it.
      const lit = (dx * LIGHT_X + dy * LIGHT_Y) / r;
      const spot = Math.hypot(dx - LIGHT_X * r * HIGHLIGHT, dy - LIGHT_Y * r * HIGHLIGHT) / r;
      const rimmed = far / rim;
      let level =
        2 + lift + (spot < 0.32 ? 2 : spot < 0.62 ? 1 : rimmed > 0.78 && lit < -0.2 ? -1 : 0);
      if (rimmed > 0.9 && lit < -0.45) level -= 1;
      if (r >= FLECKS_FROM) {
        // A fleck of leaves on a loose grid: two pixels side by side, a tone off.
        const gx = Math.floor((px + (py % 2) * 1.5) / 3);
        const gy = Math.floor(py / 2);
        const fleck = cellHash(gx, gy, salt + 3);
        if (fleck < 0.14 && (px + py) % 3 !== 0) level += spot < 0.75 ? 1 : -1;
      }
      put(art, px, py, toneOf(level));
    }
  }
}

interface Puff {
  x: number;
  y: number;
  r: number;
}

/**
 * Draw puffs from the far side of the crown to the lit one; each throws a band of shade
 * down and to the right on what is already drawn behind it, so that a crown reads as
 * puffs piled on each other.
 */
function pile(art: PlantArt, puffs: Puff[], cx: number, cy: number, salt: number): void {
  const facing = (p: Puff): number => (p.x - cx) * LIGHT_X + (p.y - cy) * LIGHT_Y;
  puffs.sort((a, b) => facing(a) - facing(b));
  for (const p of puffs) {
    if (p.r >= 2.5) cast(art, p.x + p.r * 0.12, p.y + p.r * 0.22, p.r + 0.6);
    puff(art, p.x, p.y, p.r, Math.max(-0.4, Math.min(0.5, facing(p) / Math.max(cx, 1))), salt);
  }
}

/** The puffs of a crown `width` wide and `height` tall, in rows like a cloud: three on a big one. */
function crownPuffs(width: number, height: number, random: Random): Puff[] {
  const rows = height >= 36 ? 3 : 2;
  const r = Math.min(width * (rows === 3 ? 0.25 : 0.3), height / (rows === 3 ? 2.6 : 2.2));
  const puffs: Puff[] = [];
  for (let row = 0; row < rows; row++) {
    const up = row / (rows - 1);
    // Widest low down, narrowing to one or two puffs on top.
    const across =
      row === rows - 1 ? (random() < 0.5 ? 1 : 2) : row === 0 ? 3 : 2 + (random() < 0.5 ? 1 : 0);
    // A puff reaches up to `REACH` times its radius (larger by chance, scalloped).
    const half = Math.max(width / 2 - r * REACH, 0) * (1 - 0.45 * up);
    const y = height - r * 1.02 - up * (height - r * (1.02 + REACH));
    for (let k = 0; k < across; k++) {
      const x = width / 2 + (across === 1 ? 0 : (k / (across - 1) - 0.5) * 2 * half);
      puffs.push({
        x: x + (random() - 0.5) * r * 0.3,
        y: y + (random() - 0.5) * r * 0.25,
        r: r * (0.9 + 0.22 * random()) * (1 - 0.08 * up),
      });
    }
  }
  return puffs;
}

/** How far past its radius a puff can reach: its size by chance and its scallops. */
const REACH = 1.14 * (1 + SCALLOP);

/** A bare tree forks this far down its height: where its crown began. */
const BARE_FORK = 0.6;

/**
 * A bare crown as Stardew draws one: as large as the leafy crown it was, so that a wood
 * keeps its shape in winter. The trunk goes on up as a leader, thinning; limbs leave it
 * one above another, left and right in turn, the lowest reaching out nearly level and
 * the higher ones more upright, each thinner than the one below and each sending a
 * branch up from its middle. These are outlined, as the trunk is. Fine twigs then fill
 * toward the rim (`twigsFrom`), a pixel across and not outlined, so that the crown stays
 * open and does not clot.
 */
function bareCrown(
  art: PlantArt,
  width: number,
  height: number,
  forkY: number,
  thick: number,
  random: Random,
): Array<[number, number, number]> {
  const large = width >= RICH_FROM;
  const crown = height * CROWN_SHARE;
  const cx = width / 2;
  const cy = crown * 0.5;
  const rx = width * 0.47;
  const ry = crown * 0.48;
  const fit = (x: number, y: number): [number, number] => [
    Math.min(Math.max(x, 1), width - 2),
    Math.min(Math.max(y, 1), forkY),
  ];
  /** A point on the rim of the old crown, `angle` from upright, `share` of the way out. */
  const rim = (angle: number, share: number): [number, number] =>
    fit(cx + Math.sin(angle) * rx * share, cy - Math.cos(angle) * ry * share);
  const px = (share: number, least: number): number => Math.max(least, Math.round(thick * share));
  const ends: Array<[number, number, number]> = [];
  // The leader: up the middle to near the top of the old crown, in two lengths, thinning.
  const lean = (random() - 0.5) * width * 0.06;
  const [topX, topY] = fit(cx + lean, cy - ry * 0.72);
  const [midX, midY] = fit(cx + lean * 0.4, (forkY + topY) / 2);
  limb(art, cx, forkY, midX, midY, px(0.8, large ? 3 : 1));
  limb(art, midX, midY, topX, topY, px(0.4, large ? 2 : 1));
  ends.push([topX, topY, 0]);
  // Limbs off the leader, one above another.
  const pairs = large ? 3 : 2;
  for (let k = 0; k < 2 * pairs; k++) {
    const up = (k + 0.5) / (2 * pairs);
    const side = k % 2 === 0 ? -1 : 1;
    const fromX = cx + lean * up;
    const fromY = forkY + (topY - forkY) * up * 0.75;
    // The lowest nearly level, the highest nearly upright.
    const angle = side * (1.35 - 0.8 * up + (random() - 0.5) * 0.15);
    const [ex, ey] = rim(angle, 0.85 + 0.12 * random());
    const [bx, by] = fit(fromX + (ex - fromX) * 0.5, fromY + (ey - fromY) * 0.5 - height * 0.02);
    const size = px(0.34 - 0.14 * up, 1);
    limb(art, fromX, fromY, bx, by, size);
    limb(art, bx, by, ex, ey, Math.max(1, Math.round(size * 0.6)));
    ends.push([ex, ey, angle]);
    // A branch from its middle, leaning out less than the limb.
    const branch = angle * 0.7;
    const [tx, ty] = rim(branch + side * 0.1, 0.75 + 0.15 * random());
    limb(art, bx, by, tx, ty, 1);
    ends.push([tx, ty, branch]);
  }
  return ends;
}

/** Fine twigs from `ends`, a pixel across, in the bark's dark, kept inside the drawing. */
function twigsFrom(
  art: PlantArt,
  ends: ReadonlyArray<readonly [number, number, number]>,
  width: number,
  height: number,
  random: Random,
): void {
  const reach = Math.max(2, width * 0.12);
  for (const [x, y, angle] of ends) {
    for (const turn of [-0.6, 0, 0.6]) {
      if (random() < 0.25) continue;
      const a = angle + turn + (random() - 0.5) * 0.3;
      const length = reach * (0.6 + 0.5 * random());
      const tx = Math.min(Math.max(x + Math.sin(a) * length, 0), width - 1);
      const ty = Math.min(Math.max(y - Math.cos(a) * length, 0), height - 1);
      const steps = Math.ceil(Math.max(Math.abs(tx - x), Math.abs(ty - y)));
      for (let step = 1; step <= steps; step++) {
        const px = x + ((tx - x) * step) / steps;
        const py = y + ((ty - y) * step) / steps;
        if (inkAt(art, Math.round(px), Math.round(py)) === INK.none)
          put(art, px, py, INK.trunkDark);
      }
    }
  }
}

/** From this share of a broadleaf's height down its trunk shows under the crown. */
const CROWN_SHARE = 0.72;
/** A cosy trunk is this much stouter than a bundled tree's. */
const STOUT = 1.45;

export function cosyBroadleaf(size: Size, random: Random, salt: number, look: Standing): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const bare = look.season === "winter" && look.habit !== "leafy";
  const old = look.growth === "old";
  if (look.growth === "sprout") {
    // A sapling: a stem, and a small puff or two at its top; two twigs when it is bare.
    const top = height * 0.45;
    limb(art, width / 2, height - 1, width / 2, top, width >= 14 ? 2 : 1);
    if (bare) {
      limb(art, width / 2, top + height * 0.12, width * 0.22, height * 0.2, 1);
      limb(art, width / 2, top, width * 0.76, height * 0.12, 1);
    } else {
      const r = Math.max(1.8, width * 0.3);
      pile(
        art,
        [
          { x: width * 0.38, y: height * 0.34, r },
          { x: width * 0.62, y: height * 0.26, r: r * 0.9 },
        ],
        width / 2,
        height * 0.3,
        salt,
      );
    }
  } else {
    const crown = height * CROWN_SHARE;
    if (bare) {
      const forkY = height * BARE_FORK;
      const thick = girth(width * STOUT, old);
      trunk(art, width * STOUT, Math.round(forkY), height, width / 2, "furrowed", old, BARE_TAPER);
      const ends = bareCrown(art, width, height, forkY, thick * BARE_TAPER, random);
      trim(art, height);
      rimAll(art);
      twigsFrom(art, ends, width, height, random);
      if (look.snow) snowCap(art, width >= RICH_FROM ? 2 : 1);
      art.shadow = shadowOf(width, 0.22);
      return art;
    } else {
      trunk(art, width * STOUT, Math.round(crown * 0.62), height, width / 2, "furrowed", old);
      pile(art, crownPuffs(width, crown, random), width / 2, crown / 2, salt);
      if (look.season === "spring" && look.variant % 3 === 1) blossom(art, width, crown, random);
      underCrown(art);
    }
  }
  trim(art, height);
  rimAll(art);
  if (look.snow) snowCap(art, width >= RICH_FROM ? 2 : 1);
  if (look.growth !== "sprout") art.shadow = shadowOf(width, bare ? 0.22 : 0.44);
  return art;
}

/** A cosy conifer's tiers: fewer and bolder than the bundled one's, with larger teeth. */
const COSY_TIERS = { tierPixels: 19, teeth: 5, stem: 0.12 };

export function cosyConifer(size: Size, random: Random, salt: number, look: Standing): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  tiers(art, width, height, random, salt, look.season === "spring", look.snow, COSY_TIERS);
  trim(art, height);
  rimAll(art);
  if (look.growth !== "sprout") art.shadow = shadowOf(width, 0.38);
  return art;
}

export function cosyBush(size: Size, random: Random, salt: number, look: Standing): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const sprout = look.growth === "sprout";
  if (look.season === "winter" && look.habit === "bare") {
    // A bush that does not keep its leaves (little EVERGREEN): fine twigs fanning out
    // from the foot, in the bark's colour and not outlined, so that they stay twigs and
    // do not close into a lump.
    const stems = sprout ? 3 : Math.max(5, Math.round(width / 5));
    for (let k = 0; k < stems; k++) {
      const angle = ((k + 0.5) / stems - 0.5) * 2.2 + (random() - 0.5) * 0.25;
      const length = height * (0.6 + 0.35 * random());
      const x = Math.min(Math.max(width / 2 + Math.sin(angle) * length * 1.1, 1), width - 2);
      const y = Math.max(height - 1 - Math.cos(angle) * length, 1);
      limb(art, width / 2 + Math.sin(angle) * 1.5, height - 1, x, y, 1);
      if (sprout) continue;
      const twig = angle + (random() < 0.5 ? -1 : 1) * (0.5 + 0.3 * random());
      limb(
        art,
        (x + width / 2) / 2,
        (y + height) / 2,
        Math.min(Math.max(x + Math.sin(twig) * length * 0.35, 0), width - 1),
        Math.max(y - Math.cos(twig) * length * 0.2, 0),
        1,
      );
    }
    trim(art, height);
    if (look.snow) snowCap(art, 1);
    if (!sprout) art.shadow = shadowOf(width, 0.28);
    return art;
  } else {
    // A dome: three puffs low down, one or two above. In winter it is a bush that keeps
    // its leaves (the simulation's bushes that do not die back to the ground), in the
    // season's darker, colder green.
    const r = Math.max(1.8, Math.min(height * 0.42, width * 0.26));
    const low = height - r;
    const puffs: Puff[] = [
      { x: r * REACH, y: low, r: r * (0.9 + 0.15 * random()) },
      { x: width / 2, y: low + r * 0.08, r: r * (1 + 0.15 * random()) },
      { x: width - r * REACH, y: low, r: r * (0.9 + 0.15 * random()) },
    ];
    if (!sprout) {
      const up = Math.max(r * 1.02, height - r * 1.9);
      puffs.push({ x: width * (0.38 + 0.08 * random()), y: up, r: r * 0.95 });
      if (random() < 0.6)
        puffs.push({ x: width * (0.64 + 0.06 * random()), y: up + r * 0.2, r: r * 0.85 });
    }
    pile(art, puffs, width / 2, height / 2, salt);
    settle(art, height);
    if (sprout) {
      // Too young to flower or fruit.
    } else if (look.season === "spring") {
      if (look.variant % 3 !== 2) blossom(art, width, height, random);
    } else if (look.variant % 3 === 1 || (look.season === "autumn" && look.variant % 3 === 0)) {
      berries(art, width, height, random);
    }
  }
  trim(art, height);
  rimAll(art);
  if (look.snow) snowCap(art, width >= RICH_FROM ? 2 : 1);
  if (!sprout) art.shadow = shadowOf(width, 0.46);
  return art;
}

/** Kinds of tuft, by variant: a W of short spikes, a fuller clump, spikes bent by the wind. */
const TUFT_SHAPES = ["sprig", "clump", "bent"] as const;
/** A tuft is this share of the scale's size (R5: a third of a cell up close, as in the references). */
const TUFT_SHRINK = [0.5, 0.62] as const;
/** A tuft is never taller than this share of its width. */
const TUFT_TALL = 0.7;

/**
 * A tuft of grass after pixel-art grass (R5, the owner: "grass blades are still not
 * there"; references: The Minish Cap's fields and the grass tutorials that follow it).
 * Grass is a texture of small tufts, not things standing on it: a few short spikes from
 * a shared foot, dark at the foot and light at the tips, with no outline, scattered
 * thickly. By `variant`: a W of three to five spikes, a fuller clump (two Ws, one behind
 * the other), or spikes bent one way by the wind; every other three variants mirrored. In seed the tallest tips carry the accent; flat, it has been pressed
 * down by winter. Too small for spikes of two pixels (the middle view), it is a few
 * strokes.
 */
export function cosyTuft(
  size: Size,
  random: Random,
  seeding = false,
  flat = false,
  variant = 0,
): PlantArt {
  const mirrored = Math.floor(variant / TUFT_SHAPES.length) % 2 === 1;
  if (size[0] < 12) {
    const [width, height] = size;
    const art = blank(width, height);
    // A small fan: a stroke up the middle, one leaning out to each side.
    const middle = Math.floor(width / 2);
    for (const [dx, tall, ink] of [
      [-2, 0.6, INK.dark],
      [0, 1, INK.mid],
      [2, 0.75, INK.mid],
    ] as const) {
      const rise = Math.max(1, Math.round(height * tall * (flat ? 0.5 : 1)));
      for (let t = 0; t < rise; t++) {
        const along = t / rise;
        put(
          art,
          middle + dx * along,
          height - 1 - t,
          t === rise - 1 ? (seeding ? INK.accent : INK.light) : ink,
        );
      }
    }
    if (mirrored) mirror(art);
    return art;
  }
  const width = Math.max(5, Math.round(size[0] * TUFT_SHRINK[0]));
  // A large tuft grows wider more than taller, so that its spikes do not turn to long lines.
  const height = Math.max(
    4,
    Math.round(Math.min(size[1] * TUFT_SHRINK[1], width * TUFT_TALL) * (flat ? 0.6 : 1)),
  );
  /** Spikes in a W as wide as `wide`: one for about every three pixels. */
  const spikesFor = (wide: number): number =>
    Math.min(Math.max(Math.round(wide / 3.2 + random()), 3), 7);
  const art = blank(width, height);
  const shape = TUFT_SHAPES[variant % TUFT_SHAPES.length] ?? "sprig";
  /** A W of `spikes` from a foot at `foot` (row from the bottom), `wide` pixels across, rising `tall`. */
  const sprig = (spikes: number, wide: number, tall: number, foot: number, bend: number): void => {
    const middle = (width - 1) / 2;
    for (let k = 0; k < spikes; k++) {
      const share = spikes === 1 ? 0 : k / (spikes - 1) - 0.5;
      // From a narrow foot the spikes fan out in a V, the middle ones the tallest.
      const root = middle + share * wide * 0.3;
      const spread = share * wide * (flat ? 0.5 : 0.75) + bend;
      const rise = Math.max(
        2,
        Math.round(tall * (0.55 + 0.45 * (1 - Math.abs(share) * 2)) * (0.8 + 0.2 * random())),
      );
      for (let t = 0; t < rise; t++) {
        const along = t / Math.max(rise - 1, 1);
        const x = Math.round(root + spread * along);
        const y = height - 1 - foot - t;
        const tip = t === rise - 1;
        const ink: Ink = tip
          ? seeding && rise >= tall * 0.8
            ? INK.accent
            : INK.bright
          : along >= 0.6
            ? INK.light
            : t === 0
              ? INK.deep
              : INK.dark;
        put(art, x, y, ink);
      }
    }
  };
  const tall = height - 1;
  if (shape === "clump") {
    // Two sprigs, the one behind higher and lighter at the tips, the one in front lower.
    sprig(spikesFor(width * 0.8) + 1, Math.round(width * 0.8), tall, 1, 0);
    sprig(
      spikesFor(width * 0.6),
      Math.round(width * 0.6),
      Math.max(2, Math.round(tall * 0.6)),
      0,
      0,
    );
  } else if (shape === "bent") {
    sprig(spikesFor(width * 0.7), Math.round(width * 0.7), tall, 0, 1.5);
  } else {
    sprig(spikesFor(width * 0.85), Math.round(width * 0.85), tall, 0, 0);
  }
  if (mirrored) mirror(art);
  return art;
}

/** Flip a drawing left to right. */
function mirror(art: PlantArt): void {
  for (let y = 0; y < art.height; y++) {
    const row = y * art.width;
    for (let x = 0; x < art.width / 2; x++) {
      const left = art.ink[row + x] ?? 0;
      art.ink[row + x] = art.ink[row + art.width - 1 - x] ?? 0;
      art.ink[row + art.width - 1 - x] = left;
    }
  }
}

/** The small things of the local view, as before, each outlined. */
export function cosySmall(
  kind: Small,
  size: Size,
  random: Random,
  variant: number,
  snow: boolean,
): PlantArt {
  const art = drawSmall(kind, size, random, variant, false, "bundles");
  rimAll(art);
  if (snow && art.shadow !== undefined) snowCap(art, Math.round(size[0]) >= 16 ? 2 : 1);
  return art;
}
