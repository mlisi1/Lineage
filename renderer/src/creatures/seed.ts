/** An animal as the creature layer draws it: its look, where it is and what the sim says of it. */
import type { Look } from "./body";
import type { Genome } from "./genome";

/** One animal to draw (R2's fixture seed; R3 on, from the stream). */
export interface CreatureSeed extends Look {
  x: number;
  y: number;
  genome: Genome;
  /** Its species as the sim has it, 0 for none yet (specimens, newcomers). */
  species: number;
  /** Its rare-gene slots (bits), as the sim has them. */
  slots: number;
  /** Lying torpid (a hibernator in winter or long darkness): curled up, still. */
  torpid: boolean;
  /** Cells it is kept within, when a picture wants it to stay in frame; the sim sets none. */
  pen?: { x0: number; y0: number; x1: number; y1: number };
}
