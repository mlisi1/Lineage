/// <reference lib="webworker" />
/**
 * The ground painter's worker (`painter.ts`): keeps the latest land, paints what it is
 * asked for on it, keeps the paintings it is asked to keep (`groundcache.ts`, R5: the
 * page's thread neither copies nor stores them), and sends the pixels back without
 * copying them.
 */
import { GpuGround, type ColourPassInput, type ColourPassOutput } from "./gpuground";
import { makeGroundCache } from "./groundcache";
import type { Land } from "./land";
import { paintKept, type FromWorker, type ToWorker } from "./painter";

declare const self: DedicatedWorkerGlobalScope;

let land: Land | null = null;
let landVersion = 0;
/** Where paintings are kept (`PaintRequest.keep`): the worker reads and writes it itself. */
const cache = makeGroundCache();
/** The colour pass on this worker's own GPU context (`gpuground.ts`), made when first needed; null where there is none. */
let gpu: GpuGround | null | undefined;
/** Colour passes the GPU has done (a painting's reply says whether it did its). */
let gpuPasses = 0;
/** This painting's time on the GPU, summed over its colour passes (one, as a rule). */
const gpuTime = { uploadMs: 0, drawMs: 0, unpackMs: 0 };
/** Making the GPU context and its shader, charged to the painting that made it. */
let compileMs = 0;
const counted = {
  colourPass: (input: ColourPassInput): ColourPassOutput | null => {
    const done = gpu?.colourPass(input) ?? null;
    if (done !== null && gpu !== null && gpu !== undefined) {
      gpuPasses += 1;
      gpuTime.uploadMs += gpu.last.uploadMs;
      gpuTime.drawMs += gpu.last.drawMs;
      gpuTime.unpackMs += gpu.last.unpackMs;
    }
    return done;
  },
};

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.kind === "land") {
    land = message.land;
    landVersion = message.version;
    return;
  }
  // The land and its version as they are now: another may come while the cache is read.
  const painting = land;
  const version = landVersion;
  const reply = (answer: FromWorker): void => {
    const moved =
      answer.kind === "painted"
        ? [
            answer.pixels.rgba.buffer,
            ...(answer.pixels.shore === undefined ? [] : [answer.pixels.shore.buffer]),
          ]
        : [];
    self.postMessage(answer, moved);
  };
  if (painting === null) {
    reply({ kind: "failed", message: "painter: no land yet", landVersion: version });
    return;
  }
  if (gpu === undefined && message.request.cpu !== true) {
    const making = performance.now();
    gpu = GpuGround.create();
    compileMs = performance.now() - making;
  }
  const begun = performance.now();
  gpuTime.uploadMs = 0;
  gpuTime.drawMs = 0;
  gpuTime.unpackMs = 0;
  const before = gpuPasses;
  paintKept(
    painting,
    message.request,
    cache,
    gpu === null || gpu === undefined ? null : counted,
  ).then(
    ({ pixels, fresh }) => {
      reply({
        kind: "painted",
        pixels,
        landVersion: version,
        fresh,
        gpu: gpuPasses > before,
        timing: {
          totalMs: performance.now() - begun,
          gpuUploadMs: gpuTime.uploadMs,
          gpuDrawMs: gpuTime.drawMs,
          gpuUnpackMs: gpuTime.unpackMs,
          compileMs,
        },
      });
      compileMs = 0;
    },
    (error: unknown) =>
      reply({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
        landVersion: version,
      }),
  );
});
