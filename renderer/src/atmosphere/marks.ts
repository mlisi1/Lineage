/**
 * What a volcano and a meteor leave on the land (R4), drawn the way top-down pixel-art
 * games draw their mountains and craters (Zelda: A Link to the Past's Death Mountain,
 * the Pokémon GBA overworlds' Mt. Chimney, Stardew Valley's Ginger Island volcano):
 * stacked ledges, each with a lit top and a cliff face on the side toward the viewer;
 * boulders on the ledges; cracks in the faces; lava as a bright core under dark crust.
 * The sim raises the cone and digs the bowl in its heights, and bares the land round them
 * (`barren_reach`); the ground's gentle shading hardly shows them from above, so the scene
 * draws them for a month after the event.
 *
 *   cone     two to four ledges, rising toward the summit: rock tops lit from the upper
 *            left in four dithered tones, with pebbles and boulders; striated cliff faces
 *            below each ledge's south edge; a rim of light along its north edge; a mouth
 *            whose back wall shows above a floor of dark crust
 *            and round its foot a skirt of ash and scree thinning into the ground
 *   lava     the eruption's own layer, drawn over the cone without the scene's tint: a pool
 *            of crusted lava in the mouth, rivers running down its south side, falling
 *            bright over each cliff; in `LAVA_FRAMES` frames, the crust drifting across the
 *            pool and down the rivers, the heat swelling and ebbing
 *   crater   drawn from a height field, as the Moon's simple craters look from above: a bowl
 *            with a raised rim, scalloped where its walls slumped; lit from the upper left,
 *            so the far wall is bright and the near wall in the rim's shadow; a slumped
 *            lobe on the floor; a rumpled blanket of thrown earth with boulders, thinning
 *            into patches; rays thrown downrange of the meteor, none uprange
 *
 * Pure per-pixel rules, made into textures once for each size (art pixels), kept for the
 * page's life.
 */
import { CanvasSource, Texture } from "pixi.js";
import { cellHash } from "../terrain/pixels";

/** A pixel of a mark: its colour (0xRRGGBB) and opacity (0–255), or null where it is clear. */
export type MarkPixel = readonly [number, number] | null;

/** Basalt for the tops, darkest to lightest; the faces; outline; boulders. */
const ROCK = [0x3e3036, 0x584549, 0x7a6262, 0x9c8279] as const;
const FACE = [0x2a1f26, 0x3b2c33, 0x4f3c42] as const;
const OUTLINE = 0x1b1218;
/** Ash and scree round the foot: dark ash, grey stone. */
const SCREE = [0x4a3e40, 0x6a5c5a] as const;
const RIM_LIGHT = 0xb79c8c;
const BOULDER = [0x4a3a3e, 0x6e5a58, 0xa48c80] as const;
/** The mouth's cold floor: crust plates, and the cracks between them. */
const CRUST = 0x231a1c;
const CRUST_CRACK = 0x3e2a26;
/** Lava, hottest first, and the crust that floats on it. */
const LAVA = [0xfff1a6, 0xffc44a, 0xff8a2a, 0xd8461c] as const;
const LAVA_CRUST = 0x401c18;
/** A crater's earth: rim tops, faces, outline; its scorched floor and glassy cracks; debris. */
const BOWL = [0x5a464e, 0x6e5856, 0x846a58, 0x9f7f62, 0xbb9a78, 0xd8bc98] as const;
const EJECTA = [0x4e3a30, 0x6e5440, 0x8c6e52, 0xa98a6a, 0xc4a684, 0xdcc3a0] as const;
const EARTH_OUTLINE = 0x2e1e18;
const RIM_CREST = 0xe4cfae;

/** Bayer 4×4, 0–1: where two tones meet, which pixel takes which. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const dither = (x: number, y: number): number => BAYER[(y & 3) * 4 + (x & 3)] ?? 0.5;

/** Smooth noise 0–1 round a circle: `angle` 0–1, `bumps` to the turn. */
function aroundNoise(angle: number, bumps: number, salt: number): number {
  const at = angle * bumps;
  const i = Math.floor(at);
  const f = at - i;
  const a = cellHash(((i % bumps) + bumps) % bumps, salt, 604);
  const b = cellHash((((i + 1) % bumps) + bumps) % bumps, salt, 604);
  return a + (b - a) * (f * f * (3 - 2 * f));
}

