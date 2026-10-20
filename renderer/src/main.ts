/**
 * The scene (R1–R3): the land, its plants and its animals from the state stream, filmed
 * by the documentary camera (`director.ts`), with the chronicle's notable entries on a
 * scroll (`captions.ts`); drawn at 512×300 art pixels and stretched to the screen
 * without smoothing.
 *
 * The camera starts on the map. The view button (V, space or Enter on a keyboard, a tap
 * on a phone; on the desk the hardware button, S2) steps map → middle → local → map;
 * fifteen minutes after the last press it goes back to the map.
 *
 *   /                          the creatures' recording (`public/stream/life.json`, 28
 *                              days from the v9 fixture) played at `speed`
 *   ?recording=autumn|winter   the land recordings of R1 (no creatures): 3 August to
 *                              28 September, or 15 January to 5 February with snow
 *   ?speed=1800                sim-seconds to a wall second (the default for `life`;
 *                              a sim-day in 48 s)
 *   ?every=1000                instead, wall milliseconds between messages (0: all at
 *                              once, the last day; the default for `autumn`/`winter`)
 *   ?view=map|middle|local     pin the camera to a view (no director), and
 *   ?x=120&y=60                where it looks, in cells (the island's middle by default)
 *   ?follow=20&idle=60         seconds on one animal and before the map comes back (tests)
 *   ?seed=7                    the camera's random draws (default: a new one each start)
 *   ?source=ws://host/stream   the server's stream instead of a recording (S1)
 *   ?still                     the sea does not move (pictures that must not change)
 *   ?quiet                     no captions of the stream's entries (pictures of the land;
 *                              those handed to `__receive` are still shown)
 *   ?painter=inline            paint the ground on the page's thread, not in a worker
 */
import { Application, Container, Sprite, Texture, WebGLRenderer } from "pixi.js";
import { sight, type Point } from "./camera";
import { Captions } from "./captions";
import { Director, TIMINGS, type Scene, type Shot } from "./director";
import { Herd } from "./herd";
import { Landscape, TILES, VIEWS, type ViewName } from "./landscape";
import type { Message } from "./protocol";
import { mulberry32 } from "./rng";
import { DESIGN_HEIGHT, DESIGN_WIDTH, fitToViewport } from "./scene";
import { creatureAtlas } from "./spike/atlas";
import { heightAt } from "./spike/habitat";
import { Recording, SocketSource, type Source } from "./stream";
import { InlinePainter, makePainter } from "./terrain/painter";

/** Screen pixels per art pixel (ADR 0007). */
const ART = 2;
const WIDTH = DESIGN_WIDTH / ART;
const HEIGHT = DESIGN_HEIGHT / ART;
/** The deepest sea: what shows beyond the world. */
const BACKGROUND = "#24529c";
/** What a dip between views goes to: night, toward plum (`palette.ts`). */
const DARK = 0x10081c;
/** The committed recordings (`tools/stream.py`). */
const RECORDINGS: Readonly<Record<string, string>> = {
  life: "stream/life.json",
  autumn: "stream/recording.json",
  winter: "stream/winter.json",
};
/** Sim-seconds a wall second, playing the creatures' recording: two sim-hours in 4 s. */
const LIFE_SPEED = 1800;

declare global {
  interface Window {
    /** True once the view shows the latest day, fully painted (the visual tests wait for it). */
    __sceneSettled?: () => boolean;
    /** Textures alive on the GPU: what a leak would make grow (tests). */
    __textures?: () => number;
    /** Hand the scene a message as if the stream had sent it (tests and measurements). */
    __receive?: (message: Message) => void;
    /** Press the view button (tests; S2's hardware button reaches the page this way too). */
    __press?: () => void;
    /** What the camera shows and does (tests). */
    __camera?: () => Shot & { motion: string; dipping: boolean };
    /** What the scroll shows (tests). */
    __captions?: () => { phase: string; text: string | null; waiting: number };
  }
}

function pinnedView(name: string | null): ViewName | null {
  return (VIEWS as readonly string[]).includes(name ?? "") ? (name as ViewName) : null;
}

