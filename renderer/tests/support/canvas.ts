/**
 * A stand-in for the browser's 2D canvas, so that code drawing its sprites into canvases
 * (the plants' sheets, the atmosphere's small drawings) runs under vitest in Node. The
 * canvas keeps what is put on it: the pixels laid with `putImageData` and the cells
 * filled with `fillRect`, for a test to look at if it wants.
 */
import { vi } from "vitest";

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

class FakeContext {
  fillStyle = "";
  readonly filled: { x: number; y: number; style: string }[] = [];
  putImageData(): void {}
  createImageData(width: number, height: number): FakeImageData {
    return new FakeImageData(new Uint8ClampedArray(width * height * 4), width, height);
  }
  fillRect(x: number, y: number): void {
    this.filled.push({ x, y, style: this.fillStyle });
  }
}

class FakeCanvas {
  width = 1;
  height = 1;
  readonly context = new FakeContext();
  getContext(): FakeContext {
    return this.context;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

/** Put the fake canvas in place of the browser's, for the file's tests. */
export function fakeCanvas(): void {
  vi.stubGlobal("HTMLCanvasElement", FakeCanvas);
  vi.stubGlobal("ImageData", FakeImageData);
  vi.stubGlobal("document", { createElement: () => new FakeCanvas() });
}
