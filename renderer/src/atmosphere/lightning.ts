/**
 * Lightning (R4; the owner, 2026-10-20). Three sizes, from the sim's rain:
 *
 *   thunder   rain with thunder: now and then a far flash and a thin bolt; it starts nothing
 *   storm     a thunderstorm: bolts every few seconds, brighter flashes, the sky darker
 *   strike    the bolt that sets a fire (`fire_started`, only ever in a storm): the biggest,
 *             thick and forked, where the fire begins
 *
 * When thunder and storm bolts fall is a function of the time alone, as the sea's glints
 * are, and irregular: time is cut into short windows, a bolt falls in a window by chance,
 * more often in some stretches of the storm than others (lulls and bursts, a bolt
 * sometimes right after another); where a bolt runs is a hash of its number. A bolt is a path of whole art pixels on
 * the screen, from above the top edge down to where it strikes, jagged in small steps.
 */
import { cellHash } from "../terrain/pixels";

export type Kind = "thunder" | "storm" | "strike";

/** How each size of lightning looks: how often (s), its share of windows, how long it shows (s), how thick (art pixels), how bright a flash it makes (0–1), whether it forks. */
export const BOLTS: Readonly<
  Record<
    Kind,
    { every: number; share: number; lasts: number; width: number; flash: number; forks: number }
  >
> = {
  thunder: { every: 9, share: 0.6, lasts: 0.25, width: 1, flash: 0.22, forks: 0 },
  storm: { every: 2.6, share: 0.85, lasts: 0.35, width: 2, flash: 0.45, forks: 1 },
  strike: { every: 0, share: 1, lasts: 0.6, width: 3, flash: 0.85, forks: 2 },
};
/** Art pixels a bolt steps sideways at most per this many art pixels down. */
const JAG = 3;
const STEP = 4;

/** Windows to a bolt's mean spacing (`every`), and the seconds over which a storm's activity turns. */
const WINDOWS = 4;
const ACTIVITY_S = 25;

/** How active the storm is at `timeS`, 0.3–1.7 (mean about 1): lulls and bursts. */
function activity(timeS: number, salt: number): number {
  const at = timeS / ACTIVITY_S;
  const i = Math.floor(at);
  const f = at - i;
  const a = cellHash(i, salt, 409);
  const b = cellHash(i + 1, salt, 409);
  return 0.3 + 1.4 * (a + (b - a) * f * f * (3 - 2 * f));
}

/** The bolt of window `n` of `kind` showing at `timeS`, if one does: its number, and how far through its showing (0–1). */
export function boltAt(
  kind: "thunder" | "storm",
  timeS: number,
): { n: number; phase: number } | null {
  const { every: mean, share, lasts } = BOLTS[kind];
  const every = mean / WINDOWS;
  const n = Math.floor(timeS / every);
  const salt = kind === "storm" ? 2 : 1;
  if (cellHash(n, salt, 401) >= (share / WINDOWS) * activity(n * every, salt)) return null;
  const start = n * every + cellHash(n, 3, 402) * Math.max(every - lasts, 0);
  const into = timeS - start;
  if (into < 0 || into >= lasts) return null;
  return { n, phase: into / lasts };
}

/** Where bolt `n` strikes on a screen `width` × `height` art pixels: a hashed place in its lower part. */
export function strikePoint(n: number, width: number, height: number): { x: number; y: number } {
  return {
    x: Math.round(width * (0.1 + 0.8 * cellHash(n, 5, 403))),
    y: Math.round(height * (0.45 + 0.45 * cellHash(n, 6, 404))),
  };
}

/**
 * The pixels of a bolt from above the top edge to (x, y), jagged by hashes of `n`, as a
 * list of [x, y] art pixels, one per row; and its forks, each a shorter path off it.
 */
export function boltPath(n: number, x: number, y: number, forks: number): [number, number][][] {
  const main: [number, number][] = [];
  // Walk up from the strike, drifting a little each step, so that it lands exactly there.
  let at = x;
  for (let row = y; row >= -2; row--) {
    if ((y - row) % STEP === 0 && row !== y) {
      at += Math.round((cellHash(n, row, 405) * 2 - 1) * JAG);
    }
    main.push([at, row]);
  }
  main.reverse();
  const paths = [main];
  for (let k = 0; k < forks; k++) {
    const from = main[Math.floor(main.length * (0.3 + 0.4 * cellHash(n, k, 406)))];
    if (from === undefined) continue;
    const side = cellHash(n, k, 407) < 0.5 ? -1 : 1;
    const fork: [number, number][] = [];
    let fx = from[0];
    const length = Math.round(main.length * (0.2 + 0.2 * cellHash(n, k, 408)));
    for (let i = 0; i < length; i++) {
      if (i % 2 === 0) fx += side;
      fork.push([fx, from[1] + i]);
    }
    paths.push(fork);
  }
  return paths;
}
