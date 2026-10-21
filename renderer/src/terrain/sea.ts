/**
 * The sea moves (cosy look, after Stardew Valley's water), at almost no cost per frame:
 *
 *   shore   (R4) waves drawn by a shader from the shore's data the painter leaves
 *           (`Pixels.shore`: each pixel's distance from the shore, when the waves come
 *           there): lines of lighter water roll in from out at sea, narrowing and
 *           brightening, and break in foam at the shore; the swash runs up the sand with
 *           a foam edge, drains back, and leaves a stripe of wet sand that dries. Each
 *           place on its own clock (`tide.ts` `tidePhase`), so a wave runs along a coast; the
 *           tide sets how far the swash runs. After how pixel water is drawn top-down:
 *           waves from open water fading out on the beach, foam only while the water
 *           rises (ADR 0021). One filter pass a view; the map has no swash.
 *   glints  short light strokes on the open water that grow, drift a little with the
 *           waves and go, each on its own clock, in new places every time; a few dozen
 *           sprites of one white texture, moved a frame
 *
 * Nothing is painted again for it. Where a glint shows is a hash of its slot and of how
 * many times it has shown, so the sea looks the same at the same moment on every run.
 */
import {
  Container,
  Filter,
  GlProgram,
  Sprite,
  Texture,
  UniformGroup,
  defaultFilterVert,
} from "pixi.js";
import type { CellRect, Land } from "./land";
import { cellHash } from "./pixels";
import { BREATH_S, shoreSizes } from "./tide";

export { BREATH_S, tidePhase } from "./tide";

/** Seconds of a tide, which sets how far the swash runs (its least and most). */
const TIDE_S = 60;
const TIDE_LOW = 0.55;
/** The swash's colours: foam, and how dark the sand it leaves is (share of black). */
const FOAM = 0xf2fbff;
const WET_SAND = 0.18;
/** Seconds between two showings of a glint (from, to), and the share of that it shows. */
const GLINT_EVERY_S: readonly [number, number] = [2.4, 5.2];
const GLINT_SHOWS = 0.42;
/** Longest stroke of a glint, in art pixels, by art pixels to the cell; how fast it drifts. */
const GLINT_LENGTH = (tile: number): number => (tile >= 32 ? 8 : tile >= 8 ? 4 : 1);
const GLINT_DRIFT_PX_PER_S = 2.5;
/** Glints are kept off water shallower than this, so that they do not crowd the foam. */
const GLINT_DEPTH = 0.012;
const GLINT_ALPHA = 1;
/** Slots per view: glints that land on land wait for their next showing. */
export const GLINT_SLOTS = 40;