async function start(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const pinned = pinnedView(params.get("view"));

  const app = new Application();
  await app.init({
    width: WIDTH,
    height: HEIGHT,
    background: BACKGROUND,
    antialias: false,
    roundPixels: true,
    resolution: 1,
    autoDensity: false,
  });
  app.canvas.dataset.testid = "stage";
  app.canvas.style.imageRendering = "pixelated";
  app.canvas.style.position = "absolute";
  document.body.appendChild(app.canvas);
  const layout = (): void => {
    const fit = fitToViewport(window.innerWidth, window.innerHeight);
    app.canvas.style.width = `${DESIGN_WIDTH * fit.scale}px`;
    app.canvas.style.height = `${DESIGN_HEIGHT * fit.scale}px`;
    app.canvas.style.left = `${fit.offsetX}px`;
    app.canvas.style.top = `${fit.offsetY}px`;
  };
  window.addEventListener("resize", layout);
  layout();

  const world = new Container({ isRenderGroup: true });
  app.stage.addChild(world);
  const landscape = new Landscape(
    params.get("painter") === "inline" ? new InlinePainter() : makePainter(),
    undefined,
    undefined,
    params.get("still") !== null,
  );
  world.addChild(landscape.container);
  const seed = Number(params.get("seed") ?? Date.now() % 2 ** 31);
  const herd = new Herd(creatureAtlas(), mulberry32(seed + 1), () => landscape.current);
  world.addChild(...herd.containers);

  // Over the world, in art pixels: the dip between views, then the captions above it.
  const dim = new Sprite(Texture.WHITE);
  dim.tint = DARK;
  dim.width = WIDTH;
  dim.height = HEIGHT;
  dim.alpha = 0;
  const captions = new Captions(WIDTH, HEIGHT);
  app.stage.addChild(dim, captions.container);

  const quiet = params.get("quiet") !== null;
  let date: string | null = null;
  const receive = (message: Message): void => {
    if (message.type === "clock") date = message.date;
    if (message.type === "chronicle") captions.take(message, date);
    landscape.receive(message);
    herd.receive(message);
  };

  const socket = params.get("source");
  const name = params.get("recording") ?? "life";
  const recording = RECORDINGS[name] ?? RECORDINGS["life"] ?? "";
  const every = params.get("every");
  const speed = Number(params.get("speed") ?? (every === null && name === "life" ? LIFE_SPEED : 0));
  const source: Source =
    socket !== null
      ? new SocketSource(socket)
      : await Recording.load(recording, Number(every ?? 1000), speed);
  source.listen((message) => {
    if (!(quiet && message.type === "chronicle")) receive(message);
  });

  const number = (key: string, otherwise: number): number => {
    const value = Number(params.get(key) ?? otherwise);
    return Number.isFinite(value) && value > 0 ? value : otherwise;
  };
  const follow = params.get("follow");
  const director = new Director(
    {
      map: { width: WIDTH / TILES.map, height: HEIGHT / TILES.map },
      middle: { width: WIDTH / TILES.middle, height: HEIGHT / TILES.middle },
      local: { width: WIDTH / TILES.local, height: HEIGHT / TILES.local },
    },
    mulberry32(seed),
    {
      idleS: number("idle", TIMINGS.idleS),
      followMinS: follow === null ? TIMINGS.followMinS : number("follow", 1) * 0.8,
      followMaxS: follow === null ? TIMINGS.followMaxS : number("follow", 1) * 1.2,
    },
  );

  // The view button: a key on a keyboard, a tap on a phone.
  const press = (): void => {
    if (pinned === null) director.press();
  };
  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (event.key === "v" || event.key === " " || event.key === "Enter") press();
  });
  app.canvas.addEventListener("pointerdown", press);

  let shot: Shot = { view: pinned ?? "map", centre: { x: 0, y: 0 }, dim: 0, subject: null };
  window.__sceneSettled = () => landscape.settled;
  window.__receive = receive;
  window.__press = press;
  window.__camera = () => ({ ...shot, ...director.state, view: shot.view });
  window.__captions = () => {
    const { phase, caption, waiting } = captions.state;
    return { phase, text: caption?.text ?? null, waiting };
  };
  // PixiJS leaves a freed texture's place empty (null) rather than taking it out: count the rest.
  window.__textures = () =>
    app.renderer instanceof WebGLRenderer
      ? app.renderer.texture.managedTextures.filter((source) => source !== null).length
      : -1;

  const scene: Scene = {
    width: 0,
    height: 0,
    isLand: (x, y) => {
      const land = landscape.current;
      return land !== null && heightAt(land, x, y) > land.seaLevel;
    },
    get subjects() {
      return herd.subjects();
    },
    ready: false,
  };
  // The view first, so that the first land is laid out for it alone.
  landscape.show(shot.view, { x0: 0, y0: 0, x1: 0, y1: 0 });
  app.ticker.add((ticker) => {
    const size = landscape.size;
    if (size === null) {
      // Nothing drawn until the first land: let it be laid out.
      landscape.update(0);
      return;
    }
    const dtS = ticker.deltaMS / 1000;
    if (pinned === null) {
      scene.width = size.width;
      scene.height = size.height;
      scene.ready = landscape.settled;
      shot = director.update(dtS, scene);
    } else {
      // The map shows the whole world whatever is asked.
      const centre: Point =
        pinned === "map"
          ? { x: size.width / 2, y: size.height / 2 }
          : {
              x: Number(params.get("x") ?? size.width / 2),
              y: Number(params.get("y") ?? size.height / 2),
            };
      shot = { view: pinned, centre, dim: 0, subject: null };
    }
    const tile = TILES[shot.view];
    const cells = sight(shot.centre, WIDTH / tile, HEIGHT / tile);
    landscape.show(shot.view, cells);
    landscape.update(dtS);
    herd.update(dtS, shot.view, cells, landscape.hosts, shot.subject);
    world.scale.set(tile);
    world.position.set(Math.round(-cells.x0 * tile), Math.round(-cells.y0 * tile));
    dim.alpha = shot.dim;
    dim.visible = shot.dim > 0;
    captions.update(dtS);
  });
}

void start();
