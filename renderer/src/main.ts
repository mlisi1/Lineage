/**
 * The scene (R1–R3): the land, its plants and its animals from the state stream, filmed
 * by the documentary camera (`director.ts`), with the chronicle's notable entries on a
 * scroll (`captions.ts`); drawn at 512×300 art pixels and stretched to the screen
 * without smoothing. The picture is drawn a pixel larger all round and slid by the
 * camera's fraction of a pixel, so that slow pans glide instead of stepping a whole art
 * pixel at a time.
 *
 * The camera starts on the map. The view button (V, space or Enter on a keyboard, a tap
 * on a phone; on the desk the hardware button, S2) steps map → middle → local → map;
 * fifteen minutes after the last press it goes back to the map. In the local view a click
 * or tap goes on to another animal instead, and a double click back to the map.
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
 *   ?film                      R4's films: the scene stands still until `__frame(seconds)`
 *                              moves it on by that much and draws it (a recording plays on
 *                              the same clock), so that a film has exactly its frame rate
 *   ?file=report/fire.json     R4: any recording under `stream/` (the report's, written
 *                              by `npm run atmosphere`), played as the creatures' one
 *   ?recording=office          R4: two weeks of the owner's office hours (dusks, nights,
 *                              the Long Night) with the rain god power twice
 *   ?recording=end             R4: a day, then the world ends (the herd starved) and the
 *                              next one begins: the apocalypse sequence
 *   ?show=night,fire,meteor    R4: the light and events asked for, made up on the land in
 *                              sight (`atmosphere/demo.ts`; the stream's own sky is then
 *                              not taken): day, dusk, dawn, night, moon, rain, fire,
 *                              volcano, quake, meteor, seed, ark, end. With `?still` the
 *                              atmosphere stands still too, moved on only by `__advance`
 *
 * Over the scene the atmosphere (R4, `atmosphere/`): the light of the moment, what glows,
 * the weather of events, and the end of a world, during which the camera stays on the map
 * and the button does nothing.
 */
