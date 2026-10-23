/**
 * The scene (R1–R3): the land, its plants and its animals from the state stream, filmed
 * by the documentary camera (`director.ts`), with the chronicle's notable entries on a
 * scroll (`captions.ts`) and, in the local view, a card naming the animal followed
 * (`card.ts`, R5); drawn at 512×300 art pixels and stretched to the screen
 * without smoothing. The picture is drawn a pixel larger all round and slid by the
 * camera's fraction of a pixel, so that slow pans glide instead of stepping a whole art
 * pixel at a time.
 *
 * The camera starts on the map. The view button (V, space or Enter on a keyboard, a tap
 * on a phone; on the desk the hardware button, S2) steps map → middle → local → map;
 * fifteen minutes after the last press it goes back to the map. A click or tap on the
 * screen is the button too.
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
 *   ?cap=30                    R5: at most this many frames a second (`framecap.ts`): the
 *                              kiosk's cap on the board, which has no fan
 *   ?bushes=pieces             R5: the local view's bushes drawn a sprite to each puff,
 *                              each sorted by its own foot (`plants/pieces.ts`; an
 *                              experiment to compare with the bushes drawn whole)
 *   ?bench                     R5: the benchmark (`bench.ts`): the scenarios of
 *                              `benchplan.ts` on the recordings, the results POSTed to
 *                              `?post=` (`tools/kiosk_bench.py`)
 *
 * The desk's build (`npm run build:kiosk`, into `dist-kiosk/`) leaves the demo paths out:
 * with no `?source=` it takes the server's stream from the host that served the page,
 * `ws://<host>/stream` (S1), and `?film`, `?file=`, `?show=` and `?recording=` do
 * nothing, but for `?bench`, whose scenarios play the committed recordings and make up
 * what they lack as `?show=` does: the one way off the server the desk keeps, so that the
 * board can be measured from the build it runs.
 *
 * Over the scene the atmosphere (R4, `atmosphere/`): the light of the moment, what glows,
 * the weather of events, and the end of a world, during which the camera stays on the map
 * and the button does nothing.
 */
import { Application, Container, WebGLRenderer } from "pixi.js";
import { Atmosphere } from "./atmosphere/atmosphere";
import { demoMessages, showsOf, type Timed } from "./atmosphere/demo";
import { sight, within, type Point } from "./camera";
import { Captions, lantern } from "./captions";
import { NameCard, type CardPhase } from "./card";
import { Director, TIMINGS, type Motion, type Scene, type Shot, type Visit } from "./director";
import { Herd } from "./herd";
import type { PlantLayer } from "./plants/plants";
import { Landscape, TILES, VIEWS, type ViewName } from "./landscape";
import { PlaceMarker } from "./marker";
import type { CreaturesMessage, Message } from "./protocol";
import { mulberry32 } from "./rng";
import { DESIGN_HEIGHT, DESIGN_WIDTH, fitToViewport } from "./scene";
import { creatureAtlas } from "./creatures/atlas";
import { Portraits } from "./creatures/portrait";
import { heightAt } from "./creatures/habitat";
import { Recording, SocketSource, type Source } from "./stream";
import { InlinePainter, makePainter } from "./terrain/painter";
import { Bench } from "./bench";
import { capFrames } from "./framecap";

/** Screen pixels per art pixel (ADR 0007). */
const ART = 2;
const WIDTH = DESIGN_WIDTH / ART;
const HEIGHT = DESIGN_HEIGHT / ART;
/** The deepest sea: what shows beyond the world. */
const BACKGROUND = "#24529c";
/** What a dip between views goes to: night, toward plum (`palette.ts`). */
const DARK = "#10081c";
/** Art pixels drawn beyond the screen on every side: room to slide the picture by a fraction. */
const MARGIN = 1;
/** The name card waits until a dip between views is this clear before it unrolls (0–1). */
const CARD_DIM = 0.5;
/** The camera's moves away from the animal followed, during which the card is put away. */
const AWAY: ReadonlySet<Motion> = new Set<Motion>(["visit", "return"]);
/** The places of this many of the latest notable entries are kept, for the scroll to mark. */
const PLACES_KEPT = 16;
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
/**
 * The desk's build (`vite build --mode kiosk`): the demo paths are compiled out (the
 * bundler drops every branch behind `!KIOSK`) and the page takes the server's stream.
 */