/** The shape of a cone `width` pixels across: its ledges and how high each stands. */
export interface ConeShape {
  width: number;
  height: number;
  /** Where its foot's middle is, in the texture's pixels. */
  cx: number;
  cy: number;
  radius: number;
  ledges: number;
  /** Pixels each ledge stands above the one below it (its cliff's height). */
  lift: number;
  /** How far the scree round its foot reaches beyond the lowest ledge (pixels). */
  skirt: number;
}

/** How far a cone whose foot is `width` art pixels across rises above its foot's middle to its mouth. */
export function coneSummit(width: number): number {
  const shape = coneShape(Math.max(Math.round(width), 5));
  return shape.ledges * shape.lift;
}

/**
 * The shape of a cone whose lowest ledge is `foot` pixels across; its scree reaches
 * `SKIRT` of its radius further, and the texture holds both.
 */
export function coneShape(foot: number): ConeShape {
  const radius = foot / 2 - 1;
  const ledges = Math.min(Math.max(Math.round(radius / 9), 1), 3);
  const lift = Math.max(1, Math.round(radius * 0.17));
  const skirt = Math.max(2, Math.round(radius * SKIRT));
  const width = foot + 2 * skirt;
  const height = width + ledges * lift + 2;
  return { width, height, cx: width / 2, cy: height - width / 2, radius, ledges, lift, skirt };
}

/** The scree and ash round a cone's foot, as a share of its radius. */
const SKIRT = 0.35;
/** Frames of the lava's flow, looped; pixels it moves each frame. */
export const LAVA_FRAMES = 8;
const LAVA_STEP = 2;

/** Scree round the cone's foot, thinning into the ground: its colour, or null. */
function screePixel(shape: ConeShape, x: number, y: number): MarkPixel {
  const dx = x + 0.5 - shape.cx;
  const dy = y + 0.5 - shape.cy;
  const angle = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1;
  const foot = ledgeRadius(shape, 0, angle);
  const beyond =
    (Math.hypot(dx, dy) - foot) / (shape.skirt * (0.7 + 0.6 * aroundNoise(angle, 11, 30)));
  if (beyond < 0 || beyond >= 1) return null;
  // Thick by the foot, in clumps further out; dark ash and grey stones, a boulder or two.
  const clump = cellHash(Math.floor(x / 2), Math.floor(y / 2), 631) * 0.6 + dither(x, y) * 0.4;
  if (clump > Math.pow(1 - beyond, 1.4)) return null;
  const stone = boulder(x, y, 632);
  if (stone !== null && beyond < 0.6) return [stone, 255];
  const tone = cellHash(x, y, 633) < 0.3 + 0.4 * (1 - beyond) ? 0 : 1;
  return [SCREE[tone] ?? SCREE[0], 255];
}

/** How far ledge `i` reaches at `angle` (pixels from the middle); ledge `ledges` is the mouth. */
function ledgeRadius(shape: ConeShape, i: number, angle: number): number {
  // The summit (ledge `ledges`) is a broad rim round the mouth.
  const share = i === shape.ledges ? 0.38 : 1 - (i / shape.ledges) * 0.55;
  return shape.radius * share * (0.86 + 0.14 * aroundNoise(angle, 7 + i, 10 + i));
}

/** Where (x, y) falls: on the top of ledge i, on its face (below its south edge), or on neither. */
export function ledgeAt(
  shape: ConeShape,
  x: number,
  y: number,
): {
  kind: "top" | "face";
  ledge: number;
  dx: number;
  dy: number;
  d: number;
  /** Pixels in from the ledge's edge (tops only). */
  inside: number;
} | null {
  for (let i = shape.ledges; i >= 0; i--) {
    const top = shape.cy - i * shape.lift;
    const dx = x + 0.5 - shape.cx;
    const dy = y + 0.5 - top;
    const angle = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1;
    const reach = ledgeRadius(shape, i, angle);
    const d = Math.hypot(dx, dy);
    if (d <= reach) return { kind: "top", ledge: i, dx, dy, d: d / reach, inside: reach - d };
    // Its face: below its edge on the south side, down to the ledge it stands on.
    if (i > 0 && dy > 0) {
      for (let drop = 1; drop <= shape.lift; drop++) {
        const ddy = dy - drop;
        const a = (Math.atan2(ddy, dx) / (2 * Math.PI) + 1) % 1;
        if (Math.hypot(dx, ddy) <= ledgeRadius(shape, i, a)) {
          return { kind: "face", ledge: i, dx, dy: ddy, d: drop / shape.lift, inside: 0 };
        }
      }
    }
  }
  return null;
}

