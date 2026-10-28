/**
 * The ground's colour pass on the GPU (R5, the optimization plan; the owner, 2026-10-28:
 * "if the result with the shader is identical to the eye and not byte per byte, then
 * fine"). The pass that works out every pixel's colour, whether it is land, and for a
 * close view what it is made of, was three quarters of a painting's time on the CPU; here
 * one fragment shader does it, in the painter's own WebGL2 context (an `OffscreenCanvas`
 * in its worker), and its pixels are read back there. The passes after it (the lip of
 * growth, the detail, shadows, burnt ground, the shore) stay on the CPU, as they were.
 *
 * The shader is `paintGround`'s loop written again in GLSL, its constants written into it
 * from the same TypeScript constants. The GPU's floats are single, not double: a pixel
 * on the edge of a threshold may fall the other way, nothing an eye can tell.
 */
import { GROUND_TURN } from "../plants/turning";
import { GROUND_CONSTANTS as K } from "./ground";

/** Packed 0xRRGGBB. */
type Rgb = number;
type Ramp = readonly [Rgb, Rgb, Rgb];

/** What the colour pass is worked out from (`paintGround` gathers it). */
export interface ColourPassInput {
  world: {
    width: number;
    height: number;
    heights: Float32Array;
    seaLevel: number;
    /** Per cell: 1 for sea; the kind of growth (0 bare, 1–5 forms, 6 burnt); biomass 0–255. */
    sea: Uint8Array;
    kind: Uint8Array;
    biomass: Uint8Array;
    snow?: Uint8Array;
    algae?: Uint8Array;
  };
  /** The painting: its size in pixels, its first pixel in the world's pixels. */
  wide: number;
  tall: number;
  originX: number;
  originY: number;
  tile: number;
  /** Pixels painted in full; past them only land or sea (`GroundOptions.shown`). */
  full: { x0: number; y0: number; x1: number; y1: number } | null;
  interpolated: boolean;
  dithered: boolean;
  close: boolean;
  detailed: boolean;
  grain: boolean;
  calm: number;
  /** The calm view's field (`paintGround`): shares and growth of each kind, land, height. */
  field: {
    x: number;
    y: number;
    wide: number;
    tall: number;
    shares: Float32Array;
    growth: Float32Array;
    land: Uint8Array;
    heights: Float32Array;
  };
  mixClass: number;
  mixSlope: number;
  fine: number;
  bladeRows: number;
  dash: number;
  relief: { slope: number; snowFrom: number; highRockFrom: number };
  dryBelow: number;
  /** For each of the five forms, whether it dries. */
  dries: readonly boolean[];
  /** Each season's dry ramp and the five forms' ramps, spring first. */
  seasons: readonly { dry: Ramp; ramps: readonly Ramp[]; snowing: boolean }[];
  /** The season everywhere (an index into `SEASONS`), or each place's own in a turn. */
  season: number;
  turn: { phase: number; hills: number } | null;
  bare: Ramp;
  rock: Ramp;
  snow: Ramp;
  burnt: Ramp;
  sand: Rgb;
  foam: Rgb;
  litter: Rgb;
  bands: readonly { limit: number; colour: Rgb }[];
}

/** What the colour pass gives the passes after it. */
export interface ColourPassOutput {
  colours: Uint32Array;
  isLand: Uint8Array;
  matter: Uint8Array;
  toned: Uint8Array;
  thick: Uint8Array;
}

/** Sea bands the shader takes at most. */
const MOST_BANDS = 8;

const float = (value: number): string => {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
};

