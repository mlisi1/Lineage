/**
 * A stand-in for the browser's 2D canvas, for the unit tests (which run in Node): it keeps
 * the pixels drawn (`fillRect` of whole pixels, `putImageData`), so that a test can read
 * back a drawing made of art pixels, and is enough for Pixi to wrap in a texture source.
 */
import { vi } from "vitest";

export class FakeImageData {
  readonly data: Uint8ClampedArray;
  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(dataOrWidth * widthOrHeight * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? dataOrWidth.length / 4 / widthOrHeight;
    }
  }
  readonly width: number;
  readonly height: number;
}

/** The 2D context: what was filled, colour by pixel ("x,y" → fill style or RGBA). */
export class FakeContext {
  fillStyle = "#000000";
  readonly pixels = new Map<string, string>();
  constructor(readonly canvas: FakeCanvas) {}
  fillRect(x: number, y: number, w: number, h: number): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) this.pixels.set(`${x + i},${y + j}`, this.fillStyle);
  }
  createImageData(width: number, height: number): FakeImageData {
    return new FakeImageData(width, height);
  }
  putImageData(image: FakeImageData, x: number, y: number): void {
    for (let j = 0; j < image.height; j++) {
      for (let i = 0; i < image.width; i++) {
        const at = (j * image.width + i) * 4;
        if ((image.data[at + 3] ?? 0) === 0) continue;
        const rgba = [...image.data.subarray(at, at + 4)].join(",");
        this.pixels.set(`${x + i},${y + j}`, `rgba(${rgba})`);
      }
    }
  }
}

export class FakeCanvas {
  width = 0;
  height = 0;
  readonly style = {};
  readonly context = new FakeContext(this);
  getContext(): FakeContext {
    return this.context;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  /** Rows of the canvas from (x0, y0), `#` where anything was drawn and `.` where not. */
  rows(x0 = 0, y0 = 0, wide = this.width, tall = this.height): string[] {
    return Array.from({ length: tall }, (_, y) =>
      Array.from({ length: wide }, (_, x) =>
        this.context.pixels.has(`${x0 + x},${y0 + y}`) ? "#" : ".",
      ).join(""),
    );
  }
}

/** Every canvas made since `installCanvas`. */
export const canvases: FakeCanvas[] = [];

/** Put the stand-in in place of `document.createElement("canvas")`, `ImageData` and `HTMLCanvasElement`. */
export function installCanvas(): void {
  vi.stubGlobal("document", {
    createElement: (tag: string): FakeCanvas => {
      if (tag !== "canvas") throw new Error(`no ${tag} in the tests' document`);
      const canvas = new FakeCanvas();
      canvases.push(canvas);
      return canvas;
    },
  });
  vi.stubGlobal("ImageData", FakeImageData);
  // So that Pixi takes it for a canvas when asked to make a texture of it.
  vi.stubGlobal("HTMLCanvasElement", FakeCanvas);
}
