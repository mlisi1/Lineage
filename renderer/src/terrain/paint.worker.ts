/// <reference lib="webworker" />
/**
 * The ground painter's worker (`painter.ts`): keeps the latest land, paints what it is
 * asked for on it, and sends the pixels back without copying them.
 */
import type { Land } from "./land";
import { paintRequest, type FromWorker, type ToWorker } from "./painter";

declare const self: DedicatedWorkerGlobalScope;

let land: Land | null = null;
let landVersion = 0;

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.kind === "land") {
    land = message.land;
    landVersion = message.version;
    return;
  }
  let reply: FromWorker;
  try {
    if (land === null) throw new Error("painter: no land yet");
    reply = { kind: "painted", pixels: paintRequest(land, message.request), landVersion };
  } catch (error) {
    reply = {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
      landVersion,
    };
  }
  const moved =
    reply.kind === "painted"
      ? [
          reply.pixels.rgba.buffer,
          ...(reply.pixels.shore === undefined ? [] : [reply.pixels.shore.buffer]),
        ]
      : [];
  self.postMessage(reply, moved);
});
