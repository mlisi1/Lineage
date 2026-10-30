/// <reference lib="webworker" />
/**
 * The plants' worker (R5, the optimization plan): draws a sheet of the standing plants'
 * drawings (`standing.ts`, `sheetArts`) and colours and packs it into pages, off the
 * page's thread, while a view is prepared ahead (`plants.ts`, `prepareStanding`). The
 * pages go back without being copied.
 */
import { DEFAULT_LOOK, LOOKS } from "../looks";
import {
  packSheet,
  sheetArts,
  type PackedSheet,
  type SheetReply,
  type SheetRequest,
} from "./standing";

declare const self: DedicatedWorkerGlobalScope;

/** `packed` with its pages made into bitmaps here, where this worker can; as it is if not. */
function bitmapped(packed: PackedSheet): PackedSheet {
  if (typeof OffscreenCanvas === "undefined") return packed;
  const bitmaps: ImageBitmap[] = [];
  for (const { width, height, rgba } of packed.pages) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) return packed;
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
    bitmaps.push(canvas.transferToImageBitmap());
  }
  return {
    ...packed,
    pages: packed.pages.map(({ width, height }) => ({
      width,
      height,
      rgba: new Uint8ClampedArray(0),
    })),
    bitmaps,
  };
}

self.addEventListener("message", (event: MessageEvent<SheetRequest>) => {
  const { id, land, ask, kept } = event.data;
  const look = LOOKS.find((candidate) => candidate.name === ask.look) ?? DEFAULT_LOOK;
  const arts = kept ?? sheetArts(land, { ...ask, look });
  const packed = bitmapped(packSheet(arts, look.plants));
  const moved = new Set<Transferable>([
    ...packed.pages.map(({ rgba }) => rgba.buffer),
    ...(packed.bitmaps ?? []),
  ]);
  // The drawings drawn here go back without a copy too (each its own buffer).
  if (kept === undefined) {
    for (const { art } of arts) {
      if (art.ink.buffer instanceof ArrayBuffer) moved.add(art.ink.buffer);
    }
  }
  const reply: SheetReply = kept === undefined ? { id, arts, packed } : { id, packed };
  self.postMessage(reply, [...moved]);
});