/** A boulder at (x, y) on a top, if one lies there: its colour. */
function boulder(x: number, y: number, salt: number): number | null {
  const bx = Math.floor(x / 5);
  const by = Math.floor(y / 4);
  if (cellHash(bx, by, salt) > 0.16) return null;
  const ox = Math.floor(cellHash(bx, by, salt + 1) * 3);
  const oy = Math.floor(cellHash(bx, by, salt + 2) * 2);
  const u = x - bx * 5 - ox;
  const v = y - by * 4 - oy;
  if (u < 0 || u > 2 || v < 0 || v > 1) return null;
  if (u === 0 && v === 0) return BOULDER[2] ?? null; // lit
  if (v === 1) return u === 2 ? OUTLINE : (BOULDER[0] ?? null);
  return BOULDER[1] ?? null;
}

/** The cone's pixel at (x, y), lava left out (it is its own layer). */
export function conePixel(shape: ConeShape, x: number, y: number, scree = true): MarkPixel {
  const at = ledgeAt(shape, x, y);
  if (at === null) return scree ? screePixel(shape, x, y) : null;
  const { kind, ledge, dx, dy, d, inside } = at;
  if (kind === "face") {
    // A cliff: strata in vertical streaks, darker toward its foot, cracked here and there.
    if (d >= 0.99) return [OUTLINE, 255];
    const streak = cellHash(Math.floor(x / 2), ledge, 611);
    let tone = d < 0.34 ? 2 : streak < 0.5 ? 1 : 0;
    if (cellHash(x, Math.floor(y / 3), 612) < 0.05) tone = 0;
    return [FACE[tone] ?? FACE[1], 255];
  }
  if (ledge === shape.ledges && d < MOUTH_SHARE) {
    // The mouth: its back wall (north) in shadow, then a floor of crust.
    const pit = d / MOUTH_SHARE;
    if (pit > 0.88) return [OUTLINE, 255];
    if (dy < 0 && pit > 0.45) return [FACE[pit > 0.7 ? 0 : 1] ?? FACE[0], 255];
    const plate = cellHash(Math.floor((x + 1) / 3), Math.floor(y / 2), 613);
    return [plate < 0.25 ? CRUST_CRACK : CRUST, 255];
  }
  // A top: lit facing the upper left; its rim catches the light along the north edge,
  // its south edge is outlined.
  const r = Math.hypot(dx, dy);
  const facing = r === 0 ? 0 : (-dx - dy) / (r * Math.SQRT2);
  // A line of light along its north edge, an outline along its south edge: one pixel.
  // The lowest ledge has no outline: it goes down into its scree.
  if (inside < 1 && dy > 0) return ledge === 0 ? [FACE[2] ?? OUTLINE, 255] : [OUTLINE, 255];
  if (inside < 1.2 && dy < 0 && facing > -0.3) return [RIM_LIGHT, 255];
  const stone = boulder(x, y, 620 + ledge);
  if (stone !== null && d < 0.82) return [stone, 255];
  // Rock in clumps of two or three pixels, so that it reads as stone, not as a gradient;
  // the brightest tone only along lit edges and on a few grains.
  const clump = cellHash(Math.floor(x / 3), Math.floor(y / 2), 614);
  const grain = cellHash(x, y, 619);
  let light = 1.3 + 0.75 * facing + (clump - 0.5) * 1.1;
  if (grain < 0.04) light += 1;
  const tone = Math.min(Math.max(Math.floor(light + 0.6 * (dither(x, y) - 0.5)), 0), 2);
  return [ROCK[tone] ?? ROCK[1], 255];
}

/** Rivers of lava down the cone: (angle, how far down) for each, from a hash. */
const RIVERS = 3;
/** The mouth's share of the summit ledge. */
const MOUTH_SHARE = 0.62;