import { Application, Container, WebGLRenderer } from "pixi.js";
import { Atmosphere } from "./atmosphere/atmosphere";
import { demoMessages, showsOf, type Timed } from "./atmosphere/demo";
import { sight, type Point } from "./camera";
import { Captions } from "./captions";
import { Director, TIMINGS, type Scene, type Shot } from "./director";
import { Herd } from "./herd";
import { Landscape, TILES, VIEWS, type ViewName } from "./landscape";
import type { CreaturesMessage, Message } from "./protocol";
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
const DARK = "#10081c";
/** A second click within this many milliseconds makes a double click. */
const DOUBLE_CLICK_MS = 300;
/** Art pixels drawn beyond the screen on every side: room to slide the picture by a fraction. */
const MARGIN = 1;
/** The committed recordings (`tools/stream.py`). */
const RECORDINGS: Readonly<Record<string, string>> = {
  life: "stream/life.json",
  autumn: "stream/recording.json",
  winter: "stream/winter.json",
  office: "stream/office.json",
  end: "stream/end.json",
};
/** The recordings of creatures, played at `LIFE_SPEED` unless told otherwise. */
const LIVING = ["life", "office", "end"];
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
    /** What the atmosphere shows (tests). */
    __atmosphere?: () => Atmosphere["state"] & Atmosphere["counts"];
    /** The land drawn at cell (x, y): height, cover class, biomass and scorch (tests). */
    __landAt?: (
      x: number,
      y: number,
    ) => { height: number; cover: string; biomass: number; scorch: number } | null;
    /** With `?film`: move the whole scene on by this many seconds and draw it. */
    __frame?: (seconds: number) => void;
    /** Whether the ground is still being painted (films wait for it between frames). */
    __painting?: () => boolean;
    /** Move the atmosphere on by this many seconds (tests; with `?still` the only way it moves). */
    __advance?: (seconds: number) => void;
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
    width: WIDTH + 2 * MARGIN,
    height: HEIGHT + 2 * MARGIN,
    background: BACKGROUND,
    antialias: false,
    roundPixels: true,
    resolution: 1,
    autoDensity: false,
  });
  // The screen: a box the size of the scene, which crops the canvas's margin; the dip and
  // the scroll lie over it, still while the canvas slides.
  const frame = document.createElement("div");
  frame.dataset.testid = "stage";
  frame.style.position = "absolute";
  frame.style.overflow = "hidden";
  document.body.appendChild(frame);
  const canvas = app.canvas;
  canvas.style.imageRendering = "pixelated";
  canvas.style.position = "absolute";
  canvas.style.left = `${(-100 * MARGIN) / WIDTH}%`;
  canvas.style.top = `${(-100 * MARGIN) / HEIGHT}%`;
  canvas.style.width = `${(100 * (WIDTH + 2 * MARGIN)) / WIDTH}%`;
  canvas.style.height = `${(100 * (HEIGHT + 2 * MARGIN)) / HEIGHT}%`;
  canvas.style.willChange = "transform";
  frame.appendChild(canvas);
  /** Screen pixels to the art pixel, as the page is laid out now. */
  let artPixel = ART;
  const layout = (): void => {
    const fit = fitToViewport(window.innerWidth, window.innerHeight);
    frame.style.width = `${DESIGN_WIDTH * fit.scale}px`;
    frame.style.height = `${DESIGN_HEIGHT * fit.scale}px`;
    frame.style.left = `${fit.offsetX}px`;
    frame.style.top = `${fit.offsetY}px`;
    artPixel = ART * fit.scale;
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
  const still = params.get("still") !== null;

  // Over the scene: the dip between views, then the captions above it.
  const dim = document.createElement("div");
  dim.style.position = "absolute";
  dim.style.inset = "0";
  dim.style.background = DARK;
  dim.style.opacity = "0";
  dim.style.pointerEvents = "none";
  const captions = new Captions(WIDTH, HEIGHT);
  frame.append(dim, captions.element);

  const quiet = params.get("quiet") !== null;
  let date: string | null = null;
  let lastMs = 0;
  let lastCreatures: CreaturesMessage | null = null;
  const deliver = (message: Message): void => {
    if (message.type === "clock") date = message.date;
    if (message.type === "creatures") lastCreatures = message;
    if ("t_ms" in message) lastMs = message.t_ms;
    if (message.type === "chronicle") captions.take(message, date);
    landscape.receive(message);
    herd.receive(message);
    atmosphere.receive(message);
  };
  // The director comes later; a world's end sends the camera to the map through this.
  let toMap = (): void => undefined;
  const atmosphere = new Atmosphere(deliver, {
    random: mulberry32(seed + 2),
    onEnd: () => {
      toMap();
      // The last of them died: the dead leave the scene with the world they lived in.
      herd.receive({
        type: "creatures",
        protocol: 1,
        t_ms: lastMs,
        ids: [],
        positions: [],
        born: [],
      });
    },
  });
  world.addChild(atmosphere.ground);
  app.stage.addChild(atmosphere.weather, atmosphere.tint, atmosphere.lights, atmosphere.sky);
  // An animal that dies in a burning cell leaves a puff of ash.
  herd.onGone = (x, y) => {
    const land = landscape.current;
    if (land === null) return;
    if (atmosphere.isBurning(Math.floor(y) * land.width + Math.floor(x))) atmosphere.burnt(x, y);
  };
  const receive = (message: Message): void => {
    if (!atmosphere.hold(message)) deliver(message);
  };
  const shows = showsOf(params.get("show"));

  const socket = params.get("source");
  // `?file=` plays any recording under `stream/` (the report's, R4), as a creatures' one.
  const file = params.get("file");
  const name = file === null ? (params.get("recording") ?? "life") : "life";
  const recording =
    file !== null && /^[\w/-]+\.json$/.test(file)
      ? `stream/${file}`
      : (RECORDINGS[name] ?? RECORDINGS["life"] ?? "");
  const every = params.get("every");
  const speed = Number(
    params.get("speed") ?? (every === null && LIVING.includes(name) ? LIFE_SPEED : 0),
  );
  const film = params.get("film") !== null;
  const source: Source =
    socket !== null
      ? new SocketSource(socket)
      : await Recording.load(recording, Number(every ?? 1000), speed);
  if (film && source instanceof Recording) source.playManually();
  source.listen((message) => {
    if (quiet && message.type === "chronicle") return;
    // Shown on demand, the light is the one asked for, not the recording's.
    if (shows.length > 0 && message.type === "sky") return;
    receive(message);
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

  toMap = () => {
    if (pinned === null) director.toMap();
  };

  // The view button: a key on a keyboard, a tap on a phone. Not while a world ends.
  const press = (): void => {
    if (pinned === null && !atmosphere.ending) director.press();
  };
  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (event.key === "v" || event.key === " " || event.key === "Enter") press();
  });
  // A click or tap is the button too; in the local view (for the demo, the owner
  // 2026-10-20) a click goes on to another animal and a double click back to the map.
  let pendingClick: ReturnType<typeof setTimeout> | null = null;
  frame.addEventListener("pointerdown", () => {
    if (pinned !== null || atmosphere.ending) return;
    if (pendingClick !== null) {
      clearTimeout(pendingClick);
      pendingClick = null;
      director.toMap();
      return;
    }
    if (director.state.view !== "local" || director.state.dipping) {
      press();
      return;
    }
    pendingClick = setTimeout(() => {
      pendingClick = null;
      director.nextSubject();
    }, DOUBLE_CLICK_MS);
  });

  let shot: Shot = { view: pinned ?? "map", centre: { x: 0, y: 0 }, dim: 0, subject: null };
  window.__sceneSettled = () => landscape.settled;
  window.__receive = receive;
  window.__press = press;
  window.__camera = () => ({ ...shot, ...director.state, view: shot.view });
  let advance = 0;
  window.__atmosphere = () => ({ ...atmosphere.state, ...atmosphere.counts });
  window.__landAt = (x, y) => {
    const land = landscape.current;
    if (land === null) return null;
    const cell = Math.floor(y) * land.width + Math.floor(x);
    return {
      height: land.heights[cell] ?? 0,
      cover: land.coverClasses[land.cover[cell] ?? 0] ?? "",
      biomass: land.biomass[cell] ?? 0,
      scorch: land.scorch?.[cell] ?? 0,
    };
  };
  window.__advance = (seconds) => {
    advance += seconds;
  };
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
  let shown = shows.length === 0;
  // The demo's later messages, on the atmosphere's clock (so `__advance` moves them too).
  let later: Timed[] = [];
  /** Move the scene on by `deltaMS` and lay it out for drawing. */
  const step = (deltaMS: number): void => {
    const size = landscape.size;
    if (size === null) {
      // Nothing drawn until the first land: let it be laid out.
      landscape.update(0);
      return;
    }
    const dtS = deltaMS / 1000;
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
    const land = landscape.current;
    if (!shown && land !== null) {
      shown = true;
      const centre = shot.view === "map" ? { x: land.width / 2, y: land.height / 2 } : shot.centre;
      const world = { land, landMessage: landscape.lastMessage, creatures: lastCreatures };
      later = demoMessages(shows, world, centre.x, centre.y, lastMs);
    }
    const stepS = (still ? 0 : dtS) + advance;
    if (later.length > 0) {
      for (const timed of later) timed.afterS -= stepS;
      const due = later.filter((timed) => timed.afterS <= 0);
      later = later.filter((timed) => !due.includes(timed));
      for (const { message } of due) receive(message);
      if (due.some(({ message }) => message.type === "sky")) atmosphere.settleLight();
    }
    if (still) atmosphere.settleLight();
    const shake = atmosphere.update(stepS, {
      view: shot.view,
      cells,
      tile,
      width: WIDTH + 2 * MARGIN,
      height: HEIGHT + 2 * MARGIN,
      land,
      glowing: herd.glowing(cells),
      margin: MARGIN,
    });
    advance = 0;
    world.scale.set(tile);
    // Whole art pixels in the canvas, the fraction left by sliding the canvas itself.
    const x = -cells.x0 * tile;
    const y = -cells.y0 * tile;
    world.position.set(Math.floor(x) + MARGIN + shake.x, Math.floor(y) + MARGIN + shake.y);
    atmosphere.lights.scale.set(tile);
    atmosphere.lights.position.copyFrom(world.position);
    // In whole device pixels: a browser smooths a picture placed between them.
    const device = window.devicePixelRatio || 1;
    const slide = (value: number): number =>
      Math.round((value - Math.floor(value)) * artPixel * device) / device;
    canvas.style.transform = `translate(${slide(x)}px, ${slide(y)}px)`;
    dim.style.opacity = String(shot.dim);
    captions.update(dtS);
  };
  if (film) {
    // Still until a film moves it, on its own clock: the recording plays on the same one.
    app.ticker.stop();
    let clockMs = 0;
    window.__frame = (seconds) => {
      clockMs += seconds * 1000;
      if (source instanceof Recording) source.pump(clockMs);
      step(seconds * 1000);
      app.render();
    };
  } else {
    app.ticker.add((ticker) => step(ticker.deltaMS));
  }
  window.__painting = () => landscape.painting;
}

void start();