const KIOSK = import.meta.env.MODE === "kiosk";
/** Each view's size in cells. */
const VIEW_CELLS: Readonly<Record<ViewName, { width: number; height: number }>> = {
  map: { width: WIDTH / TILES.map, height: HEIGHT / TILES.map },
  middle: { width: WIDTH / TILES.middle, height: HEIGHT / TILES.middle },
  local: { width: WIDTH / TILES.local, height: HEIGHT / TILES.local },
};

/** The server's stream (S1), from the host that served the page. */
function serverStream(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/stream`;
}

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
    __camera?: () => Shot & { motion: string; dipping: boolean; visit: Visit | null };
    /** What the scroll shows (tests). */
    __captions?: () => {
      phase: string;
      text: string | null;
      waiting: number;
      lamp: number;
      kind: string | null;
      icon: string | null;
      initial: number | null;
    };
    /** What the name card of the animal followed shows (tests; S3 shows the same card). */
    __card?: () => {
      phase: CardPhase;
      open: number;
      /** The lamp it is lit by (0xRRGGBB): 0xffffff by day, dim and warm at night. */
      lamp: number;
      /** Whether the animal's portrait is on the card's plate. */
      portrait: boolean;
      id?: number;
      name?: string;
      traits?: string;
      icons?: string[];
    };
    /** What the atmosphere shows (tests). */
    __atmosphere?: () => Atmosphere["state"] & Atmosphere["counts"];
    __colours?: () => ReturnType<Herd["colourTable"]>;
    __swash?: (x: number, y: number) => boolean;
    __pin?: (id: number, x: number, y: number, heading: number) => boolean;
    __send?: (id: number, x: number, y: number) => boolean;
    __feed?: (id: number, food: "none" | "plants" | "meat") => boolean;
    __hunt?: (hunterId: number, preyId: number) => boolean;
    __birth?: (motherId: number, childId: number, egg?: boolean) => boolean;
    __standing?: (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ) => ReturnType<PlantLayer["standing"]>;
    /** Where cell point (x, y) is on the screen, in CSS pixels (staging the look by hand). */
    __screenOf?: (x: number, y: number) => { x: number; y: number };
    /** Whether a body of radius `margin` at cell point (x, y) is in a plant's footprint. */
    __blocked?: (x: number, y: number, margin: number) => boolean;
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
  // The benchmark (R5): with `?bench` it gives the scene its options for the scenario at
  // hand, and once the scene is built it is handed the hooks it measures with (below).
  const bench = await Bench.start(window.location.search, VIEW_CELLS);
  const params = bench?.params ?? new URLSearchParams(window.location.search);
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
  let graded = false;
  app.stage.addChild(world);
  const landscape = new Landscape(
    params.get("painter") === "inline" ? new InlinePainter() : makePainter(),
    undefined,
    undefined,
    params.get("still") !== null,
  );
  landscape.bushPieces = params.get("bushes") === "pieces";
  world.addChild(landscape.container);
  const seed = Number(params.get("seed") ?? Date.now() % 2 ** 31);
  const atlas = creatureAtlas();
  const herd = new Herd(atlas, mulberry32(seed + 1), () => landscape.current);
  // The name card's portraits, drawn by the scene's own renderer (R5).
  const portraits = new Portraits(app.renderer, atlas);
  herd.swash = (x, y) => landscape.swashCovers(x, y);
  world.addChild(...herd.containers);
  const still = params.get("still") !== null;

  // Over the scene: the dip between views, then the captions above it.
  const dim = document.createElement("div");
  dim.style.position = "absolute";
  dim.style.inset = "0";
  dim.style.background = DARK;
  dim.style.opacity = "0";
  dim.style.pointerEvents = "none";
  // The initial of an entry about a species is in the species' colour, as the herd draws it.
  const captions = new Captions(
    WIDTH,
    HEIGHT,
    (species) => herd.colourTable().find((row) => row.id === species)?.body ?? null,
  );
  // The name card of the animal followed, in the top-left corner (R5).
  const card = new NameCard(WIDTH, HEIGHT);
  frame.append(dim, captions.element, card.element);

  // Where each notable entry happened, by its number, for the marker and the local view's
  // visit while its scroll is out (R5); entries with no one place are not kept.
  const places = new Map<number, Visit>();
  const placeOf = (message: Message): void => {
    if (message.type !== "chronicle") return;
    for (const entry of message.entries) {
      if (entry.importance < message.notable_importance || entry.x < 0 || entry.y < 0) continue;
      places.set(entry.number, { entry: entry.number, x: entry.x, y: entry.y });
    }
    // The oldest go first: a Map keeps the order they came in.
    for (const number of places.keys()) {
      if (places.size <= PLACES_KEPT) break;
      places.delete(number);
    }
  };
  const marker = new PlaceMarker();

  const quiet = params.get("quiet") !== null;
  let date: string | null = null;
  let lastMs = 0;
  let lastCreatures: CreaturesMessage | null = null;
  const deliver = (message: Message): void => {
    if (message.type === "clock") date = message.date;
    if (message.type === "creatures") lastCreatures = message;
    if ("t_ms" in message) lastMs = message.t_ms;
    if (message.type === "chronicle") {
      captions.take(message, date);
      placeOf(message);
    }
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
  landscape.floor.addChild(atmosphere.floor, herd.remains.floor);
  // Nothing stands on a cone or in a crater the scene draws.
  landscape.covered = (x, y) => atmosphere.covers(x, y);
  app.stage.addChild(
    atmosphere.veil,
    atmosphere.tint,
    atmosphere.weather,
    atmosphere.lights,
    marker.container,
    atmosphere.sky,
  );
  // An animal burnt to death (or, in streams without causes, that dies in a burning
  // cell) leaves a puff of ash.
  herd.onGone = (x, y, cause) => {
    const land = landscape.current;
    if (land === null) return;
    const burning = atmosphere.isBurning(Math.floor(y) * land.width + Math.floor(x));
    if (cause === "burnt" || (cause === undefined && burning)) atmosphere.burnt(x, y);
  };
  // The ark's newcomers come into being where its light is.
  herd.arrival = (x, y) => atmosphere.arrival(x, y);
  const receive = (message: Message): void => {
    if (!atmosphere.hold(message)) deliver(message);
  };
  // Made-up light and events: a demo path, kept in the desk's build only for the benchmark.
  const shows = KIOSK && bench === null ? [] : showsOf(params.get("show"));

  // The desk's build takes the server's stream unless benchmarked.
  const socket = params.get("source") ?? (KIOSK && bench === null ? serverStream() : null);
  // `?file=` plays any recording under `stream/` (the report's, R4), as a creatures' one.
  const file = KIOSK ? null : params.get("file");
  const name = file === null ? (params.get("recording") ?? "life") : "life";
  const recording =
    file !== null && /^[\w/-]+\.json$/.test(file)
      ? `stream/${file}`
      : (RECORDINGS[name] ?? RECORDINGS["life"] ?? "");
  const every = params.get("every");
  const speed = Number(
    params.get("speed") ?? (every === null && LIVING.includes(name) ? LIFE_SPEED : 0),
  );
  const film = !KIOSK && params.get("film") !== null;
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
  const director = new Director(VIEW_CELLS, mulberry32(seed), {
    idleS: number("idle", TIMINGS.idleS),
    followMinS: follow === null ? TIMINGS.followMinS : number("follow", 1) * 0.8,
    followMaxS: follow === null ? TIMINGS.followMaxS : number("follow", 1) * 1.2,
  });

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
  // A click or tap is the button too.
  frame.addEventListener("pointerdown", press);

  let shot: Shot = { view: pinned ?? "map", centre: { x: 0, y: 0 }, dim: 0, subject: null };
  window.__sceneSettled = () => landscape.settled;
  window.__receive = receive;
  window.__press = press;
  window.__camera = () => ({ ...shot, ...director.state, view: shot.view });
  let advance = 0;
  window.__atmosphere = () => ({ ...atmosphere.state, ...atmosphere.counts });
  window.__colours = () => herd.colourTable();
  window.__swash = (x, y) => landscape.swashCovers(x, y);
  // Debugging the look: an animal placed by hand, and where the trees and bushes stand.
  window.__pin = (id, x, y, heading) => herd.pin(id, x, y, heading);
  window.__send = (id, x, y) => herd.send(id, x, y);
  window.__feed = (id, food) => herd.feed(id, food);
  window.__hunt = (hunterId, preyId) => herd.hunt(hunterId, preyId);
  window.__birth = (motherId, childId, egg) => herd.birth(motherId, childId, egg);
  window.__standing = (x0, y0, x1, y1) => landscape.hosts?.standing({ x0, y0, x1, y1 }) ?? [];
  window.__screenOf = (x, y) => world.toGlobal({ x, y });
  window.__blocked = (x, y, margin) => landscape.hosts?.blocked(x, y, margin) ?? false;
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
  window.__card = () => card.state;
  window.__captions = () => {
    const { phase, caption, waiting, lamp, icon, initial } = captions.state;
    return {
      phase,
      text: caption?.text ?? null,
      waiting,
      lamp,
      kind: caption?.kind ?? null,
      icon,
      initial,
    };
  };
  // PixiJS leaves a freed texture's place empty (null) rather than taking it out: count the rest.
  const textures = (): number =>
    app.renderer instanceof WebGLRenderer
      ? app.renderer.texture.managedTextures.filter((source) => source !== null).length
      : -1;
  window.__textures = textures;

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
    // The entry on the scroll, and where it happened: marked while the scroll is out,
    // visited by the local view while it is open (as the scroll was last frame).
    const scroll = captions.state;
    const entry =
      scroll.caption === null || scroll.phase === "gap"
        ? null
        : (places.get(scroll.caption.number) ?? null);
    if (pinned === null) {
      scene.width = size.width;
      scene.height = size.height;
      scene.ready = landscape.settled;
      scene.place = scroll.phase === "roll-up" || atmosphere.ending ? null : entry;
      shot = director.update(dtS, scene);
    } else {
      // The map shows the whole world whatever is asked.
      const centre: Point =
        pinned === "map"
          ? { x: size.width / 2, y: size.height / 2 }
          : // Kept inside the world, as the director keeps its own views: past its edge
            // there is nothing to draw.
            within(
              {
                x: Number(params.get("x") ?? size.width / 2),
                y: Number(params.get("y") ?? size.height / 2),
              },
              WIDTH / TILES[pinned],
              HEIGHT / TILES[pinned],
              size.width,
              size.height,
            );
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
      rows: landscape.hosts,
    });
    advance = 0;
    // The plants lean in the atmosphere's wind from the next frame on; a picture that must
    // not change keeps them straight.
    landscape.wind = still ? null : atmosphere.wind;
    world.scale.set(tile);
    // Under cloud the world is greyed (one filter pass); none on a clear day.
    if (atmosphere.graded !== graded) {
      graded = atmosphere.graded;
      world.filters = graded ? [atmosphere.grade] : [];
    }
    // Whole art pixels in the canvas, the fraction left by sliding the canvas itself.
    const x = -cells.x0 * tile;
    const y = -cells.y0 * tile;
    world.position.set(Math.floor(x) + MARGIN + shake.x, Math.floor(y) + MARGIN + shake.y);
    atmosphere.lights.scale.set(tile);
    atmosphere.lights.position.copyFrom(world.position);
    marker.update(stepS, entry, shot.view, cells, tile, world.position);
    // In whole device pixels: a browser smooths a picture placed between them.
    const device = window.devicePixelRatio || 1;
    const slide = (value: number): number =>
      Math.round((value - Math.floor(value)) * artPixel * device) / device;
    canvas.style.transform = `translate(${slide(x)}px, ${slide(y)}px)`;
    dim.style.opacity = String(shot.dim);
    // The scrolls lie over the canvas, out of the tint's reach: lit like a lantern by the
    // light of the moment instead (the same light the tint was made from this frame).
    const { light, tint } = atmosphere.state;
    const lamp = lantern(light, tint, atmosphere.ending);
    captions.update(dtS, lamp);
    // The card is out while the local view follows an animal and is not dipped to dark,
    // nor away visiting the place of an entry (or on its way back): it would name an
    // animal off screen.
    const away = AWAY.has(director.state.motion);
    const following = shot.view === "local" && shot.dim < CARD_DIM && !away ? shot.subject : null;
    const facts = following === null ? null : herd.cardOf(following);
    const look = facts === null ? null : herd.portraitOf(facts.id);
    card.update(
      dtS,
      facts === null ? null : { ...facts, portrait: look === null ? null : portraits.of(look) },
      lamp,
    );
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
    // The kiosk's cap on the board (R5, ADR 0022): none unless asked.
    capFrames(app.ticker, Number(params.get("cap") ?? 0));
  }
  window.__painting = () => landscape.painting;

  // The benchmark's hooks (R5, `bench.ts`): what it may do to the scene and read of it.
  bench?.attach({
    app,
    artScale: ART,
    press,
    receive,
    advance: (seconds) => {
      advance += seconds;
    },
    settled: () => landscape.settled,
    camera: () => ({ view: shot.view, dipping: director.state.dipping }),
    sight: () => sight(shot.centre, WIDTH / TILES[shot.view], HEIGHT / TILES[shot.view]),
    land: () => landscape.current,
    animals: () => herd.subjects(),
    simMs: () => lastMs,
    creatures: () => lastCreatures,
    atmosphere: () => ({ ...atmosphere.state, ...atmosphere.counts }),
    textures,
    layers: { land: landscape.container, creatures: herd.containers },
  });
}

void start();