/** Smooth noise 0–1 along a line: `t` in any units, `salt` to tell lines apart. */
function lineNoise(t: number, salt: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = cellHash(i, salt, 621);
  const b = cellHash(i + 1, salt, 621);
  return a + (b - a) * (f * f * (3 - 2 * f));
}

/** The lava's pixel at (x, y): the pool in the mouth, and the rivers. */
export function lavaPixel(shape: ConeShape, x: number, y: number, frame = 0): MarkPixel {
  // The lava moves: crust drifts across the pool and down the rivers, looping every
  // `LAVA_FRAMES` frames (its pattern repeats every `LAVA_FRAMES × LAVA_STEP` pixels).
  const period = LAVA_FRAMES * LAVA_STEP;
  const shift = frame * LAVA_STEP;
  const wrap = (n: number): number => ((n % period) + period) % period;
  const at = ledgeAt(shape, x, y);
  if (at?.kind === "top" && at.ledge === shape.ledges && at.d < MOUTH_SHARE) {
    const pit = at.d / MOUTH_SHARE;
    if (pit > 0.82) return null;
    if (at.dy < 0 && pit > 0.45) return null;
    // A pool of lava with plates of crust floating on it, hottest in the middle.
    // Small plates of crust, ragged, drifting on it.
    // Crust welling up in the middle and drifting outward to the rim, all round.
    const r = Math.hypot(at.dx, at.dy);
    const sector = Math.floor(
      ((Math.atan2(at.dy, at.dx) / (2 * Math.PI) + 1) % 1) * (6 + Math.floor(r)),
    );
    const ring = wrap(Math.round(r * 2) - shift);
    const plate = cellHash(sector, Math.floor(ring / 3), 615);
    if (plate < 0.2 && cellHash(sector, ring, 622) < 0.8) return [LAVA_CRUST, 255];
    // Its heat swells and ebbs.
    const swell = 0.08 * Math.sin((2 * Math.PI * frame) / LAVA_FRAMES);
    const hot = pit < 0.35 + swell ? 0 : pit < 0.6 + swell ? 1 : 2;
    return [LAVA[hot] ?? LAVA[1], 255];
  }
  if (at === null) return null;
  // Rivers run from the mouth down the south side, wavering, wider as they go.
  const mouth = shape.cy - shape.ledges * shape.lift;
  for (let k = 0; k < RIVERS; k++) {
    const heading = 0.08 + 0.34 * ((k + 0.5) / RIVERS) + 0.06 * (cellHash(k, 1, 616) - 0.5);
    const fall = (y + 0.5 - mouth) / (shape.height - mouth);
    if (fall < 0 || fall > 0.55 + 0.4 * cellHash(k, 2, 617)) continue;
    const spread = Math.cos(2 * Math.PI * heading) * shape.radius * fall * 1.1;
    // It meanders, finding its way down the slope.
    const wander = (lineNoise(fall * 7, k) - 0.5) * shape.radius * 0.35 * Math.min(fall * 3, 1);
    const river = shape.cx + spread + wander;
    const half = 0.6 + fall * shape.radius * 0.06;
    const off = Math.abs(x + 0.5 - river);
    if (off > half) continue;
    const down = wrap(y - shift);
    if (at.kind === "face") {
      // Falling over a cliff, it runs fast: bright, streaked.
      const streak = cellHash(x, Math.floor(wrap(y - 2 * shift) / 3), 623) < 0.25;
      return [LAVA[off < half * 0.5 && !streak ? 0 : 1] ?? LAVA[1], 255];
    }
    if (off > half * 0.7) return [LAVA[3] ?? LAVA[2], 255];
    // Crust floats down it, more as it cools; a brighter pulse rides the current.
    if (cellHash(x, Math.floor(down / 2), 618) < 0.06 + 0.16 * fall) return [LAVA_CRUST, 255];
    const pulse = cellHash(k, Math.floor(down / 4), 624) < 0.3;
    return [LAVA[off < half * (pulse ? 0.5 : 0.3) ? 1 : 2] ?? LAVA[2], 255];
  }
  return null;
}

/** Where a crater's rim stands, as a share of its texture's half width; its ejecta fill the rest. */
export const CRATER_RIM = 0.5;
/** The bowl's depth and the rim's height, in rim radii; how fast the ejecta thin outward. */
const BOWL_DEPTH = 0.42;
const RIM_HEIGHT = 0.18;
const EJECTA_FALL = 3;
/** The light, from the upper left and above (unit vector, y down the picture). */
const SUN = [-0.55, -0.55, 0.63] as const;

