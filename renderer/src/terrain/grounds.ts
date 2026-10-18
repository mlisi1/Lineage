/**
 * The grounds of the three views, painted off the frame (`painter.ts`) and faded in.
 *
 *   WholeGround   one picture of the whole world: the map (2 art pixels to the cell) and
 *                 the middle view (8). Repainted when the land changes, once a sim-day.
 *   PieceGround   the local view (32), whose whole world would be 8192 × 4800: pieces of
 *                 8 × 8 cells painted as the camera comes near them, nearest first, a ring
 *                 of them ahead, forgotten when far behind.
 *
 * A new painting does not replace the old at once: it fades in over `FADE_S` on top of
 * it, so that the day's growth, a fire's scar or the turn of the season comes over the
 * land gently, and the old one goes when the new one is fully there.
 */
import { CanvasSource, Container, Sprite, Texture } from "pixi.js";
import type { CellRect } from "./land";
import { Dropped, type PaintRequest, type Painter } from "./painter";
import type { Pixels } from "./pixels";

/** Seconds a new painting takes to come over the old. */
export const FADE_S = 2;
/** Cells per side of a piece of a close ground, how many are kept, the margin painted round each. */
export const PIECE_CELLS = 8;
const PIECES_KEPT = 60;
const PIECE_MARGIN = 1;
/** Pieces this many cells beyond the view are painted too, so that the camera finds them ready. */
const AHEAD_CELLS = 4;

/** Pixels as a sprite of `tile` texels to the cell, its corner on cell (x, y). */
export function pixelSprite(pixels: Pixels, tile: number, x = 0, y = 0): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas");
  context.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
  const sprite = new Sprite(
    new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }) }),
  );
  sprite.scale.set(1 / tile);
  sprite.position.set(x, y);
  return sprite;
}

/** A sprite fading in over another, which goes once the new one is all there. */
class Fade {
  private age = 0;

  constructor(
    readonly incoming: Sprite,
    private readonly outgoing: Sprite | null,
    private readonly seconds: number,
  ) {
    incoming.alpha = seconds > 0 && outgoing !== null ? 0 : 1;
    if (incoming.alpha === 1) this.finish();
  }

  get done(): boolean {
    return this.incoming.alpha >= 1;
  }

  /** Move on by `dtS`; true once finished. */
  step(dtS: number): boolean {
    if (this.done) return true;
    this.age += dtS;
    this.incoming.alpha = Math.min(this.age / this.seconds, 1);
    if (this.done) this.finish();
    return this.done;
  }

  /** Done at once. */
  finish(): void {
    this.incoming.alpha = 1;
    this.outgoing?.destroy({ texture: true, textureSource: true });
  }
}

/** One picture of the whole world, repainted when asked and faded in. */
export class WholeGround {
  readonly container = new Container();
  private current: Sprite | null = null;
  private fade: Fade | null = null;
  /** Bumped by every request, so that only the latest is shown. */
  private asked = 0;

  constructor(
    private readonly painter: Painter,
    readonly tile: number,
    private readonly fadeS = FADE_S,
  ) {}

  /** Whether a painting is on the screen, and none is coming. */
  get settled(): boolean {
    return this.current !== null && this.fade === null && this.waiting === 0;
  }
  private waiting = 0;

  /** Paint `request` (at this ground's tile, the whole world) and fade it in when it comes. */
  async repaint(request: Omit<PaintRequest, "tile" | "cells">, priority = 10): Promise<void> {
    const mine = ++this.asked;
    // A painting asked for before and not yet started is not wanted any more.
    this.painter.drop((queued) => queued.tile === this.tile && queued.cells === undefined);
    this.waiting += 1;
    try {
      const { pixels } = await this.painter.paint({ ...request, tile: this.tile }, priority);
      if (mine !== this.asked) return;
      const sprite = pixelSprite(pixels, this.tile);
      this.container.addChild(sprite);
      this.fade?.finish();
      this.fade = new Fade(sprite, this.current, this.current === null ? 0 : this.fadeS);
      this.current = sprite;
      if (this.fade.done) this.fade = null;
    } catch (error) {
      if (!(error instanceof Dropped)) throw error;
    } finally {
      this.waiting -= 1;
    }
  }

  tick(dtS: number): void {
    if (this.fade?.step(dtS) === true) this.fade = null;
  }
}

interface Piece {
  sprite: Sprite | null;
  /** The land version it was painted from, and the one being painted for it, if any. */
  painted: number;
  asked: number;
  fade: Fade | null;
}

/** The ground of the local view, a piece at a time. */
export class PieceGround {
  readonly container = new Container();
  private readonly pieces = new Map<number, Piece>();
  private landVersion = 0;
  private request: Omit<PaintRequest, "tile" | "cells"> | null = null;
  private shadowsOf: ((cells: CellRect) => PaintRequest["shadows"]) | null = null;
  private centre = { x: 0, y: 0 };

  constructor(
    private readonly painter: Painter,
    readonly tile: number,
    private readonly world: { width: number; height: number },
    private readonly fadeS = FADE_S,
  ) {}