/** Height between cells, interpolated as the painter reads it (x, y in cells from the corner). */
function heightAt(land: Land, x: number, y: number): number {
  const { width, height, heights } = land;
  const u = x - 0.5;
  const v = y - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const at = (cx: number, cy: number): number =>
    heights[Math.min(Math.max(cy, 0), height - 1) * width + Math.min(Math.max(cx, 0), width - 1)] ??
    0;
  return (
    (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
    (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
  );
}

/** What the sea is at a place: its colour (0xRRGGBB) and how deep, 0–1 down to the palette's deepest band. */
export type SeaAt = (x: number, y: number) => { colour: number; depth: number } | null;

/**
 * The sea of `land` at a place (x, y in cells from the world's corner), as the ground
 * paints it: the colour of its depth band, and its depth as a share of the way down to
 * the deepest band; null on land. For creatures under water to take its colour (R2).
 */
export function seaAt(land: Land): SeaAt {
  const bands = land.relief.seaBands.map((band) => ({
    limit: band.limit,
    colour: Number.parseInt(band.colour.replace("#", ""), 16),
  }));
  // The last band reaches to any depth: depth 1 is where the one before it ends.
  const deepest = bands.length > 1 ? (bands[bands.length - 2]?.limit ?? 1) : 1;
  return (x, y) => {
    const below = land.seaLevel - heightAt(land, x, y);
    if (below <= 0) return null;
    const band = bands.find((candidate) => below <= candidate.limit) ?? bands[bands.length - 1];
    return { colour: band?.colour ?? 0, depth: Math.min(below / deepest, 1) };
  };
}

/** Which showing of glint `slot` it is at `timeS`, and how far through it (0–1). */
export function glintShowing(slot: number, timeS: number): { showing: number; phase: number } {
  const [shortest, longest] = GLINT_EVERY_S;
  const every = shortest + (longest - shortest) * cellHash(slot, 0, 201);
  const shifted = timeS + every * cellHash(slot, 0, 202);
  const showing = Math.floor(shifted / every);
  return { showing, phase: (shifted - showing * every) / every };
}

/**
 * Where glint `slot` is at `timeS`, and how long its stroke is (art pixels), if it shows.
 * It is placed somewhere in `view`, the view as it was when this showing began: a glint
 * lies on the water, and stays there while the camera moves.
 */
export function glintAt(
  land: Land,
  slot: number,
  timeS: number,
  view: CellRect,
  tile: number,
): { x: number; y: number; length: number } | null {
  const [shortest, longest] = GLINT_EVERY_S;
  const every = shortest + (longest - shortest) * cellHash(slot, 0, 201);
  const { showing, phase } = glintShowing(slot, timeS);
  if (phase >= GLINT_SHOWS) return null;
  const x =
    view.x0 +
    (view.x1 - view.x0) * cellHash(slot, showing, 203) +
    (GLINT_DRIFT_PX_PER_S * phase * every) / tile;
  const y = view.y0 + (view.y1 - view.y0) * cellHash(slot, showing, 204);
  if (x < 0 || y < 0 || x >= land.width || y >= land.height) return null;
  if (heightAt(land, x, y) > land.seaLevel - GLINT_DEPTH) return null;
  // It grows and goes again: longest halfway through its showing.
  const length = Math.max(
    1,
    Math.round(GLINT_LENGTH(tile) * Math.sin((Math.PI * phase) / GLINT_SHOWS)),
  );
  return { x, y, length };
}

/** How much of the foam's colour the rolling wave lines take. */
const SWELL_MIX = 0.45;

interface ShoreUniforms {
  uTime: number;
  uTide: number;
  uShallow: number[];
  uSwell: number[];
}

const rgbOf = (colour: number): number[] => [
  ((colour >> 16) & 255) / 255,
  ((colour >> 8) & 255) / 255,
  (colour & 255) / 255,
];
const mixRgb = (a: number[], b: number[], t: number): number[] =>
  a.map((v, i) => v + ((b[i] ?? v) - v) * t);

/**
 * The shore's shader. Its input is the painter's shore data (`Pixels.shore`), drawn whole
 * art pixel to whole canvas pixel, so whatever it draws keeps hard pixel edges.
 *
 *   at sea    a wave line every `uSpacing` pixels rolls in one spacing a turn (`uTime` in
 *             turns, plus the place's own share of a turn): seen from `uReach` out, faint
 *             and broken far out, wider, brighter and whole as it nears the shore, white at
 *             the last two pixels, where it breaks
 *   on land   after the break the swash runs up `uSwash` × `uTide` pixels, easing in and out,
 *             its edge white foam while it rises; it drains more slowly, and the sand it left
 *             is dark with water, drying as the next wave comes
 */
const SHORE_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uTime;
uniform float uTide;
uniform float uSpacing;
uniform float uReach;
uniform float uSwash;
uniform float uWet;
uniform vec3 uShallow;
uniform vec3 uSwell;
uniform vec3 uFoam;

float ease(float t) { t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }

void main(void) {
  vec4 data = texture(uTexture, vTextureCoord);
  if (data.a < 0.5) { finalColor = vec4(0.0); return; }
  float out_ = floor(data.r * 255.0 + 0.5);
  float inland = floor(data.g * 255.0 + 0.5);
  float b = floor(data.b * 255.0 + 0.5);
  float when = floor(b / 4.0) / 63.0;
  float noise = mod(b, 4.0) / 3.0;
  float turn = fract(uTime + when);
  vec4 colour = vec4(0.0);
  if (out_ > 0.0) {
    if (out_ <= uReach) {
      float near = 1.0 - (out_ - 1.0) / uReach;
      float k = fract((out_ - 1.0) / uSpacing + turn);
      float width = (1.0 + 1.5 * near * near) / uSpacing;
      // Each pixel takes its foam a little before or after its neighbours (its noise), so
      // a line comes and goes raggedly, over a few frames, never along a coast at once.
      float jitter = (noise - 0.5) * 0.6 * width;
      if (k + jitter < width && k + jitter > -0.5 * width) {
        if (out_ <= 2.0) colour = vec4(uFoam, 1.0);
        else if (noise < 0.25 + 0.9 * near) colour = vec4(mix(uSwell, uFoam, near * near * 0.6), 0.3 + 0.6 * near);
      }
    }
    // Foam lingering along the water's edge.
    if (out_ <= 1.0 && noise > 0.34) colour = vec4(uFoam, max(colour.a, 0.75));
  } else if (uSwash > 0.0) {
    float top = uSwash * uTide;
    float up = 0.0;
    bool rising = turn < 0.3;
    if (rising) up = top * ease(turn / 0.3);
    else if (turn < 0.8) up = top * (1.0 - ease((turn - 0.3) / 0.5));
    // The water's edge is ragged by a pixel (the noise), so it creeps up the sand.
    float edge = up + (noise - 0.5) * 1.2;
    if (inland <= edge) {
      colour = (rising && inland > edge - 1.5) ? vec4(uFoam, 1.0) : vec4(uShallow, 0.82);
    } else if (!rising && inland <= top) {
      colour = vec4(0.0, 0.0, 0.0, uWet * (1.0 - (turn - 0.3) / 0.7));
    }
  }
  finalColor = vec4(colour.rgb * colour.a, colour.a);
}
`;

/** The moving sea of one view. */
export class Sea {
  /** Add this to the world over the ground and its surf. */
  readonly glints = new Container();
  private readonly sprites: Sprite[] = [];
  /** Each slot's showing, and the view it was placed in when that showing began. */
  private readonly placed: { showing: number; view: CellRect }[] = [];

  /** The shore's shader and its uniforms (`SHORE_FRAGMENT`). */
  private readonly shore: Filter;
  private readonly shoreUniforms: UniformGroup;

  constructor(
    private readonly tile: number,
    slots = GLINT_SLOTS,
  ) {
    const sizes = shoreSizes(tile);
    this.shoreUniforms = new UniformGroup({
      uTime: { value: 0, type: "f32" },
      uTide: { value: 1, type: "f32" },
      uSpacing: { value: sizes.spacing, type: "f32" },
      uReach: { value: sizes.reach, type: "f32" },
      uSwash: { value: sizes.swash, type: "f32" },
      uWet: { value: WET_SAND, type: "f32" },
      uShallow: { value: [0.55, 0.8, 0.9], type: "vec3<f32>" },
      uSwell: { value: [0.75, 0.9, 0.95], type: "vec3<f32>" },
      uFoam: { value: rgbOf(FOAM), type: "vec3<f32>" },
    });
    this.shore = new Filter({
      glProgram: GlProgram.from({
        vertex: defaultFilterVert,
        fragment: SHORE_FRAGMENT,
        name: "shore",
      }),
      resources: { shoreUniforms: this.shoreUniforms },
      resolution: 1,
      antialias: "off",
    });
    for (let slot = 0; slot < slots; slot++) {
      const sprite = new Sprite(Texture.WHITE);
      sprite.alpha = GLINT_ALPHA;
      sprite.visible = false;
      this.sprites.push(sprite);
      this.glints.addChild(sprite);
    }
  }

  /**
   * Move the sea on to `timeS` (wall seconds) over `view`; `surf` is the layer of the
   * ground's shore data, which the shore's shader draws as waves.
   */
  tick(timeS: number, land: Land, view: CellRect, surf: readonly Container[] | null): void {
    const layer = surf?.[0];
    if (layer !== undefined) {
      const filters = layer.filters as readonly Filter[] | null | undefined;
      if (!(filters?.includes(this.shore) ?? false)) layer.filters = [this.shore];
      const tide =
        TIDE_LOW + (1 - TIDE_LOW) * (0.5 + 0.5 * Math.sin((2 * Math.PI * timeS) / TIDE_S));
      const shallow = land.relief.seaBands[0]?.colour ?? "#8ecbe6";
      const uniforms = this.shoreUniforms.uniforms as unknown as ShoreUniforms;
      uniforms.uTime = timeS / BREATH_S;
      uniforms.uTide = tide;
      uniforms.uShallow = rgbOf(Number.parseInt(shallow.replace("#", ""), 16));
      uniforms.uSwell = mixRgb(uniforms.uShallow, rgbOf(FOAM), SWELL_MIX);
    }
    const { tile } = this;
    // Texture.WHITE is 16 texels: sized in cells, a stroke `length` art pixels long and one tall.
    const texel = Texture.WHITE.width;
    this.sprites.forEach((sprite, slot) => {
      const { showing } = glintShowing(slot, timeS);
      let placed = this.placed[slot];
      if (placed?.showing !== showing) {
        placed = { showing, view: { ...view } };
        this.placed[slot] = placed;
      }
      const glint = glintAt(land, slot, timeS, placed.view, tile);
      sprite.visible = glint !== null;
      if (glint === null) return;
      // On whole art pixels, as everything else.
      sprite.position.set(Math.round(glint.x * tile) / tile, Math.round(glint.y * tile) / tile);
      sprite.scale.set(glint.length / tile / texel, 1 / tile / texel);
    });
  }
}