/** A crater's shape round its middle: how far its rim stands at `angle` (0–1), in rim radii. */
function rimReach(angle: number): number {
  // Scalloped where the walls slumped, a little long along the meteor's path (from the
  // upper right), never a perfect circle.
  const scallops =
    0.09 * (aroundNoise(angle, 7, 21) - 0.5) + 0.05 * (aroundNoise(angle, 17, 22) - 0.5);
  const along = 0.06 * Math.cos(4 * Math.PI * (angle - 0.875));
  return 1 + 2 * scallops + along;
}

/** The ground's height at (u, v) rim radii from a crater's middle (0 is the land round it). */
export function craterHeight(u: number, v: number): number {
  const angle = (Math.atan2(v, u) / (2 * Math.PI) + 1) % 1;
  const rho = Math.hypot(u, v) / rimReach(angle);
  // A slumped lobe: a tongue of the wall that slid toward the floor on the south east.
  const slump = Math.max(0, 1 - Math.hypot(u - 0.45, v - 0.45) / 0.38);
  if (rho < 1) {
    const bowl = RIM_HEIGHT - (RIM_HEIGHT + BOWL_DEPTH) * (1 - rho * rho);
    // The floor flat where the debris settled, rumpled.
    const floor = -BOWL_DEPTH * 0.82 + 0.02 * (valueAt(u * 6, v * 6, 23) - 0.5);
    return Math.max(bowl, floor) + 0.18 * slump * slump;
  }
  // The ejecta: thickest at the rim, thinning outward, lumpy.
  const blanket = RIM_HEIGHT * Math.pow(rho, -EJECTA_FALL);
  return blanket * (0.75 + 0.5 * valueAt(u * 5, v * 5, 24));
}

/** Smooth noise 0–1 on the plane. */
function valueAt(x: number, y: number, salt: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = cellHash(x0, y0, salt) * (1 - sx) + cellHash(x0 + 1, y0, salt) * sx;
  const bottom = cellHash(x0, y0 + 1, salt) * (1 - sx) + cellHash(x0 + 1, y0 + 1, salt) * sx;
  return top * (1 - sy) + bottom * sy;
}

/** Whether the rim keeps the sun off (u, v) (rim radii): a walk toward the light. */
function inShadow(u: number, v: number, step: number): boolean {
  const here = craterHeight(u, v);
  const climb = SUN[2] / Math.hypot(SUN[0], SUN[1]);
  for (let t = step; t < 2.2; t += step) {
    const along = Math.SQRT1_2 * t;
    if (craterHeight(u - along, v - along) > here + climb * t * 1.9) return true;
  }
  return false;
}

/**
 * A crater `size` pixels across (its ejecta's reach) at pixel (x, y): an uneven bowl with a
 * raised, scalloped rim, lit from the upper left so its far wall is bright and its near
 * wall in shadow; a slumped lobe on its floor; a rumpled blanket of thrown earth with
 * boulders, thinning into the ground; rays thrown away from where the meteor came.
 */