  /**
   * The land has changed (or the season, or what stands on it): paint every piece kept
   * again from `request`, each fading in over its old self. `shadows` says what throws a
   * shadow on given cells.
   */
  update(
    landVersion: number,
    request: Omit<PaintRequest, "tile" | "cells">,
    shadows: (cells: CellRect) => PaintRequest["shadows"],
  ): void {
    this.landVersion = landVersion;
    this.request = request;
    this.shadowsOf = shadows;
    // What was asked for an older land is not wanted any more.
    this.painter.drop((queued) => queued.tile === this.tile);
    for (const [key, piece] of this.pieces) {
      piece.asked = 0;
      this.ask(key, piece);
    }
  }

  /** Pieces painted from the latest land, of those the view needs. */
  ready(view: CellRect): boolean {
    return this.keys(view, 0).every(
      (key) => (this.pieces.get(key)?.painted ?? -1) === this.landVersion,
    );
  }

  /** Ask for what `view` needs (and a ring ahead of it) and forget what is far behind. */
  cover(view: CellRect): void {
    if (this.request === null) return;
    this.centre = { x: (view.x0 + view.x1) / 2, y: (view.y0 + view.y1) / 2 };
    for (const key of this.keys(view, AHEAD_CELLS)) {
      let piece = this.pieces.get(key);
      if (piece === undefined) {
        piece = { sprite: null, painted: -1, asked: 0, fade: null };
        this.pieces.set(key, piece);
      }
      if (piece.asked !== this.landVersion && piece.painted !== this.landVersion)
        this.ask(key, piece);
    }
    if (this.pieces.size <= PIECES_KEPT) return;
    const byDistance = [...this.pieces.keys()].sort((a, b) => this.distance(b) - this.distance(a));
    for (const key of byDistance.slice(0, this.pieces.size - PIECES_KEPT)) {
      this.pieces.get(key)?.sprite?.destroy({ texture: true, textureSource: true });
      this.pieces.delete(key);
    }
  }

  tick(dtS: number): void {
    for (const piece of this.pieces.values()) {
      if (piece.fade?.step(dtS) === true) piece.fade = null;
    }
  }

  private keys(view: CellRect, ahead: number): number[] {
    const { width, height } = this.world;
    const first = (value: number): number => Math.max(Math.floor(value / PIECE_CELLS), 0);
    const lastX = Math.min(
      Math.floor((view.x1 + ahead) / PIECE_CELLS),
      Math.ceil(width / PIECE_CELLS) - 1,
    );
    const lastY = Math.min(
      Math.floor((view.y1 + ahead) / PIECE_CELLS),
      Math.ceil(height / PIECE_CELLS) - 1,
    );
    const keys: number[] = [];
    for (let py = first(view.y0 - ahead); py <= lastY; py++) {
      for (let px = first(view.x0 - ahead); px <= lastX; px++) keys.push(py * 1024 + px);
    }
    return keys;
  }

  private distance(key: number): number {
    const x = ((key % 1024) + 0.5) * PIECE_CELLS;
    const y = (Math.floor(key / 1024) + 0.5) * PIECE_CELLS;
    return Math.hypot(x - this.centre.x, y - this.centre.y);
  }

  private ask(key: number, piece: Piece): void {
    const { request, shadowsOf } = this;
    if (request === null || shadowsOf === null) return;
    const { width, height } = this.world;
    const px = key % 1024;
    const py = Math.floor(key / 1024);
    const cells = {
      x0: px * PIECE_CELLS,
      y0: py * PIECE_CELLS,
      x1: Math.min((px + 1) * PIECE_CELLS, width),
      y1: Math.min((py + 1) * PIECE_CELLS, height),
    };
    const padded = {
      x0: Math.max(cells.x0 - PIECE_MARGIN, 0),
      y0: Math.max(cells.y0 - PIECE_MARGIN, 0),
      x1: Math.min(cells.x1 + PIECE_MARGIN, width),
      y1: Math.min(cells.y1 + PIECE_MARGIN, height),
    };
    const version = this.landVersion;
    piece.asked = version;
    const shadows = shadowsOf(padded);
    this.painter
      .paint(
        {
          ...request,
          tile: this.tile,
          cells: padded,
          ...(shadows === undefined ? {} : { shadows }),
        },
        this.distance(key),
      )
      .then(({ pixels }) => {
        if (this.pieces.get(key) !== piece || piece.asked !== version) return;
        // Cut the margin off: it is there so that a piece's shore meets its neighbours'.
        const canvas = document.createElement("canvas");
        canvas.width = (cells.x1 - cells.x0) * this.tile;
        canvas.height = (cells.y1 - cells.y0) * this.tile;
        canvas
          .getContext("2d")
          ?.putImageData(
            new ImageData(pixels.rgba, pixels.width, pixels.height),
            (padded.x0 - cells.x0) * this.tile,
            (padded.y0 - cells.y0) * this.tile,
          );
        const sprite = new Sprite(
          new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }) }),
        );
        sprite.scale.set(1 / this.tile);
        sprite.position.set(cells.x0, cells.y0);
        this.container.addChild(sprite);
        piece.fade?.finish();
        piece.fade = new Fade(sprite, piece.sprite, piece.sprite === null ? 0 : this.fadeS);
        if (piece.fade.done) piece.fade = null;
        piece.sprite = sprite;
        piece.painted = version;
      })
      .catch((error: unknown) => {
        if (!(error instanceof Dropped)) throw error;
        if (piece.asked === version) piece.asked = 0;
      });
  }
}
