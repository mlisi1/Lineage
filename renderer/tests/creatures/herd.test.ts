import { readFileSync } from "node:fs";
import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { Herd, Roster } from "../../src/herd";
import type { ClockMessage, CreaturesMessage, LandMessage, Message } from "../../src/protocol";
import { mulberry32 } from "../../src/rng";
import { landOf } from "../../src/stream";
import type { Land } from "../../src/terrain/land";
import { installCanvas } from "./canvas";

installCanvas();

const STEP_S = 1 / 30;
const EVERYWHERE = { x0: 0, y0: 0, x1: 256, y1: 150 };
const ATLAS = {
  plants: new Map<string, Texture>(),
  disc: Texture.WHITE,
  white: Texture.WHITE,
  wedge: Texture.WHITE,
};

/** The office recording (R4): a fortnight of the v9 world with its light and deaths. */
const office = JSON.parse(
  readFileSync(new URL("../../public/stream/office.json", import.meta.url), "utf-8"),
) as { messages: Message[] };
const creaturesMessages = office.messages.filter(
  (message): message is CreaturesMessage => message.type === "creatures",
);
const first = creaturesMessages[0] as CreaturesMessage;
const GENOME = first.born[0]?.genome ?? [];

/** What the tests read of the herd's own state. */
interface Inside {
  mothers: Map<number, { mother: number; byHand: boolean }>;
  roster: Roster;
  layers: Record<"middle" | "local", { creatures: ({ leader?: number } | undefined)[] }>;
  remains: { remains: { cause: string; bornS: number }[]; landings: unknown[] };
}

/** A herd told the recording's world, fauna, rare genes and species, but no creatures. */
function herdOfOffice(): { herd: Herd; inside: Inside } {
  let land: Land | null = null;
  let clock: ClockMessage | null = null;
  const herd = new Herd(ATLAS, mulberry32(3), () => land);
  for (const message of office.messages) {
    if (message.type === "creatures") break;
    if (message.type === "clock") clock = message;
    if (message.type === "land") land = landOf(message as LandMessage, clock);
    herd.receive(message);
  }
  return { herd, inside: herd as unknown as Inside };
}

/** A creatures message for the recording's first animals, at their first places. */
function creatures(change: Partial<CreaturesMessage> & { ids: number[] }): CreaturesMessage {
  const at = (id: number): [number, number] => {
    const index = first.ids.indexOf(id);
    return (first.positions[index] ?? [100, 70]) as [number, number];
  };
  return {
    type: "creatures",
    protocol: 1,
    t_ms: first.t_ms,
    positions: change.ids.map(at),
    species: change.ids.map(() => 1),
    born: [],
    torpid: [],
    ...change,
  };
}

const born = (id: number, parent?: number) => ({ id, genome: GENOME, slots: 0, parent });

describe("the roster's news of eating and growing", () => {
  it("knows who ate plants and who ate meat in the last tick, as of the last message", () => {
    const roster = new Roster();
    roster.take(
      creatures({
        ids: [1, 2, 3],
        born: [born(1), born(2), born(3)],
        grazing: [1, 2],
        feeding: [2],
      }),
    );
    expect(roster.food.get(1)).toBe("plants");
    expect(roster.food.get(2)).toBe("meat");
    expect(roster.food.has(3)).toBe(false);
    roster.take(creatures({ ids: [1, 2, 3] }));
    expect(roster.food.size).toBe(0);
  });

  it("knows how far grown each young one is, the rest grown", () => {
    const roster = new Roster();
    roster.take(creatures({ ids: [1, 2], born: [born(1), born(2)], young: [[2, 5]] }));
    expect(roster.young.get(2)).toBe(5);
    expect(roster.young.has(1)).toBe(false);
    roster.take(creatures({ ids: [1, 2] }));
    expect(roster.young.size).toBe(0);
  });
});

describe("the herd's families", () => {
  const [a, b, c] = first.ids as [number, number, number];

  it("has each young one seen being born trail its mother, and a brood trail in a line", () => {
    const { herd, inside } = herdOfOffice();
    herd.receive(creatures({ ids: [a], born: [born(a)] }));
    herd.update(STEP_S, "middle", EVERYWHERE, null, null);
    herd.receive(
      creatures({
        ids: [a, b, c],
        born: [born(b, a), born(c, a)],
        young: [
          [b, 0],
          [c, 0],
        ],
      }),
    );
    expect([...inside.mothers.keys()].sort()).toEqual([b, c].sort());
    expect(inside.mothers.get(b)).toEqual({ mother: a, byHand: false });
    const slot = (id: number): number => inside.roster.slotOf(id) ?? -1;
    const leaderOf = (id: number): number | undefined =>
      inside.layers.middle.creatures[slot(id)]?.leader;
    // The elder of the brood trails its mother; the younger trails its elder.
    const [elder, younger] = [b, c].sort((x, y) => x - y) as [number, number];
    expect(leaderOf(elder)).toBe(slot(a));
    expect(leaderOf(younger)).toBe(slot(elder));
    expect(inside.layers.local.creatures[slot(younger)]?.leader).toBe(slot(elder));
  });

  it("forgets a young one's mother when it comes of age, or either dies", () => {
    const { herd, inside } = herdOfOffice();
    herd.receive(creatures({ ids: [a], born: [born(a)] }));
    herd.receive(
      creatures({
        ids: [a, b, c],
        born: [born(b, a), born(c, a)],
        young: [
          [b, 3],
          [c, 3],
        ],
      }),
    );
    expect(inside.mothers.size).toBe(2);
    // b comes of age (no longer among the young); c dies.
    herd.receive(creatures({ ids: [a, b], young: [] }));
    expect(inside.mothers.size).toBe(0);
    const slot = inside.roster.slotOf(b) ?? -1;
    expect(inside.layers.middle.creatures[slot]?.leader).toBeUndefined();
  });

  it("knows none of the mothers of the young already there when it joins", () => {
    const { herd, inside } = herdOfOffice();
    herd.receive(creatures({ ids: [a, b], born: [born(a), born(b)], young: [[b, 4]] }));
    expect(inside.mothers.size).toBe(0);
  });
});

