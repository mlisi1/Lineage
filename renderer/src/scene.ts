/** Scene geometry shared by the desk kiosk (1024×600) and the phone. */

/** Native resolution of the desk display (Waveshare 7", CLAUDE.md §2). */
export const DESIGN_WIDTH = 1024;
export const DESIGN_HEIGHT = 600;

export interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Letterbox the design-size scene into a viewport: uniform scale, centred, never
 * cropped. On the desk display this is the identity.
 */
export function fitToViewport(
  viewWidth: number,
  viewHeight: number,
  designWidth = DESIGN_WIDTH,
  designHeight = DESIGN_HEIGHT,
): Fit {
  if (viewWidth <= 0 || viewHeight <= 0) {
    return { scale: 0, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(viewWidth / designWidth, viewHeight / designHeight);
  return {
    scale,
    offsetX: (viewWidth - designWidth * scale) / 2,
    offsetY: (viewHeight - designHeight * scale) / 2,
  };
}
