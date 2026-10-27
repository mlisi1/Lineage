/// <reference lib="webworker" />
/**
 * The ground painter's worker (`painter.ts`): keeps the latest land, paints what it is
 * asked for on it, keeps the paintings it is asked to keep (`groundcache.ts`, R5: the
 * page's thread neither copies nor stores them), and sends the pixels back without
 * copying them.
 */
import { makeGroundCache } from "./groundcache";
import type { Land } from "./land";
import { paintKept, type FromWorker, type ToWorker } from "./painter";

declare const self: DedicatedWorkerGlobalScope;

let land: Land | null = null;
let landVersion = 0;
/** Where paintings are kept (`PaintRequest.keep`): the worker reads and writes it itself. */
const cache = makeGroundCache();

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
  paintKept(painting, message.request, cache).then(
    ({ pixels, fresh }) => reply({ kind: "painted", pixels, landVersion: version, fresh }),
    (error: unknown) =>
      reply({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
        landVersion: version,
      }),
  );
});
