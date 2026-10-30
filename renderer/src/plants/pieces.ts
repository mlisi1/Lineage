/**
 * Bushes in pieces (R5, an experiment the owner asked for: `?bushes=pieces`). A bush's
 * drawing is cut into one piece for each puff of its dome, as top-down games cut a large
 * tree into tiles: each piece is its own sprite, sorted by its own foot and keeping its
 * own footprint, so that an animal can be in front of one puff and behind another. The
 * pieces share out the drawing's pixels between them, so the bush looks the same as a
 * whole drawing wherever no animal comes between them.
 */
import { SCALLOP } from "./cosyart";
import type { PlantArt } from "./plantart";

/** A piece of a drawing: its own drawing, and where its corner was in the whole one. */
export interface Piece {
  /** Its pixels; its foot is the foot of its puff, the line it is sorted by. */
  art: PlantArt;
  left: number;
  top: number;
  /** The radius of its puff, in pixels: how large a footprint it keeps. */
  r: number;
}

/**
 * Pixels beyond a puff's rim that still go with it: its scallops' bulge and the outline
 * round it.
 */
const RIM_PIXELS = 1.5;

/**
 * Cut `art` into a piece for each of its puffs, or null if it has none (every drawing but
 * a leafy bush's). A pixel goes with the last-painted puff that reaches it (what is seen
 * there is that puff), or with the nearest puff for its size if none does (blossom and
 * snow beyond the rims).
 */
export function piecesOf(art: PlantArt): Piece[] | null {
  const puffs = art.puffs;
  if (puffs === undefined || puffs.length < 2) return null;
  const owner = new Int16Array(art.width * art.height).fill(-1);
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      const index = y * art.width + x;
      if (art.ink[index] === 0) continue;
      let mine = -1;
      let nearest = -1;
      let best = Infinity;
      puffs.forEach((p, k) => {
        const far = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
        if (far <= p.r * (1 + SCALLOP) + RIM_PIXELS) mine = k;
        if (far / p.r < best) [best, nearest] = [far / p.r, k];
      });
      owner[index] = mine >= 0 ? mine : nearest;
    }
  }
  const pieces: Piece[] = [];
  puffs.forEach((p, k) => {
    let [x0, y0, x1, y1] = [art.width, art.height, -1, -1];
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        if (owner[y * art.width + x] !== k) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    if (x1 < 0) return;
    const width = x1 - x0 + 1;
    const height = y1 - y0 + 1;
    const ink = new Uint8Array(width * height);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const index = y * art.width + x;
        if (owner[index] === k) ink[(y - y0) * width + (x - x0)] = art.ink[index] ?? 0;
      }
    }
    // Its foot: the bottom of its puff, never below the bush's own foot (the lowest puffs
    // stand on the ground there).
    const footY = Math.min(Math.round(p.y + p.r), art.footY);
    pieces.push({
      art: { width, height, ink, footX: Math.round(p.x) - x0, footY: footY - y0 },
      left: x0,
      top: y0,
      r: p.r,
    });
  });
  return pieces;
}
