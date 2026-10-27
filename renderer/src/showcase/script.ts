/**
 * The showcase's script (R5, the owner: "a demo/showcase of the whole thing ... almost like
 * a trailer, with text that describes what is being shown"): its acts in order, how long
 * each lasts, and what its caption says. What each act stages is `showcase.ts`'s; this
 * is the timeline alone, so that it can be read and tested apart from the scene.
 */

export type ActName =
  | "title"
  | "world"
  | "creatures"
  | "life"
  | "family"
  | "rare"
  | "seasons"
  | "weather"
  | "night"
  | "powers"
  | "chronicle"
  | "end"
  | "card";

export interface Act {
  name: ActName;
  /** Seconds it lasts. */
  seconds: number;
  /** A title in large letters over the middle of the screen, if any. */
  title?: string;
  /** The line on the ribbon at the foot of the screen. */
  line: string;
  /** The ribbon at the top instead, out of the way of what the act shows at the foot. */
  top?: boolean;
}

/** The fonts have no middle dot or inch mark: the end card's parts are set off by dashes. */
export const HARDWARE = "Orange Pi Zero 2W – 7-inch screen – 30 fps";

export const ACTS: readonly Act[] = [
  {
    name: "title",
    seconds: 8,
    title: "LINEAGE",
    line: "An island that evolves on your desk. For years.",
  },
  {
    name: "world",
    seconds: 12,
    line: "Every hill, wood and shore is simulated, and grows slowly.",
  },
  {
    name: "creatures",
    seconds: 14,
    line: "Every creature is built from its genes. No two species look alike.",
  },
  { name: "life", seconds: 14, line: "They eat, hunt and die, and their kind changes with them." },
  { name: "family", seconds: 12, line: "Families. A lineage, generation after generation." },
  { name: "rare", seconds: 12, line: "Rare genes give strange gifts, at a cost." },
  { name: "seasons", seconds: 14, line: "Seasons follow the real calendar." },
  { name: "weather", seconds: 14, line: "It has its own weather." },
  { name: "night", seconds: 12, line: "Your presence is its sun. When you leave, night falls." },
  { name: "powers", seconds: 15, line: "One button. Once a week, the island asks for help." },
  // The chronicle's scroll unrolls at the foot of the screen: the line goes at the top.
  { name: "chronicle", seconds: 9, line: "It writes its own history.", top: true },
  { name: "end", seconds: 15, line: "And when life ends, a new world begins." },
  { name: "card", seconds: 8, title: "LINEAGE", line: HARDWARE },
];

/** Seconds one loop of the showcase lasts. */
export const LOOP_S = ACTS.reduce((sum, act) => sum + act.seconds, 0);

/** Where `timeS` (seconds since the showcase began) falls: the loop, the act, how far in. */
export function actAt(timeS: number): { loop: number; index: number; act: Act; intoS: number } {
  const loop = Math.floor(Math.max(timeS, 0) / LOOP_S);
  let into = Math.max(timeS, 0) - loop * LOOP_S;
  for (let index = 0; index < ACTS.length; index++) {
    const act = ACTS[index] as Act;
    if (into < act.seconds || index === ACTS.length - 1) {
      return { loop, index, act, intoS: Math.min(into, act.seconds) };
    }
    into -= act.seconds;
  }
  throw new Error("showcase: no acts");
}