/** The colour pass in GLSL ES 3.00: `paintGround`'s loop, pixel for pixel. */
export function colourShader(): string {
  const T = GROUND_TURN;
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uHeights;   // R32F, the world's heights
uniform sampler2D uCells;     // RGBA8: sea, kind, biomass
uniform sampler2D uSnow;      // R8
uniform sampler2D uAlgae;     // R8
uniform sampler2D uField;     // RGBA32F, four texels a cell of the calm field
uniform ivec2 uWorld;
uniform float uSeaLevel;
uniform ivec2 uOrigin;
uniform float uTile;
uniform ivec4 uFull;          // x0, y0, x1, y1; x0 > x1 for none
uniform int uFlags;           // 1 interpolated, 2 dithered, 4 close, 8 detailed, 16 grain, 32 snow cells, 64 algae
uniform int uCalm;
uniform ivec4 uFieldBox;      // x, y, wide, tall
uniform float uMixClass;
uniform float uMixSlope;
uniform float uFine;
uniform int uBladeRows;
uniform int uDash;
uniform vec3 uRelief;         // slope, snowFrom, highRockFrom
uniform float uDryBelow;
uniform int uDries;           // a bit for each form
uniform ivec3 uDry[12];       // season * 3 + step
uniform ivec3 uForms[60];     // season * 15 + form * 3 + step
uniform int uSnowing;         // a bit for each season
uniform int uSeason;
uniform vec3 uTurn;           // phase, hills, 1 in a turn
uniform ivec3 uBare[3];
uniform ivec3 uRock[3];
uniform ivec3 uSnowRamp[3];
uniform ivec3 uBurnt[3];
uniform ivec3 uSand;
uniform ivec3 uFoam;
uniform ivec3 uLitter;
uniform float uBandLimits[${MOST_BANDS}];
uniform ivec3 uBandColours[${MOST_BANDS}];
uniform int uBands;

layout(location = 0) out vec4 outColour;  // rgb; a: land + 2 * tone
layout(location = 1) out vec4 outMatter;  // r: what it is made of, g: how thick

const float WOBBLE = ${float(K.WOBBLE)};
const float WOBBLE_FREQUENCY = ${float(K.WOBBLE_FREQUENCY)};
const float FINE_WOBBLE = ${float(K.FINE_WOBBLE)};
const float FINE_FREQUENCY = ${float(K.FINE_FREQUENCY)};
const float KIND_WANDER = ${float(K.KIND_WANDER)};
const float KIND_WANDER_FREQUENCY = ${float(K.KIND_WANDER_FREQUENCY)};
const float PATCH = ${float(K.PATCH)};
const float SNOW_PATCH = ${float(K.SNOW_PATCH)};
const float SNOW_UNDER_TREES = ${float(K.SNOW_UNDER_TREES)};
const float SNOW_OPEN = ${float(K.SNOW_OPEN)};
const float SNOW_FULL_FROM = ${float(K.SNOW_FULL_FROM)};
const float DRY_DRIFT = ${float(K.DRY_DRIFT)};
const float CALM_PATCH = ${float(K.CALM_PATCH)};
const float CALM_RAGGED = ${float(K.CALM_RAGGED)};
const float EDGE_FROM = ${float(K.EDGE_FROM)};
const float EDGE_TO = ${float(K.EDGE_TO)};
const float GRIT = ${float(K.GRIT)};
const float WAVES = ${float(K.WAVES)};
const float ALGAE_FULL = ${float(K.ALGAE_FULL)};
const float ALGAE_CLUMP = ${float(K.ALGAE_CLUMP)};
const float ALGAE_COVER = ${float(K.ALGAE_COVER)};
const float ALGAE_MIX = ${float(K.ALGAE_MIX)};
const float MIX_DEPTH = ${float(K.MIX_DEPTH)};
const float BEACH = ${float(K.BEACH)};
const int BURNT = ${K.BURNT};
const int LOW = ${K.LOW};
const int KINDS = ${K.BURNT + 1};
const float FRONT_CELLS = ${float(T.FRONT_CELLS)};
const float FRONT = ${float(T.FRONT)};
const float HEIGHT = ${float(T.HEIGHT)};
const float HILLS = ${float(T.HILLS)};
const float DITHER = ${float(T.DITHER)};
const float TURN_SEASONS = ${float(T.TURN_SEASONS)};
const ivec3 ALGAE_COLOURS[2] = ivec3[2](${K.ALGAE.map(ivec3).join(", ")});
const vec2 COVERAGE[${K.COVERAGE.length}] = vec2[${K.COVERAGE.length}](${K.COVERAGE.map(
    ([thin, full]) => `vec2(${float(thin)}, ${float(full)})`,
  ).join(", ")});
const float FLOOR_LITTER[${K.FLOOR_LITTER.length}] = float[${K.FLOOR_LITTER.length}](${K.FLOOR_LITTER.map(
    float,
  ).join(", ")});
const float BAYER[16] = float[16](${K.BAYER.map(float).join(", ")});
const int MATTER_OF[${K.MATTER_OF.length}] = int[${K.MATTER_OF.length}](${K.MATTER_OF.join(", ")});
const int SEA_MATTER = ${K.MATTER.sea};
const int SAND = ${K.MATTER.sand};
const int SOIL = ${K.MATTER.soil};
const int ROCK = ${K.MATTER.rock};
const int SNOW = ${K.MATTER.snow};
const int LICHEN = ${K.MATTER.lichen};
const int DRY = ${K.MATTER.dry};

bool flag(int bit) { return (uFlags & bit) != 0; }

// cellHash: the same 32-bit integer hash as the CPU's, its top 24 bits as a fraction.
float cellHash(int x, int y, int salt) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(salt) * 1274126177u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return float(h >> 8u) / 16777216.0;
}

