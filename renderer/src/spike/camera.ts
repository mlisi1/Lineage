/** Where the spike's camera looks: the whole island, or a panning close-up. */
import type { Shot } from "./scenarios";

export interface CellRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface View {
  /** Internal pixels per cell. */
  scale: number;
  /** Position of the world's top-left corner, in internal pixels. */
  x: number;
  y: number;
  /** The cells on screen. */
  cells: CellRect;
}

/** How much closer the close-up is than the wide shot. */
export const CLOSE_ZOOM = 4;
/** Seconds for one sweep of the close-up across the island, on each axis. */
const PAN_PERIOD_X_S = 40;
const PAN_PERIOD_Y_S = 27;
/** Share of the available travel the close-up uses, so it stays off the open sea. */
const PAN_REACH = 0.7;

/**
 * The view at time `tS` for a canvas of `width` × `height` internal pixels over a world
 * of `worldWidth` × `worldHeight` cells. The wide shot fits the world exactly.
 */
export function viewAt(
  shot: Shot,
  tS: number,
  width: number,
  height: number,
  worldWidth: number,
  worldHeight: number,
): View {
  const fit = width / worldWidth;
  if (shot === "wide") {
    return { scale: fit, x: 0, y: 0, cells: { x0: 0, y0: 0, x1: worldWidth, y1: worldHeight } };
  }
  const scale = fit * CLOSE_ZOOM;
  const halfWidth = width / scale / 2;
  const halfHeight = height / scale / 2;
  const centreX =
    worldWidth / 2 +
    (worldWidth / 2 - halfWidth) * PAN_REACH * Math.sin((2 * Math.PI * tS) / PAN_PERIOD_X_S);
  const centreY =
    worldHeight / 2 +
    (worldHeight / 2 - halfHeight) * PAN_REACH * Math.sin((2 * Math.PI * tS) / PAN_PERIOD_Y_S + 1);
  return {
    scale,
    x: -(centreX - halfWidth) * scale,
    y: -(centreY - halfHeight) * scale,
    cells: {
      x0: centreX - halfWidth,
      y0: centreY - halfHeight,
      x1: centreX + halfWidth,
      y1: centreY + halfHeight,
    },
  };
}

/** Does a block of cells [x, x + size) × [y, y + size) touch the view (with a margin)? */
export function chunkVisible(
  view: CellRect,
  x: number,
  y: number,
  size: number,
  margin: number,
): boolean {
  return (
    x + size >= view.x0 - margin &&
    x <= view.x1 + margin &&
    y + size >= view.y0 - margin &&
    y <= view.y1 + margin
  );
}