export function craterPixel(size: number, x: number, y: number): MarkPixel {
  const half = size / 2;
  const rim = half * CRATER_RIM;
  const u = (x + 0.5 - half) / rim;
  const v = (y + 0.5 - half) / rim;
  const angle = (Math.atan2(v, u) / (2 * Math.PI) + 1) % 1;
  const rho = Math.hypot(u, v) / rimReach(angle);
  const far = Math.hypot(u, v) * CRATER_RIM;
  if (far > 1) return null;
  const pixel = 1 / rim;
  const outside = rho >= 1;

  // How much of the ground the blanket covers: all near the rim, then patchy, then rays.
  let cover = outside ? 1 - (rho - 1) / 0.6 : 1;
  const ray = aroundNoise(angle, 19, 25);
  // Rays thrown downrange (away from the meteor's upper right), none uprange.
  const downrange = 0.5 + 0.5 * Math.cos(2 * Math.PI * (angle - 0.625));
  if (outside && cover < 1) {
    const reach = ray > 0.6 ? (ray - 0.6) * 2.5 * downrange : 0;
    cover = Math.max(cover, reach * (1 - (far - CRATER_RIM) / (1 - CRATER_RIM)) * 1.4);
  }
  if (cover <= 0) return null;
  if (outside && cover < 1) {
    // Thinning out: clods of earth, more of them where it is thicker.
    const clod = cellHash(Math.floor(x / 2), Math.floor(y / 2), 26) * 0.6 + dither(x, y) * 0.4;
    if (clod > cover) return null;
  }

  const stone = outside && rho < 1.8 ? boulder(x, y, 640) : null;
  if (stone !== null) return [stone, 255];

  // The slope's light: the height field's gradient against the sun.
  const dhx = (craterHeight(u + pixel, v) - craterHeight(u - pixel, v)) / (2 * pixel);
  const dhy = (craterHeight(u, v + pixel) - craterHeight(u, v - pixel)) / (2 * pixel);
  const relief = 2.6;
  const nx = -dhx * relief;
  const ny = -dhy * relief;
  const lit = (nx * SUN[0] + ny * SUN[1] + SUN[2]) / Math.hypot(nx, ny, 1);
  let light = (lit - SUN[2]) * 2.2; // flat ground 0, facing the sun > 0
  const shade = !outside && inShadow(u, v, pixel * 1.5);
  if (shade) light = Math.min(light, -0.45) - 0.1;
  if (!outside) light -= 0.12 * (1 - rho); // deeper is darker: the floor sees less sky
  const grain = (cellHash(x, y, 27) - 0.5) * 0.35;
  // Fresh ejecta is paler than the ground it lies on.
  const tone = Math.round((outside ? 3 : 2) + light * 2 + grain + (dither(x, y) - 0.5) * 0.9);
  const ramp = outside ? EJECTA : BOWL;
  // Shadow is cool and never black: the sky lights it.
  const lowest = outside ? 1 : 0;
  const colour =
    ramp[Math.min(Math.max(tone, lowest), ramp.length - 1)] ?? ramp[2] ?? EARTH_OUTLINE;
  // The rim's crest catches the light where it faces the sun; the floor's middle is scorched.
  if (rho > 0.97 && rho < 1.03 && light > 0.35 && dither(x, y) < 0.6) return [RIM_CREST, 255];
  if (!outside && rho < 0.3 && cellHash(x, y, 28) < 0.25 * (1 - rho / 0.3)) {
    return [BOWL[1], 255];
  }
  return [colour, 255];
}

const made = new Map<string, { texture: Texture; cx: number; cy: number }>();

function paint(
  width: number,
  height: number,
  pixelOf: (x: number, y: number) => MarkPixel,
): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for a mark");
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = pixelOf(x, y);
      if (pixel === null) continue;
      const [colour, alpha] = pixel;
      const at = (y * width + x) * 4;
      image.data[at] = colour >> 16;
      image.data[at + 1] = (colour >> 8) & 255;
      image.data[at + 2] = colour & 255;
      image.data[at + 3] = Math.min(Math.max(alpha, 0), 255);
    }
  }
  context.putImageData(image, 0, 0);
  return new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }) });
}

/**
 * The texture of a `kind` mark whose foot is `size` art pixels across, made once for
 * each size, and where its foot's middle is in it (pixels): a cone stands up out of its
 * square, so its foot is low in the texture.
 */
export function markTexture(
  kind: "cone" | "scree" | "lava" | "crater",
  size: number,
  frame = 0,
): { texture: Texture; cx: number; cy: number } {
  const across = Math.max(Math.round(size), 5);
  const key = `${kind}:${across}:${frame}`;
  const known = made.get(key);
  if (known !== undefined) return known;
  let mark: { texture: Texture; cx: number; cy: number };
  if (kind === "crater") {
    mark = {
      texture: paint(across, across, (x, y) => craterPixel(across, x, y)),
      cx: across / 2,
      cy: across / 2,
    };
  } else {
    const shape = coneShape(across);
    mark = {
      texture: paint(shape.width, shape.height, (x, y) =>
        kind === "cone"
          ? conePixel(shape, x, y, false)
          : kind === "scree"
            ? ledgeAt(shape, x, y) === null
              ? screePixel(shape, x, y)
              : null
            : lavaPixel(shape, x, y, frame),
      ),
      cx: shape.cx,
      cy: shape.cy,
    };
  }
  made.set(key, mark);
  return mark;
}