describe("the herd's deaths and landings", () => {
  const [a, b, c] = first.ids as [number, number, number];

  it("tells of each death with its cause, and leaves remains where it fell", () => {
    const { herd, inside } = herdOfOffice();
    const gone: [number, number, string | undefined][] = [];
    herd.onGone = (x, y, cause) => gone.push([x, y, cause]);
    herd.receive(creatures({ ids: [a, b, c], born: [born(a), born(b), born(c)] }));
    herd.update(STEP_S, "middle", EVERYWHERE, null, null);
    herd.receive(
      creatures({
        ids: [a],
        died: [
          { id: b, cause: "starved" },
          { id: c, cause: "drowned" },
        ],
      }),
    );
    expect(gone.map(([, , cause]) => cause).sort()).toEqual(["drowned", "starved"]);
    expect(inside.remains.remains.map(({ cause }) => cause).sort()).toEqual(["drowned", "starved"]);
  });

  it("has a hunter alive run to its prey before the prey dies, in the view shown", () => {
    const { herd, inside } = herdOfOffice();
    // Two animals a cell apart.
    const [x, y] = first.positions[0] as [number, number];
    const near = (ids: number[]): [number, number][] => ids.map((_, k) => [x + k, y]);
    herd.receive(creatures({ ids: [a, b], born: [born(a), born(b)], positions: near([a, b]) }));
    // Both there a second (come into being, not arriving still).
    for (let t = 0; t < 1; t += STEP_S) herd.update(STEP_S, "middle", EVERYWHERE, null, null);
    herd.receive(
      creatures({ ids: [a], positions: near([a]), died: [{ id: b, cause: "killed", by: a }] }),
    );
    const [kill] = inside.remains.remains;
    expect(kill?.cause).toBe("killed");
    // Its remains wait for the strike: brief, but not at once.
    expect(kill?.bornS ?? 0).toBeGreaterThan(1 + 0.4);
    expect(kill?.bornS ?? 0).toBeLessThan(1 + 1.6);
  });

  it("splashes an animal that landed from the sea", () => {
    const { herd, inside } = herdOfOffice();
    herd.receive(creatures({ ids: [a], born: [born(a)], landed: [a] }));
    expect(inside.remains.landings).toHaveLength(1);
  });

  it("forgets every carcass when a new world begins", () => {
    const { herd, inside } = herdOfOffice();
    herd.receive(creatures({ ids: [a, b], born: [born(a), born(b)] }));
    herd.receive(creatures({ ids: [a], died: [{ id: b, cause: "old_age" }] }));
    expect(inside.remains.remains).toHaveLength(1);
    herd.receive({
      type: "events",
      protocol: 1,
      t_ms: first.t_ms,
      events: [{ kind: "world_began" }],
    } as unknown as Message);
    expect(inside.remains.remains).toHaveLength(0);
  });
});

describe("the herd over a recorded fortnight", () => {
  it("keeps its families and remains true to the stream message after message", () => {
    const { herd, inside } = herdOfOffice();
    let deaths = 0;
    herd.onGone = () => (deaths += 1);
    let told = 0;
    for (const message of creaturesMessages.slice(0, 60)) {
      herd.receive(message);
      herd.update(STEP_S, "middle", EVERYWHERE, null, null);
      told += message.died?.length ?? 0;
      for (const [child, { mother, byHand }] of inside.mothers) {
        expect(byHand).toBe(false);
        expect(inside.roster.young.has(child)).toBe(true);
        expect(inside.roster.where.has(mother)).toBe(true);
      }
    }
    expect(deaths).toBe(told);
    expect(told).toBeGreaterThan(0);
    expect(inside.mothers.size).toBeGreaterThan(0);
  });

  it("colours each species apart, and keys a portrait by what it shows", () => {
    const { herd } = herdOfOffice();
    for (const message of creaturesMessages.slice(0, 3)) herd.receive(message);
    const table = herd.colourTable();
    expect(table.length).toBeGreaterThan(1);
    expect(new Set(table.map(({ body }) => body)).size).toBe(table.length);
    expect(table.every(({ members }) => members > 0)).toBe(true);
    const id = first.ids[0] as number;
    const card = herd.cardOf(id);
    expect(card?.id).toBe(id);
    expect(card?.name).toBe(herd.names.get(herd.speciesOf(id)));
    const portrait = herd.portraitOf(id);
    expect(portrait?.key).toBe(herd.portraitOf(id)?.key);
    expect(herd.portraitOf(-1)).toBeNull();
  });

  it("draws a portrait anew as a young one grows", () => {
    const { herd } = herdOfOffice();
    const [a, b] = first.ids as [number, number];
    herd.receive(creatures({ ids: [a, b], born: [born(a), born(b)], young: [[b, 3]] }));
    const small = herd.portraitOf(b);
    expect(small?.seed.growth).toBeCloseTo(3 / 16);
    herd.receive(creatures({ ids: [a, b], young: [[b, 4]] }));
    expect(herd.portraitOf(b)?.key).not.toBe(small?.key);
    herd.receive(creatures({ ids: [a, b], young: [] }));
    expect(herd.portraitOf(b)?.seed.growth).toBeUndefined();
  });
});
