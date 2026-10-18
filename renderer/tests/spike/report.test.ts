import { describe, expect, it } from "vitest";

import { drawnBy } from "../../src/spike/report";
import type { GpuInfo } from "../../src/spike/scene";

function gpu(overrides: Partial<GpuInfo>): GpuInfo {
  return {
    api: "webgl",
    webgl_version: "WebGL 2.0",
    vendor: "WebKit",
    renderer: "WebKit WebGL",
    unmasked_vendor: "",
    unmasked_renderer: "",
    max_texture_size: 4096,
    software: false,
    ...overrides,
  };
}

describe("what drew the page", () => {
  it("names the driver behind WebGL", () => {
    expect(drawnBy(gpu({ unmasked_renderer: "Mali-G31 (Panfrost)" }), "webgl")).toBe(
      "WebGL on Mali-G31 (Panfrost)",
    );
    expect(drawnBy(gpu({}), "webgl")).toBe("WebGL on WebKit WebGL");
  });

  it("says when WebGL runs on the CPU", () => {
    expect(drawnBy(gpu({ unmasked_renderer: "llvmpipe", software: true }), "webgl")).toBe(
      "WebGL on llvmpipe (software, on the CPU)",
    );
  });

  it("says when the browser had no WebGL and the canvas took over", () => {
    const canvas = gpu({ api: "canvas", renderer: "", software: true });
    expect(drawnBy(canvas, "webgl")).toBe("2D canvas, on the CPU (WebGL was not available)");
    expect(drawnBy(canvas, "canvas")).toBe("2D canvas, on the CPU");
  });

  it("copes with a scene that never started", () => {
    expect(drawnBy(null, "webgl")).toBe("nothing: the scene never started");
  });
});
