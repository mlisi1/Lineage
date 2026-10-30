import { describe, expect, it } from "vitest";
import { FrameProbe, PHASES, summariseProbe, type ProbedFrame } from "../src/frameprobe";

const frame = (phases: Partial<ProbedFrame["phases"]>, notes: Record<string, number> = {}) => {
  const all = Object.fromEntries(PHASES.map((phase) => [phase, 0])) as ProbedFrame["phases"];
  return { phases: { ...all, ...phases }, notes };
};

describe("the frame probe (R5, Phase 0 of the optimization plan)", () => {
  it("records nothing while off, and each phase's time while on", () => {
    const probe = new FrameProbe();
    probe.enter("herd");
    probe.note("portrait-draw");
    probe.leave();
    expect(probe.next()).toEqual(frame({}));
    probe.enabled = true;
    probe.enter("herd");
    probe.enter("render");
    probe.leave();
    probe.charge("messages", 4);
    probe.note("creatures");
    probe.note("creatures");
    const seen = probe.next();
    expect(seen.phases.messages).toBe(4);
    expect(seen.phases.herd).toBeGreaterThanOrEqual(0);
    expect(seen.notes).toEqual({ creatures: 2 });
    expect(probe.next()).toEqual(frame({}));
  });

  it("blames a late frame on its longest phase, or on what is outside the script", () => {
    const summary = summariseProbe(
      [
        { frameMs: 33, probed: frame({ herd: 10, render: 5 }) },
        { frameMs: 80, probed: frame({ herd: 50, render: 10 }, { creatures: 1 }) },
        { frameMs: 200, probed: frame({ herd: 10, render: 10 }, { "ground-piece": 2 }) },
      ],
      35,
    );
    expect(summary.late_by_phase).toEqual({ herd: 1, outside: 1 });
    expect(summary.late_notes).toEqual({ creatures: 1, "ground-piece": 1 });
    expect(summary.worst[0]?.frame_ms).toBe(200);
    expect(summary.phases_ms_median.herd).toBe(10);
    expect(summary.phases_ms_p99.herd).toBe(50);
  });
});