float valueNoise(float x, float y, int salt) {
  float fx0 = floor(x);
  float fy0 = floor(y);
  int x0 = int(fx0);
  int y0 = int(fy0);
  float fx = x - fx0;
  float fy = y - fy0;
  float sx = fx * fx * (3.0 - 2.0 * fx);
  float sy = fy * fy * (3.0 - 2.0 * fy);
  float top = cellHash(x0, y0, salt) * (1.0 - sx) + cellHash(x0 + 1, y0, salt) * sx;
  float bottom = cellHash(x0, y0 + 1, salt) * (1.0 - sx) + cellHash(x0 + 1, y0 + 1, salt) * sx;
  return top * (1.0 - sy) + bottom * sy;
}

int clampX(int x) { return clamp(x, 0, uWorld.x - 1); }
int clampY(int y) { return clamp(y, 0, uWorld.y - 1); }
float heightCell(int x, int y) { return texelFetch(uHeights, ivec2(clampX(x), clampY(y)), 0).r; }

float heightAt(float u, float v) {
  float fx0 = floor(u);
  float fy0 = floor(v);
  int x0 = int(fx0);
  int y0 = int(fy0);
  float fx = u - fx0;
  float fy = v - fy0;
  float top = heightCell(x0, y0) * (1.0 - fx) + heightCell(x0 + 1, y0) * fx;
  float bottom = heightCell(x0, y0 + 1) * (1.0 - fx) + heightCell(x0 + 1, y0 + 1) * fx;
  return top * (1.0 - fy) + bottom * fy;
}

// Between cells, as the CPU reads the snow and the algae.
float gridAt(sampler2D grid, float u, float v) {
  float fx0 = floor(u);
  float fy0 = floor(v);
  int x0 = int(fx0);
  int y0 = int(fy0);
  float fx = u - fx0;
  float fy = v - fy0;
  float a = texelFetch(grid, ivec2(clampX(x0), clampY(y0)), 0).r;
  float b = texelFetch(grid, ivec2(clampX(x0 + 1), clampY(y0)), 0).r;
  float c = texelFetch(grid, ivec2(clampX(x0), clampY(y0 + 1)), 0).r;
  float d = texelFetch(grid, ivec2(clampX(x0 + 1), clampY(y0 + 1)), 0).r;
  return (a * (1.0 - fx) + b * fx) * (1.0 - fy) + (c * (1.0 - fx) + d * fx) * fy;
}

bool inField(int fx, int fy) {
  return fx >= 0 && fy >= 0 && fx < uFieldBox.z && fy < uFieldBox.w;
}
vec4 fieldTexel(int fx, int fy, int texel) {
  return texelFetch(uField, ivec2(fx * 4 + texel, fy), 0);
}
float calmHeightCell(int fx, int fy) {
  return inField(fx, fy) ? fieldTexel(fx, fy, 3).a : 0.0;
}
float calmHeightAt(float u, float v) {
  float fx0 = floor(u);
  float fy0 = floor(v);
  int x0 = int(fx0) - uFieldBox.x;
  int y0 = int(fy0) - uFieldBox.y;
  float fx = u - fx0;
  float fy = v - fy0;
  float top = calmHeightCell(x0, y0) * (1.0 - fx) + calmHeightCell(x0 + 1, y0) * fx;
  float bottom = calmHeightCell(x0, y0 + 1) * (1.0 - fx) + calmHeightCell(x0 + 1, y0 + 1) * fx;
  return top * (1.0 - fy) + bottom * fy;
}

// What \`between\` leaves for the pixel.
bool land;
float above;
float rise;
bool beach;
int first;
int second;
float share;
float lead;
float grown;

