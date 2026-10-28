/**
 * Where a frame's time goes, phase by phase, and what happened in it (R5, the plan for
 * optimizing the renderer, Phase 0): the benchmark turns it on to tell, for every frame
 * over budget, which phase took the time and what the page was doing then (a message
 * received, a portrait drawn, ground placed). Off, as on the desk, it costs a check of
 * one flag per call.
 */

/** The phases of a frame, in the order the page runs them. */
export const PHASES = [
  "messages",
  "director",
  "landscape",
  "herd",
  "atmosphere",
  "overlays",
  "render",
] as const;
export type Phase = (typeof PHASES)[number];

/** One frame as the probe saw it. */
export interface ProbedFrame {
  /** Milliseconds each phase took. */
  phases: Record<Phase, number>;
  /** What happened during it, and how often (a message's type, "portrait", "ground"...). */
  notes: Record<string, number>;
}

export class FrameProbe {
  /** Whether it records anything; off unless the benchmark turns it on. */
  enabled = false;
  private started = 0;
  private current: Phase | null = null;
  private frame: ProbedFrame = blank();

  /** A new frame begins: what the last one held is handed back. */
  next(): ProbedFrame {
    const done = this.frame;
    this.frame = blank();
    this.current = null;
    return done;
  }

  /** Phase `phase` begins now (the one before, if any, ends). */
  enter(phase: Phase): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (this.current !== null) this.frame.phases[this.current] += now - this.started;
    this.current = phase;
    this.started = now;
  }

  /** The phase under way ends now. */
  leave(): void {
    if (!this.enabled || this.current === null) return;
    this.frame.phases[this.current] += performance.now() - this.started;
    this.current = null;
  }

  /** `ms` more of `phase` in this frame: work done between frames (a message received). */
  charge(phase: Phase, ms: number): void {
    if (this.enabled) this.frame.phases[phase] += ms;
  }

  /** Something that happened in this frame (counted). */
  note(what: string): void {
    if (!this.enabled) return;
    this.frame.notes[what] = (this.frame.notes[what] ?? 0) + 1;
  }
}

function blank(): ProbedFrame {
  const phases = {} as Record<Phase, number>;
  for (const phase of PHASES) phases[phase] = 0;
  return { phases, notes: {} };
}

/** The page's one probe. */
export const PROBE = new FrameProbe();

/** What the benchmark reports of the probed frames of a scenario. */
export interface ProbeSummary {
  /** Median and 99th percentile of each phase (ms). */
  phases_ms_median: Record<Phase, number>;
  phases_ms_p99: Record<Phase, number>;
  /** Frames over budget by the phase that took the most of them; "outside" when the page's script was not where the time went (garbage collection, the GPU, the compositor). */
  late_by_phase: Record<string, number>;
  /** How many frames over budget had each note. */
  late_notes: Record<string, number>;
  /** The worst frames: how long, the phases and the notes. */
  worst: { frame_ms: number; phases: Record<Phase, number>; notes: Record<string, number> }[];
}

/** Of a frame's time, the share the script must have taken for it to be the cause. */
const OUTSIDE_BELOW = 0.5;
/** Worst frames kept. */
const WORST_KEPT = 5;

/**
 * Summarise `frames` (each with the time since the frame before, `frameMs`), those over
 * `lateMs` being the late ones.
 */
export function summariseProbe(
  frames: readonly { frameMs: number; probed: ProbedFrame }[],
  lateMs: number,
): ProbeSummary {
  const sorted = (phase: Phase): number[] =>
    frames.map(({ probed }) => probed.phases[phase]).sort((a, b) => a - b);
  const at = (values: number[], share: number): number =>
    values.length === 0
      ? 0
      : (values[Math.min(Math.floor(share * values.length), values.length - 1)] ?? 0);
  const round = (value: number): number => Math.round(value * 100) / 100;
  const phases_ms_median = {} as Record<Phase, number>;
  const phases_ms_p99 = {} as Record<Phase, number>;
  for (const phase of PHASES) {
    const values = sorted(phase);
    phases_ms_median[phase] = round(at(values, 0.5));
    phases_ms_p99[phase] = round(at(values, 0.99));
  }
  const late_by_phase: Record<string, number> = {};
  const late_notes: Record<string, number> = {};
  for (const { frameMs, probed } of frames) {
    if (frameMs <= lateMs) continue;
    let script = 0;
    let most: Phase = PHASES[0];
    for (const phase of PHASES) {
      script += probed.phases[phase];
      if (probed.phases[phase] > probed.phases[most]) most = phase;
    }
    const cause = script < OUTSIDE_BELOW * frameMs ? "outside" : most;
    late_by_phase[cause] = (late_by_phase[cause] ?? 0) + 1;
    for (const note of Object.keys(probed.notes).sort()) {
      late_notes[note] = (late_notes[note] ?? 0) + 1;
    }
  }
  const worst = [...frames]
    .sort((a, b) => b.frameMs - a.frameMs)
    .slice(0, WORST_KEPT)
    .map(({ frameMs, probed }) => {
      const phases = {} as Record<Phase, number>;
      for (const phase of PHASES) phases[phase] = round(probed.phases[phase]);
      return { frame_ms: round(frameMs), phases, notes: { ...probed.notes } };
    });
  return { phases_ms_median, phases_ms_p99, late_by_phase, late_notes, worst };
}
