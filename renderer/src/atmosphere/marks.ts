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
 *   lava     the eruption's own layer, drawn over the cone without the scene's tint: a pool
 *            of crusted lava in the mouth, rivers running down its south side, falling
 *            bright over each cliff
 *   crater   a raised rim with its own face, the inner wall of the bowl's far side showing,
 *            a scorched glassy floor with cracks, rays of thrown debris, scattered boulders
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
const RIM_LIGHT = 0xb79c8c;
const BOULDER = [0x4a3a3e, 0x6e5a58, 0xa48c80] as const;
/** The mouth's cold floor: crust plates, and the cracks between them. */
const CRUST = 0x231a1c;
const CRUST_CRACK = 0x3e2a26;
/** Lava, hottest first, and the crust that floats on it. */
const LAVA = [0xfff1a6, 0xffc44a, 0xff8a2a, 0xd8461c] as const;
const LAVA_CRUST = 0x401c18;
/** A crater's earth: rim tops, faces, outline; its scorched floor and glassy cracks; debris. */
const EARTH = [0x6a503e, 0x8a6c52, 0xae8f6e, 0xcbb08e] as const;
const EARTH_FACE = [0x4a3428, 0x5e4434] as const;
const EARTH_OUTLINE = 0x2e1e18;
const SCORCH = 0x2b2224;
const GLASS = 0x5a5468;
const DEBRIS = [0x8a6c52, 0xb4977a] as const;

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
}

/** How far a cone whose foot is `width` art pixels across rises above its foot's middle to its mouth. */
export function coneSummit(width: number): number {
  const shape = coneShape(Math.max(Math.round(width), 5));
  return shape.ledges * shape.lift;
}

export function coneShape(width: number): ConeShape {
  const radius = width / 2 - 1;
  const ledges = Math.min(Math.max(Math.round(radius / 9), 1), 3);
  const lift = Math.max(1, Math.round(radius * 0.17));
  const height = width + ledges * lift + 2;
  return { width, height, cx: width / 2, cy: height - width / 2, radius, ledges, lift };
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
export function conePixel(shape: ConeShape, x: number, y: number): MarkPixel {
  const at = ledgeAt(shape, x, y);
  if (at === null) return null;
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
  if (inside < 1 && dy > 0) return [OUTLINE, 255];
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
export function lavaPixel(shape: ConeShape, x: number, y: number): MarkPixel {
  const at = ledgeAt(shape, x, y);
  if (at?.kind === "top" && at.ledge === shape.ledges && at.d < MOUTH_SHARE) {
    const pit = at.d / MOUTH_SHARE;
    if (pit > 0.82) return null;
    if (at.dy < 0 && pit > 0.45) return null;
    // A pool of lava with plates of crust floating on it, hottest in the middle.
    // Small plates of crust, ragged, drifting on it.
    const plate = cellHash(Math.floor(x / 2), Math.floor((y + (x >> 2)) / 2), 615);
    if (plate < 0.16 && cellHash(x, y, 622) < 0.8) return [LAVA_CRUST, 255];
    const hot = pit < 0.35 ? 0 : pit < 0.6 ? 1 : 2;
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
    if (at.kind === "face") return [LAVA[off < half * 0.5 ? 0 : 1] ?? LAVA[1], 255];
    if (off > half * 0.7) return [LAVA[3] ?? LAVA[2], 255];
    if (cellHash(x, Math.floor(y / 2), 618) < 0.12 * fall) return [LAVA_CRUST, 255];
    return [LAVA[off < half * 0.3 ? 1 : 2] ?? LAVA[2], 255];
  }
  return null;
}

/** A crater `size` pixels across at pixel (x, y). */
export function craterPixel(size: number, x: number, y: number): MarkPixel {
  const r = size / 2;
  const dx = x + 0.5 - r;
  const dy = y + 0.5 - r;
  const angle = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1;
  const edge = 0.9 + 0.1 * aroundNoise(angle, 9, 3);
  const d = Math.hypot(dx, dy) / r / edge;
  const facing = d === 0 ? 0 : (-dx - dy) / (Math.hypot(dx, dy) * Math.SQRT2);
  const lip = Math.max(1, Math.round(size * 0.04));
  if (d > 1) return null;
  if (d > 0.82) {
    // Thrown debris: rays out from the rim, and stones.
    const ray = aroundNoise(angle, 23, 7);
    const stone = boulder(x, y, 640);
    if (stone !== null && cellHash(x, y, 641) < 0.6) return [stone, 255];
    if (ray > 0.62 && cellHash(x, y, 642) < (ray - 0.62) * 2.2 * (1 - d) * 5) {
      return [DEBRIS[cellHash(x, y, 643) < 0.5 ? 0 : 1] ?? DEBRIS[0], 255];
    }
    return null;
  }
  if (d > 0.66) {
    // The rim stands up: its top lit toward the upper left, outlined outside; on the south
    // its outer face shows below it.
    if (d > 0.79 && dy > 0) return [EARTH_OUTLINE, 255];
    if (d > 0.76 && dy > r * 0.2) return [EARTH_FACE[0] ?? EARTH_OUTLINE, 255];
    const light = 1.4 + 1.3 * facing + (cellHash(x, y, 644) - 0.5) * 0.7;
    const tone = Math.min(Math.max(Math.floor(light + dither(x, y) - 0.5), 0), 3);
    return [EARTH[tone] ?? EARTH[1], 255];
  }
  // Inside: the far (north) wall's face shows below the rim; the floor is scorched, glassy
  // cracks running out from the strike, the bared ground showing between.
  const wallDepth = (0.66 - d) * r;
  if (dy < 0 && wallDepth < lip * 3 && facing > -0.6) {
    const tone = cellHash(Math.floor(x / 2), 1, 645) < 0.5 ? 0 : 1;
    if (wallDepth < 1) return [EARTH_OUTLINE, 255];
    return [EARTH_FACE[tone] ?? EARTH_FACE[0], 255];
  }
  const crack = aroundNoise(angle, 13, 9);
  if (d < 0.5 && crack > 0.78 && cellHash(x, y, 646) < 0.8) return [GLASS, 255];
  if (d < 0.18) return [SCORCH, 230];
  if (d < 0.5) return [SCORCH, Math.round(170 * (1 - d / 0.5) * (0.6 + 0.4 * dither(x, y)))];
  return null;
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
  kind: "cone" | "lava" | "crater",
  size: number,
): { texture: Texture; cx: number; cy: number } {
  const across = Math.max(Math.round(size), 5);
  const key = `${kind}:${across}`;
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
    const pixelOf = kind === "cone" ? conePixel : lavaPixel;
    mark = {
      texture: paint(shape.width, shape.height, (x, y) => pixelOf(shape, x, y)),
      cx: shape.cx,
      cy: shape.cy,
    };
  }
  made.set(key, mark);
  return mark;
}
