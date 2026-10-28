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
const counted = {
  colourPass: (input: ColourPassInput): ColourPassOutput | null => {
    const done = gpu?.colourPass(input) ?? null;
    if (done !== null) gpuPasses += 1;
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
  if (gpu === undefined && message.request.cpu !== true) gpu = GpuGround.create();
  const before = gpuPasses;
  paintKept(
    painting,
    message.request,
    cache,
    gpu === null || gpu === undefined ? null : counted,
  ).then(
    ({ pixels, fresh }) =>
      reply({ kind: "painted", pixels, landVersion: version, fresh, gpu: gpuPasses > before }),
    (error: unknown) =>
      reply({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
        landVersion: version,
      }),
  );
});