void between(float u, float v) {
  float level = heightAt(u, v);
  above = level - uSeaLevel;
  land = above > 0.0;
  rise = uCalm > 0 ? calmHeightAt(u, v) - calmHeightAt(u - 1.0, v - 1.0) : level - heightAt(u - 1.0, v - 1.0);
  beach = above < BEACH;
  float weights[KINDS];
  float growth[KINDS];
  for (int k = 0; k < KINDS; k++) { weights[k] = 0.0; growth[k] = 0.0; }
  float fx0 = floor(u);
  float fy0 = floor(v);
  int x0 = int(fx0);
  int y0 = int(fy0);
  float fx = u - fx0;
  float fy = v - fy0;
  float total = 0.0;
  for (int corner = 0; corner < 4; corner++) {
    int dx = corner & 1;
    int dy = corner >> 1;
    float weight = (dx == 1 ? fx : 1.0 - fx) * (dy == 1 ? fy : 1.0 - fy);
    if (uCalm > 0) {
      int cx = x0 + dx - uFieldBox.x;
      int cy = y0 + dy - uFieldBox.y;
      if (!inField(cx, cy)) continue;
      vec4 s0 = fieldTexel(cx, cy, 0);
      vec4 s1 = fieldTexel(cx, cy, 1);
      if (s1.a < 0.5) continue;
      vec4 g0 = fieldTexel(cx, cy, 2);
      vec4 g1 = fieldTexel(cx, cy, 3);
      float shares[8] = float[8](s0.r, s0.g, s0.b, s0.a, s1.r, s1.g, s1.b, 0.0);
      float grows[8] = float[8](g0.r, g0.g, g0.b, g0.a, g1.r, g1.g, g1.b, 0.0);
      for (int k = 0; k < KINDS; k++) {
        weights[k] += weight * shares[k];
        growth[k] += weight * grows[k];
      }
      total += weight;
      continue;
    }
    vec4 cell = texelFetch(uCells, ivec2(clampX(x0 + dx), clampY(y0 + dy)), 0);
    if (cell.r > 0.5) continue;
    int voted = int(cell.g * 255.0 + 0.5);
    weights[voted] += weight;
    growth[voted] += weight * cell.b;
    total += weight;
  }
  first = 0;
  second = 0;
  float best = -1.0;
  float next = -1.0;
  for (int k = 0; k < KINDS; k++) {
    float weight = weights[k];
    if (weight > best) {
      next = best;
      second = first;
      best = weight;
      first = k;
    } else if (weight > next) {
      next = weight;
      second = k;
    }
  }
  share = total > 0.0 ? best / total : 1.0;
  lead = total > 0.0 ? (best - max(next, 0.0)) / total : 1.0;
  grown = best > 0.0 ? growth[first] / best : 0.0;
}

