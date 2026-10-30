/// <reference lib="webworker" />
/**
 * The plants' worker (R5, the optimization plan): draws a sheet of the standing plants'
 * drawings (`standing.ts`, `sheetArts`) and colours and packs it into pages, off the
 * page's thread, while a view is prepared ahead (`plants.ts`, `prepareStanding`). The
 * pages go back without being copied.
 */
import { DEFAULT_LOOK, LOOKS } from "../looks";
import { packSheet, sheetArts, type SheetReply, type SheetRequest } from "./standing";

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener("message", (event: MessageEvent<SheetRequest>) => {
  const { id, land, ask, kept } = event.data;
  const look = LOOKS.find((candidate) => candidate.name === ask.look) ?? DEFAULT_LOOK;
  const arts = kept ?? sheetArts(land, { ...ask, look });
  const packed = packSheet(arts, look.plants);
  const moved = new Set<ArrayBuffer>(packed.pages.map(({ rgba }) => rgba.buffer));
  // The drawings drawn here go back without a copy too (each its own buffer).
  if (kept === undefined) {
    for (const { art } of arts) {
      if (art.ink.buffer instanceof ArrayBuffer) moved.add(art.ink.buffer);
    }
  }
  const reply: SheetReply = kept === undefined ? { id, arts, packed } : { id, packed };
  self.postMessage(reply, [...moved]);
});
