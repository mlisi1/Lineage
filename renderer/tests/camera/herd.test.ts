import { describe, expect, it } from "vitest";
import { Roster } from "../../src/herd";
import type { CreaturesMessage } from "../../src/protocol";

const GENOME = Array.from({ length: 14 }, () => 0.5);

function creatures(ids: number[], born: number[], torpid: number[] = []): CreaturesMessage {
  return {
    type: "creatures",
    protocol: 1,
    t_ms: 0,
    ids,
    positions: ids.map((id) => [id, id + 0.5]),
    species: ids.map((id) => (id % 2) + 1),
    born: born.map((id) => ({ id, genome: GENOME, slots: id === 3 ? 4 : 0 })),
    torpid,
  };
}

describe("the roster of the stream's animals", () => {
  it("gives each newcomer a slot, and the slots of the dead to the next born", () => {
    const roster = new Roster();
    expect(roster.take(creatures([1, 2, 3], [1, 2, 3]))).toEqual({
      placed: [
        { slot: 0, id: 1 },
        { slot: 1, id: 2 },
        { slot: 2, id: 3 },
      ],
      removed: [],
    });
    // 2 dies, 4 is born: it takes 2's slot.
    expect(roster.take(creatures([1, 3, 4], [4]))).toEqual({
      placed: [{ slot: 1, id: 4 }],
      removed: [1],
    });
    expect(roster.slotOf(2)).toBeUndefined();
    expect(roster.slotOf(4)).toBe(1);
    // Nobody new: nothing placed.
    expect(roster.take(creatures([1, 3, 4], []))).toEqual({ placed: [], removed: [] });
  });

  it("keeps each genome from its one sending until the animal dies", () => {
    const roster = new Roster();
    roster.take(creatures([1, 3], [1, 3]));
    roster.take(creatures([1, 3], []));
    expect(roster.genomes.get(3)).toEqual({ genome: GENOME, slots: 4 });
    roster.take(creatures([1], []));
    expect(roster.genomes.has(3)).toBe(false);
  });

  it("knows where each is, of which species, and who sleeps, as of the last message", () => {
    const roster = new Roster();
    roster.take(creatures([1, 2], [1, 2], [2]));
    expect(roster.where.get(2)).toEqual({ x: 2, y: 2.5 });
    expect(roster.species.get(2)).toBe(1);
    expect(roster.torpid.has(2)).toBe(true);
    roster.take(creatures([1, 2], []));
    expect(roster.torpid.has(2)).toBe(false);
    expect(roster.ids).toEqual([1, 2]);
  });

  it("does not place an animal whose genome never came", () => {
    const roster = new Roster();
    expect(roster.take(creatures([1, 2], [1])).placed).toEqual([{ slot: 0, id: 1 }]);
  });
});