int roundHalfUp(float x) { return int(floor(x + 0.5)); }
ivec3 shade(ivec3 colour, float factor) {
  return ivec3(
    min(255, roundHalfUp(float(colour.r) * factor)),
    min(255, roundHalfUp(float(colour.g) * factor)),
    min(255, roundHalfUp(float(colour.b) * factor)));
}
ivec3 mixRgb(ivec3 from, ivec3 to, float t) {
  vec3 a = vec3(from);
  vec3 b = vec3(to);
  vec3 m = a * (1.0 - t) + b * t;
  return ivec3(roundHalfUp(m.r), roundHalfUp(m.g), roundHalfUp(m.b));
}
float smoothEdge(float from, float to, float value) {
  float t = clamp((value - from) / (to - from), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

ivec3 formRamp(int season, int form, int step) { return uForms[season * 15 + form * 3 + step]; }

// \`cover\`: growth's colour, or none (covered false) where the soil shows through.
bool withered;
bool cover(int grows, int step, int px, int py, float u, float v, float dither, int season, out ivec3 colour) {
  withered = false;
  if (grows == 0) return false;
  bool detailed = flag(8);
  bool grain = flag(16);
  if (detailed && grows == 1) return false;
  float drift = uCalm > 0 ? DRY_DRIFT * (valueNoise(u * 1.3, v * 1.3, 13) - 0.5 + 0.3 * dither) : 0.0;
  withered = grows != BURNT && ((uDries >> (grows - 1)) & 1) == 1 &&
    (season == 3 || grown + drift < uDryBelow);
  bool floored = grows > LOW && grows != BURNT;
  int toneStep = floored && grain ? max(step - 1, 0) : step;
  ivec3 tone;
  if (grows == BURNT) tone = uBurnt[toneStep];
  else if (withered) tone = uDry[season * 3 + toneStep];
  else tone = formRamp(season, grows - 1, toneStep);
  if (!grain) { colour = tone; return true; }
  if (floored && detailed && !withered) tone = mixRgb(tone, uLitter, FLOOR_LITTER[grows]);
  vec2 coverage = COVERAGE[grows];
  if (uCalm > 0) {
    float covered = coverage.x + (coverage.y - coverage.x) * grown;
    float patchHere = (1.0 - CALM_RAGGED) * valueNoise(u / CALM_PATCH, v / CALM_PATCH, 5) +
      CALM_RAGGED * valueNoise(float(px) / PATCH, float(py) / PATCH, 10);
    if (patchHere >= covered) return false;
    if (detailed) { colour = tone; return true; }
  } else {
    float fade = flag(1) ? smoothEdge(EDGE_FROM, EDGE_TO, share) : 1.0;
    float covered = (coverage.x + (coverage.y - coverage.x) * grown) * fade;
    float patchHere = valueNoise((float(px) * uFine) / PATCH, (float(py) * uFine) / PATCH, 5);
    float ragged = flag(4) ? 0.74 * patchHere + 0.26 * valueNoise(float(px) / PATCH, float(py) / PATCH, 10) : patchHere;
    if (ragged >= covered) return false;
  }
  float blade = cellHash(px, py / uBladeRows, 6);
  ivec3 rampAt[3];
  for (int s = 0; s < 3; s++) {
    rampAt[s] = grows == BURNT ? uBurnt[s] : withered ? uDry[season * 3 + s] : formRamp(season, grows - 1, s);
  }
  if (grows == BURNT) { colour = blade < 0.08 ? shade(tone, 0.7) : tone; return true; }
  if (floored) { colour = blade < 0.03 ? rampAt[step] : tone; return true; }
  float lit = grows == 2 ? 0.03 + 0.06 * grown : 0.02;
  if (blade < lit) { colour = rampAt[min(step + 1, 2)]; return true; }
  colour = grows == 2 && blade < lit + 0.04 ? rampAt[max(step - 1, 0)] : tone;
  return true;
}

void put(ivec3 colour, bool isLand, int tone, int made, int thick) {
  outColour = vec4(vec3(colour) / 255.0, float((isLand ? 1 : 0) + 2 * tone) / 255.0);
  outMatter = vec4(float(made) / 255.0, float(thick) / 255.0, 0.0, 1.0);
}

void main() {
  int px = int(gl_FragCoord.x);
  int py = int(gl_FragCoord.y);
  int worldX = uOrigin.x + px;
  int worldY = uOrigin.y + py;
  float u = (float(worldX) + 0.5) / uTile - 0.5;
  float v = (float(worldY) + 0.5) / uTile - 0.5;
  bool close = flag(4);
  float du = (valueNoise(u * WOBBLE_FREQUENCY, v * WOBBLE_FREQUENCY, 1) - 0.5) * 2.0 * WOBBLE;
  float dv = (valueNoise(u * WOBBLE_FREQUENCY, v * WOBBLE_FREQUENCY, 2) - 0.5) * 2.0 * WOBBLE;
  if (close) {
    du += (valueNoise(u * FINE_FREQUENCY, v * FINE_FREQUENCY, 11) - 0.5) * 2.0 * FINE_WOBBLE;
    dv += (valueNoise(u * FINE_FREQUENCY, v * FINE_FREQUENCY, 12) - 0.5) * 2.0 * FINE_WOBBLE;
  }
  if (uFull.x <= uFull.z && (px < uFull.x || py < uFull.y || px >= uFull.z || py >= uFull.w)) {
    // The margin: land or sea only (\`GroundOptions.shown\`).
    put(ivec3(0), heightAt(u + du, v + dv) - uSeaLevel > 0.0, 0, SEA_MATTER, 0);
    return;
  }
  between(u + du, v + dv);
  bool dithered = flag(2);
  float dither = dithered ? BAYER[(worldY & 3) * 4 + (worldX & 3)] * 2.0 - 1.0 : 0.0;
  int season = uSeason;
  if (uTurn.z > 0.5) {
    float front = 2.0 * valueNoise(u / FRONT_CELLS, v / FRONT_CELLS, 91) - 1.0;
    float high = 2.0 * clamp((heightAt(u, v) - uSeaLevel) / HILLS, 0.0, 1.0) - 1.0;
    float earliness = FRONT * front + HEIGHT * high * uTurn.y + DITHER * dither;
    float shown = uTurn.x + (TURN_SEASONS / 2.0) * clamp(earliness, -1.0, 1.0);
    season = ((int(floor(shown)) % 4) + 4) % 4;
  }
  bool grain = flag(16);
  if (!land) {
    float depth = -above * (1.0 + MIX_DEPTH * dither);
    ivec3 base = uBandColours[uBands - 1];
    for (int b = 0; b < ${MOST_BANDS}; b++) {
      if (b < uBands && depth <= uBandLimits[b]) { base = uBandColours[b]; break; }
    }
    ivec3 colour = grain && cellHash(worldX / uDash, worldY, 7) < WAVES ? mixRgb(base, uFoam, 0.35) : base;
    if (flag(64)) {
      float algae = gridAt(uAlgae, u, v) / ALGAE_FULL;
      if (algae > 0.02) {
        float clump = valueNoise(float(worldX) / ALGAE_CLUMP, float(worldY) / ALGAE_CLUMP, 51);
        if (clump + 0.15 * dither < min(algae, 1.0) * ALGAE_COVER) {
          int which = cellHash(worldX, worldY, 52) < 0.3 ? 1 : 0;
          colour = mixRgb(base, ALGAE_COLOURS[which], ALGAE_MIX);
        }
      }
    }
    put(colour, false, 0, SEA_MATTER, 0);
    return;
  }
  float slope = uRelief.x;
  float felt = rise + uMixSlope * slope * dither;
  int step = felt > slope ? 2 : felt < -slope ? 0 : 1;
  float wander = uCalm > 0
    ? KIND_WANDER * (valueNoise(u * KIND_WANDER_FREQUENCY, v * KIND_WANDER_FREQUENCY, 14) - 0.5 +
        0.35 * (valueNoise(float(worldX) / PATCH, float(worldY) / PATCH, 15) - 0.5))
    : 0.0;
  float leads = lead + wander;
  int grows = leads < 0.0 ? second : dithered && dither + 1.0 < 1.0 - leads / uMixClass ? second : first;
  bool detailed = flag(8);
  int tone = detailed ? step : 0;
  int thick = detailed ? roundHalfUp(grown * 255.0) : 0;
  bool snowCells = flag(32);
  float depth = snowCells ? gridAt(uSnow, u, v) : (((uSnowing >> season) & 1) == 1 ? 1.0 : 0.0);
  if (depth > 0.0) {
    float lying = 0.82 * valueNoise(u / SNOW_PATCH, v / SNOW_PATCH, 40) +
      0.18 * valueNoise(float(worldX) / PATCH, float(worldY) / PATCH, 41);
    float under = grows == 4 || grows == 5 ? SNOW_UNDER_TREES : SNOW_OPEN;
    if (lying + 0.04 * dither < under * min(1.0, depth * SNOW_FULL_FROM)) {
      put(uSnowRamp[step], true, tone, SNOW, thick);
      return;
    }
  }
  ivec3 growthColour;
  if (cover(grows, step, worldX, worldY, u, v, dither, season, growthColour)) {
    put(growthColour, true, tone, withered ? DRY : MATTER_OF[grows], thick);
    return;
  }
  int high = above >= uRelief.y && !snowCells ? 2 : above >= uRelief.z ? 1 : 0;
  ivec3 soil = high == 2 ? uSnowRamp[step] : high == 1 ? uRock[step] : uBare[step];
  bool sandy = flag(1) ? above * (1.0 + 0.6 * dither) < BEACH : beach;
  ivec3 base = sandy ? uSand : soil;
  if (detailed) {
    int made = sandy ? SAND : grows == 1 && high < 2 ? LICHEN : high == 2 ? SNOW : high == 1 ? ROCK : SOIL;
    put(base, true, tone, made, thick);
    return;
  }
  float grainHere = grain ? cellHash(worldX, worldY, 8) : 0.5;
  put(grainHere < GRIT ? shade(base, 0.86) : grainHere > 1.0 - GRIT / 2.0 ? shade(base, 1.08) : base,
    true, tone, SEA_MATTER, thick);
}
`;
}

function ivec3(colour: Rgb): string {
  return `ivec3(${(colour >> 16) & 255}, ${(colour >> 8) & 255}, ${colour & 255})`;
}

const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** The world's grids on the GPU, kept while the same land is painted. */
interface WorldTextures {
  heights: Float32Array;
  sea: Uint8Array;
  textures: WebGLTexture[];
}

/**
 * The colour pass on the GPU, in a WebGL2 context of its own: `create` gives null where
 * there is none (no `OffscreenCanvas` or WebGL2 in a worker, a shader that does not
 * compile), and the painter paints on the CPU as before.
 */
export class GpuGround {
  private world: WorldTextures | null = null;
  private readonly field: WebGLTexture;
  private readonly targets: WebGLTexture[];
  private readonly frame: WebGLFramebuffer;
  private size = { wide: 0, tall: 0 };
  /** Whether the framebuffer at `size` can be drawn into. */
  private complete = false;
  private readonly at: Map<string, WebGLUniformLocation | null> = new Map();

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly program: WebGLProgram,
  ) {
    this.field = this.texture();
    this.targets = [this.texture(), this.texture()];
    const frame = gl.createFramebuffer();
    if (frame === null) throw new Error("gpuground: no framebuffer");
    this.frame = frame;
  }

  static create(): GpuGround | null {
    if (typeof OffscreenCanvas === "undefined") return null;
    try {
      const gl = new OffscreenCanvas(1, 1).getContext("webgl2", {
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      });
      if (gl === null) return null;
      const program = link(gl, VERTEX, colourShader());
      return program === null ? null : new GpuGround(gl, program);
    } catch {
      return null;
    }
  }

  /** The colour pass of one painting; null if the GPU failed (the CPU paints it then). */
  colourPass(input: ColourPassInput): ColourPassOutput | null {
    const { gl } = this;
    if (gl.isContextLost()) return null;
    const { wide, tall } = input;
    gl.useProgram(this.program);
    this.bindWorld(input);
    this.bindField(input);
    this.bindTargets(wide, tall);
    if (!this.complete) return null;
    this.setUniforms(input);
    gl.viewport(0, 0, wide, tall);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const first = new Uint8Array(wide * tall * 4);
    const second = new Uint8Array(wide * tall * 4);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, wide, tall, gl.RGBA, gl.UNSIGNED_BYTE, first);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, wide, tall, gl.RGBA, gl.UNSIGNED_BYTE, second);
    if (gl.getError() !== gl.NO_ERROR) return null;
    const count = wide * tall;
    const colours = new Uint32Array(count);
    const isLand = new Uint8Array(count);
    const matter = new Uint8Array(input.detailed ? count : 0);
    const toned = new Uint8Array(input.detailed ? count : 0);
    const thick = new Uint8Array(input.detailed ? count : 0);
    for (let at = 0; at < count; at++) {
      const o = 4 * at;
      colours[at] = ((first[o] ?? 0) << 16) | ((first[o + 1] ?? 0) << 8) | (first[o + 2] ?? 0);
      const flags = first[o + 3] ?? 0;
      isLand[at] = flags & 1;
      if (input.detailed) {
        toned[at] = flags >> 1;
        matter[at] = second[o] ?? 0;
        thick[at] = second[o + 1] ?? 0;
      }
    }
    return { colours, isLand, matter, toned, thick };
  }

  private texture(): WebGLTexture {
    const texture = this.gl.createTexture();
    if (texture === null) throw new Error("gpuground: no texture");
    return texture;
  }

  private upload(
    unit: number,
    texture: WebGLTexture,
    format: { internal: number; format: number; type: number },
    width: number,
    height: number,
    data: ArrayBufferView,
  ): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      format.internal,
      width,
      height,
      0,
      format.format,
      format.type,
      data,
    );
  }

  /** The world's grids, uploaded again only for another land. */
  private bindWorld(input: ColourPassInput): void {
    const { gl } = this;
    const { world } = input;
    const known = this.world;
    const textures =
      known !== null && known.heights === world.heights && known.sea === world.sea
        ? known.textures
        : null;
    if (textures !== null) {
      textures.forEach((texture, unit) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
      });
      return;
    }
    if (known !== null) for (const texture of known.textures) gl.deleteTexture(texture);
    const { width, height } = world;
    const made = [this.texture(), this.texture(), this.texture(), this.texture()] as const;
    const red8 = { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE };
    this.upload(
      0,
      made[0],
      { internal: gl.R32F, format: gl.RED, type: gl.FLOAT },
      width,
      height,
      world.heights,
    );
    const cells = new Uint8Array(width * height * 4);
    for (let cell = 0; cell < width * height; cell++) {
      cells[4 * cell] = world.sea[cell] === 1 ? 255 : 0;
      cells[4 * cell + 1] = world.kind[cell] ?? 0;
      cells[4 * cell + 2] = world.biomass[cell] ?? 0;
    }
    this.upload(
      1,
      made[1],
      { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE },
      width,
      height,
      cells,
    );
    this.upload(2, made[2], red8, width, height, world.snow ?? new Uint8Array(width * height));
    this.upload(3, made[3], red8, width, height, world.algae ?? new Uint8Array(width * height));
    this.world = { heights: world.heights, sea: world.sea, textures: [...made] };
  }

  /** The calm field: four texels a cell (shares 0–3; shares 4–6 and land; growth 0–3; growth 4–6 and height). */
  private bindField(input: ColourPassInput): void {
    const { gl } = this;
    const { field } = input;
    const wide = Math.max(field.wide, 1);
    const tall = Math.max(field.tall, 1);
    const texels = new Float32Array(wide * tall * 16);
    const kinds = K.BURNT + 1;
    if (input.calm > 0) {
      for (let at = 0; at < field.wide * field.tall; at++) {
        const o = 16 * at;
        for (let k = 0; k < kinds; k++) {
          texels[o + k] = field.shares[at * kinds + k] ?? 0;
          texels[o + 8 + k] = field.growth[at * kinds + k] ?? 0;
        }
        texels[o + 7] = field.land[at] ?? 0;
        texels[o + 15] = field.heights[at] ?? 0;
      }
    }
    this.upload(
      4,
      this.field,
      { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT },
      wide * 4,
      tall,
      texels,
    );
  }

  private bindTargets(wide: number, tall: number): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frame);
    if (this.size.wide !== wide || this.size.tall !== tall) {
      this.complete = false;
      this.targets.forEach((target, k) => {
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, target);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, wide, tall, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, target, 0);
      });
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      this.size = { wide, tall };
      this.complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
  }

  private uniform(name: string): WebGLUniformLocation | null {
    if (!this.at.has(name)) this.at.set(name, this.gl.getUniformLocation(this.program, name));
    return this.at.get(name) ?? null;
  }

  private setUniforms(input: ColourPassInput): void {
    const { gl } = this;
    const u = (name: string): WebGLUniformLocation | null => this.uniform(name);
    const rgb = (colour: Rgb): number[] => [
      (colour >> 16) & 255,
      (colour >> 8) & 255,
      colour & 255,
    ];
    const ramp = (colours: readonly Rgb[]): Int32Array => Int32Array.from(colours.flatMap(rgb));
    ["uHeights", "uCells", "uSnow", "uAlgae", "uField"].forEach((name, unit) =>
      gl.uniform1i(u(name), unit),
    );
    gl.uniform2i(u("uWorld"), input.world.width, input.world.height);
    gl.uniform1f(u("uSeaLevel"), input.world.seaLevel);
    gl.uniform2i(u("uOrigin"), input.originX, input.originY);
    gl.uniform1f(u("uTile"), input.tile);
    const full = input.full;
    gl.uniform4i(u("uFull"), full?.x0 ?? 1, full?.y0 ?? 0, full?.x1 ?? 0, full?.y1 ?? 0);
    const flags =
      (input.interpolated ? 1 : 0) |
      (input.dithered ? 2 : 0) |
      (input.close ? 4 : 0) |
      (input.detailed ? 8 : 0) |
      (input.grain ? 16 : 0) |
      (input.world.snow !== undefined ? 32 : 0) |
      (input.world.algae !== undefined ? 64 : 0);
    gl.uniform1i(u("uFlags"), flags);
    gl.uniform1i(u("uCalm"), input.calm);
    gl.uniform4i(u("uFieldBox"), input.field.x, input.field.y, input.field.wide, input.field.tall);
    gl.uniform1f(u("uMixClass"), input.mixClass);
    gl.uniform1f(u("uMixSlope"), input.mixSlope);
    gl.uniform1f(u("uFine"), input.fine);
    gl.uniform1i(u("uBladeRows"), input.bladeRows);
    gl.uniform1i(u("uDash"), input.dash);
    gl.uniform3f(
      u("uRelief"),
      input.relief.slope,
      input.relief.snowFrom,
      input.relief.highRockFrom,
    );
    gl.uniform1f(u("uDryBelow"), input.dryBelow);
    gl.uniform1i(
      u("uDries"),
      input.dries.reduce((bits, dries, form) => bits | (dries ? 1 << form : 0), 0),
    );
    gl.uniform3iv(u("uDry"), ramp(input.seasons.flatMap((season) => season.dry)));
    gl.uniform3iv(
      u("uForms"),
      ramp(
        input.seasons.flatMap((season) => season.ramps.slice(0, 5).flatMap((each) => [...each])),
      ),
    );
    gl.uniform1i(
      u("uSnowing"),
      input.seasons.reduce((bits, season, index) => bits | (season.snowing ? 1 << index : 0), 0),
    );
    gl.uniform1i(u("uSeason"), input.season);
    gl.uniform3f(
      u("uTurn"),
      input.turn?.phase ?? 0,
      input.turn?.hills ?? 0,
      input.turn === null ? 0 : 1,
    );
    gl.uniform3iv(u("uBare"), ramp(input.bare));
    gl.uniform3iv(u("uRock"), ramp(input.rock));
    gl.uniform3iv(u("uSnowRamp"), ramp(input.snow));
    gl.uniform3iv(u("uBurnt"), ramp(input.burnt));
    gl.uniform3iv(u("uSand"), ramp([input.sand]));
    gl.uniform3iv(u("uFoam"), ramp([input.foam]));
    gl.uniform3iv(u("uLitter"), ramp([input.litter]));
    const bands = input.bands.slice(0, MOST_BANDS);
    const limits = new Float32Array(MOST_BANDS);
    bands.forEach((band, k) => (limits[k] = band.limit));
    gl.uniform1fv(u("uBandLimits"), limits);
    const colours = new Int32Array(MOST_BANDS * 3);
    colours.set(ramp(bands.map((band) => band.colour)));
    gl.uniform3iv(u("uBandColours"), colours);
    gl.uniform1i(u("uBands"), Math.max(bands.length, 1));
  }
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram | null {
  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (shader === null) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
      console.warn("gpuground:", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, vertex);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (vs === null || fs === null || program === null) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    console.warn("gpuground:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}
