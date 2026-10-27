/**
 * What the showcase writes over the scene (R5): an act's line on a ribbon at the foot of
 * the screen, a title in large letters, and, on the board, a small frame counter in the
 * top-right corner. Page elements over the scene's canvas, as the scroll is, painted in the
 * scroll's hand only when what they say changes, at the art pixel's size.
 */
import { HAND_FONT, HAND_ROWS, CAPTION_FONT, GLYPH_ROWS } from "../pixelfont";
import { RIBBON, RIBBON_LETTERS, RIBBON_SHADE, RIBBON_TAIL } from "../illumination";

/** Art pixels round the line on its ribbon, and between the ribbon and the screen's foot. */
const RIBBON_PAD_X = 8;
const RIBBON_PAD_Y = 4;
const RIBBON_FOOT = 14;
/** The title's letters, so many art pixels to a pixel of the hand. */
const TITLE_SCALE = 4;
/** The title's outline and fill. */
const TITLE_INK = 0x2a1810;
const TITLE_FILL = 0xfff1b8;

type Put = (x: number, y: number, colour: number) => void;

/** An RGBA picture of `width` x `height` with a pixel setter. */
function picture(width: number, height: number): { data: ImageData; put: Put } {
  const data = new ImageData(width, height);
  const put: Put = (x, y, colour) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = 4 * (Math.floor(y) * width + Math.floor(x));
    data.data[at] = (colour >> 16) & 255;
    data.data[at + 1] = (colour >> 8) & 255;
    data.data[at + 2] = colour & 255;
    data.data[at + 3] = 255;
  };
  return { data, put };
}

/** A canvas over the whole scene, its pixels the art's, drawn without smoothing. */
function layer(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const style = canvas.style;
  style.position = "absolute";
  style.inset = "0";
  style.width = "100%";
  style.height = "100%";
  style.imageRendering = "pixelated";
  style.pointerEvents = "none";
  style.opacity = "0";
  return canvas;
}

/** Paint `line` on a ribbon centred at the foot of a `width` x `height` picture. */
export function paintLine(line: string, width: number, height: number, put: Put): void {
  const text = HAND_FONT.measure(line);
  const ribbonWidth = text + 2 * RIBBON_PAD_X;
  const ribbonHeight = HAND_ROWS + 2 * RIBBON_PAD_Y;
  const left = Math.round((width - ribbonWidth) / 2);
  const top = height - RIBBON_FOOT - ribbonHeight;
  for (let y = 0; y < ribbonHeight; y++) {
    for (let x = 0; x < ribbonWidth; x++) {
      const edge = y === 0 || y === ribbonHeight - 1;
      put(left + x, top + y, edge ? RIBBON_SHADE : RIBBON);
    }
  }
  // Its forked tails, a little lower, either side.
  for (let y = 0; y < ribbonHeight; y++) {
    const cut = Math.abs(y - ribbonHeight / 2) < 2 ? 3 : 0;
    for (let x = cut; x < 6; x++) {
      put(left - 6 + x, top + 3 + y, RIBBON_TAIL);
      put(left + ribbonWidth + 5 - x, top + 3 + y, RIBBON_TAIL);
    }
  }
  HAND_FONT.draw(line, left + RIBBON_PAD_X, top + RIBBON_PAD_Y, (x, y) =>
    put(x, y, RIBBON_LETTERS),
  );
}

/** Paint `title` in large letters, outlined, centred a little above the middle. */
export function paintTitle(title: string, width: number, height: number, put: Put): void {
  const s = TITLE_SCALE;
  const left = Math.round((width - HAND_FONT.measure(title) * s) / 2);
  const top = Math.round(height * 0.4 - (HAND_ROWS * s) / 2);
  const ink = new Set<string>();
  HAND_FONT.draw(title, 0, 0, (x, y) => ink.add(`${x},${y}`));
  const fill = (dx: number, dy: number, colour: number): void => {
    for (const key of ink) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      for (let v = 0; v < s; v++) {
        for (let u = 0; u < s; u++) put(left + x * s + u + dx, top + y * s + v + dy, colour);
      }
    }
  };
  // The outline: the letters drawn round about, then over it the letters themselves.
  for (const [dx, dy] of [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
    [-2, -2],
    [2, 2],
    [-2, 2],
    [2, -2],
  ] as const) {
    fill(dx, dy, TITLE_INK);
  }
  fill(0, 3, TITLE_INK);
  fill(0, 0, TITLE_FILL);
}

/** The showcase's writing over the scene: its line, its title and the frame counter. */
export class Overlay {
  readonly line: HTMLCanvasElement;
  readonly title: HTMLCanvasElement;
  readonly counter: HTMLCanvasElement;
  private lineShown = "";
  private titleShown = "";
  private counterShown = "";

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.line = layer(width, height);
    this.title = layer(width, height);
    // The counter: a strip in the top-right corner, always shown when asked for.
    this.counter = document.createElement("canvas");
    this.counter.width = 72;
    this.counter.height = GLYPH_ROWS + 4;
    const style = this.counter.style;
    style.position = "absolute";
    style.top = "1%";
    style.right = "1%";
    style.width = `${(100 * this.counter.width) / width}%`;
    style.height = `${(100 * this.counter.height) / height}%`;
    style.imageRendering = "pixelated";
    style.pointerEvents = "none";
    style.display = "none";
  }

  /**
   * Show `line` and `title` ("" for none), `shown` of the way in (0–1): the showcase eases
   * them in and out on its own clock, so that a film of it fades them as the screen does.
   */
  show(line: string, title: string, shown: number): void {
    if (line !== this.lineShown) {
      this.lineShown = line;
      this.repaint(
        this.line,
        line === "" ? null : (put) => paintLine(line, this.width, this.height, put),
      );
    }
    if (title !== this.titleShown) {
      this.titleShown = title;
      this.repaint(
        this.title,
        title === "" ? null : (put) => paintTitle(title, this.width, this.height, put),
      );
    }
    const opacity = String(Math.round(shown * 100) / 100);
    if (this.line.style.opacity !== opacity) this.line.style.opacity = line === "" ? "0" : opacity;
    if (this.title.style.opacity !== opacity)
      this.title.style.opacity = title === "" ? "0" : opacity;
  }

  /** The frame counter's text, such as "30 FPS"; shown once first set. */
  count(text: string): void {
    this.counter.style.display = "block";
    if (text === this.counterShown) return;
    this.counterShown = text;
    const { width, height } = this.counter;
    const { data, put } = picture(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, 0x10081c);
    const left = width - 2 - CAPTION_FONT.measure(text);
    CAPTION_FONT.draw(text, left, 2, (x, y) => put(x, y, 0xfff1b8));
    this.counter.getContext("2d")?.putImageData(data, 0, 0);
  }

  private repaint(canvas: HTMLCanvasElement, paint: ((put: Put) => void) | null): void {
    const { data, put } = picture(canvas.width, canvas.height);
    paint?.(put);
    canvas.getContext("2d")?.putImageData(data, 0, 0);
  }
}
