/**
 * What drew the page: the graphics API PixiJS ended up with and the driver behind it, as
 * the benchmarks report it (the R0 spike's and the scene's, `bench.ts`). On the board the
 * first thing a frame rate needs beside it is whether the GPU drew it at all.
 */
import type { Renderer, WebGLRenderer } from "pixi.js";

export interface GpuInfo {
  /** "webgl", "webgpu" or "canvas": what PixiJS ended up using. */
  api: string;
  webgl_version: string;
  vendor: string;
  renderer: string;
  unmasked_vendor: string;
  unmasked_renderer: string;
  max_texture_size: number;
  /** A guess from the renderer string: drawn by the CPU, not a GPU. */
  software: boolean;
}

/** Driver names that mean the CPU draws: SwiftShader, Mesa's llvmpipe and softpipe. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software/i;

/** The API and driver of `renderer`, read from its WebGL context where it has one. */
export function gpuInfo(renderer: Renderer): GpuInfo {
  const info: GpuInfo = {
    api: renderer.name,
    webgl_version: "",
    vendor: "",
    renderer: "",
    unmasked_vendor: "",
    unmasked_renderer: "",
    max_texture_size: 0,
    software: false,
  };
  const gl = (renderer as Partial<WebGLRenderer>).gl;
  if (gl !== undefined) {
    const text = (parameter: number): string => String(gl.getParameter(parameter) ?? "");
    info.webgl_version = text(gl.VERSION);
    info.vendor = text(gl.VENDOR);
    info.renderer = text(gl.RENDERER);
    info.max_texture_size = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    if (debug !== null) {
      info.unmasked_vendor = text(debug.UNMASKED_VENDOR_WEBGL);
      info.unmasked_renderer = text(debug.UNMASKED_RENDERER_WEBGL);
    }
  }
  const names = `${info.renderer} ${info.unmasked_renderer}`;
  info.software = info.api === "canvas" || SOFTWARE.test(names);
  return info;
}
