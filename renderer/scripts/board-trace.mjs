/**
 * Trace the scene on the board and say what the late frames held (R5, the optimization
 * plan, Phase 0): the frame probe puts many late frames down to "outside" the page's
 * script; a trace of the browser itself tells garbage collection, the GPU process and the
 * compositor apart.
 *
 *   on the board: probe.conf "<scenario> dist-kiosk", then start lineage-r5-probe@<user>
 *   on the PC:    ssh -N -L 9222:localhost:9222 lineage@<board> &
 *                 node scripts/board-trace.mjs [seconds=8] [wait=20] [out=board-trace.json]
 *                 (`CDP_PORT=…` for another port than 9222; on a PC, `THROTTLE=6` slows the
 *                 page's CPU about to the board's)
 *
 * It waits `wait` seconds (the scenario loads, settles and starts measuring), records
 * `seconds` of trace through the page's DevTools port, writes the raw trace to `out`
 * (open it in chrome://tracing or Perfetto) and prints, for every frame later than the
 * cap allows, how long each kind of work ran during it.
 */
import { writeFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

const [seconds = "8", wait = "20", out = "board-trace.json"] = process.argv.slice(2);
const CATEGORIES = [
  "toplevel",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "blink.user_timing",
  "v8",
  "v8.gc",
  "gpu",
  "viz",
  "cc",
].join(",");
/** A frame this much later than the one before is late (the cap's 33.3 ms and slack). */
const LATE_MS = 35.3;

const browser = await chromium.connectOverCDP(`http://localhost:${process.env.CDP_PORT ?? "9222"}`);
// On a PC, `THROTTLE=6` slows the page's CPU about to the board's, so that frames come late.
const throttle = Number(process.env.THROTTLE ?? "1");
if (throttle > 1) {
  const page = browser.contexts().flatMap((context) => context.pages())[0];
  if (page === undefined) throw new Error("no page to slow down");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  console.log(`page's CPU slowed ${throttle} times`);
}
console.log(`connected; waiting ${wait} s for the scenario to settle`);
await sleep(Number(wait) * 1000);
const session = await browser.newBrowserCDPSession();
const events = [];
session.on("Tracing.dataCollected", ({ value }) => events.push(...value));
const done = new Promise((resolve) => session.once("Tracing.tracingComplete", resolve));
await session.send("Tracing.start", {
  traceConfig: { includedCategories: CATEGORIES.split(","), recordMode: "recordContinuously" },
  transferMode: "ReportEvents",
});
await sleep(Number(seconds) * 1000);
await session.send("Tracing.end");
await done;
await browser.close().catch(() => undefined);
writeFileSync(out, JSON.stringify({ traceEvents: events }));
console.log(`${events.length} events written to ${out}`);

// Which thread is which, by the names the trace gives them.
const names = new Map();
for (const event of events) {
  if (event.ph === "M" && event.name === "thread_name") {
    names.set(`${event.pid}:${event.tid}`, event.args?.name ?? "");
  }
}
const threadOf = (event) => names.get(`${event.pid}:${event.tid}`) ?? "";
// The page's frames: each frame drawn leaves a mark (`bench.ts`, under the cap the
// animation frames fire twice as often as frames are drawn).
const frames = [
  ...new Set(events.filter((e) => e.name === "lineage:frame").map((e) => e.ts / 1000)),
].sort((a, b) => a - b);
// What runs, by kind: complete events with a duration, on the threads that matter.
const KINDS = [
  ["gc (page)", (e, t) => t === "CrRendererMain" && /GC|Scavenge|MarkCompact/i.test(e.name)],
  [
    "script (page)",
    (e, t) =>
      t === "CrRendererMain" && /FunctionCall|FireAnimationFrame|EvaluateScript/.test(e.name),
  ],
  ["page other", (e, t) => t === "CrRendererMain" && e.name === "RunTask"],
  [
    "gpu process",
    (e, t) =>
      t === "CrGpuMain" && (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask"),
  ],
  [
    "compositor",
    (e, t) =>
      /VizCompositor/.test(t) &&
      (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask"),
  ],
  ["workers", (e, t) => /DedicatedWorker/.test(t) && e.name === "RunTask"],
];
const spans = KINDS.map(([kind, test]) => ({
  kind,
  spans: events
    .filter((e) => e.ph === "X" && typeof e.dur === "number" && test(e, threadOf(e)))
    .map((e) => [e.ts / 1000, (e.ts + e.dur) / 1000]),
}));
const overlap = (list, from, to) => {
  let total = 0;
  for (const [a, b] of list) total += Math.max(0, Math.min(b, to) - Math.max(a, from));
  return total;
};
const late = [];
for (let k = 1; k < frames.length; k++) {
  const gap = (frames[k] ?? 0) - (frames[k - 1] ?? 0);
  if (gap > LATE_MS) late.push([frames[k - 1] ?? 0, frames[k] ?? 0]);
}
console.log(`${frames.length} frames traced, ${late.length} late`);
const sums = Object.fromEntries(spans.map(({ kind }) => [kind, 0]));
for (const [from, to] of late) {
  const parts = spans.map(({ kind, spans: list }) => [kind, overlap(list, from, to)]);
  for (const [kind, ms] of parts) sums[kind] += ms;
  const shown = parts
    .filter(([, ms]) => ms >= 1)
    .map(([kind, ms]) => `${kind} ${ms.toFixed(0)}`)
    .join(", ");
  console.log(`  late frame of ${(to - from).toFixed(0)} ms: ${shown || "nothing traced"}`);
}
if (late.length > 0) {
  console.log("in all the late frames, ms:");
  for (const [kind, ms] of Object.entries(sums))
    console.log(`  ${kind.padEnd(14)} ${ms.toFixed(0)}`);
}
