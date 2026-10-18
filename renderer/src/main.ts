/**
 * The scene (R1): the land and its plants from the state stream, in one of the three
 * views, drawn at 512×300 art pixels and stretched to the screen without smoothing.
 *
 *   /                          a recording (`public/stream/recording.json`), played a
 *                              day every second, the middle view on the island's middle
 *   ?view=map|middle|local     the view
 *   ?x=120&y=60                where it looks, in cells
 *   ?source=ws://host/stream   the server's stream instead of the recording (S1)
 *   ?every=1000                wall milliseconds between the recording's messages (0: all
 *                              at once, the last day; the default is 1000)
 *   ?painter=inline            paint the ground on the page's thread, not in a worker (to
 *                              compare: the frames stop while it paints)
 *
 * The camera's moves between views and who it follows are R3; creatures are R2.
 */
import { Application, Container } from "pixi.js";
import { Landscape, TILES, VIEWS, type ViewName } from "./landscape";
import { DESIGN_HEIGHT, DESIGN_WIDTH, fitToViewport } from "./scene";
import type { Message } from "./protocol";
import { Recording, SocketSource, type Source } from "./stream";
import { InlinePainter, makePainter } from "./terrain/painter";

/** Screen pixels per art pixel (ADR 0007). */
const ART = 2;
const WIDTH = DESIGN_WIDTH / ART;
const HEIGHT = DESIGN_HEIGHT / ART;
/** The deepest sea: what shows beyond the world. */
const BACKGROUND = "#24529c";
const RECORDING = "stream/recording.json";

declare global {
  interface Window {
    /** True once the view shows the latest day, fully painted (the visual tests wait for it). */
    __sceneSettled?: () => boolean;
    /** Hand the scene a message as if the stream had sent it (tests and measurements). */
    __receive?: (message: Message) => void;
  }
}

function viewOf(name: string | null): ViewName {
  return (VIEWS as readonly string[]).includes(name ?? "") ? (name as ViewName) : "middle";
}

async function start(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const view = viewOf(params.get("view"));
  const tile = TILES[view];

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
  );
  world.addChild(landscape.container);

  const socket = params.get("source");
  const every = Number(params.get("every") ?? 1000);
  const source: Source =
    socket !== null ? new SocketSource(socket) : await Recording.load(RECORDING, every);
  source.listen((message) => landscape.receive(message));

  window.__sceneSettled = () => landscape.settled;
  window.__receive = (message) => landscape.receive(message);
  // The view first, so that the first land is laid out for it alone.
  landscape.show(view, { x0: 0, y0: 0, x1: 0, y1: 0 });
  app.ticker.add((ticker) => {
    const size = landscape.size;
    if (size === null) {
      // Nothing drawn until the first land: let it be laid out.
      landscape.update(0);
      return;
    }
    const x = Number(params.get("x") ?? size.width / 2);
    const y = Number(params.get("y") ?? size.height / 2);
    // The map shows the whole world whatever is asked.
    const centre = view === "map" ? { x: size.width / 2, y: size.height / 2 } : { x, y };
    const cells = {
      x0: centre.x - WIDTH / tile / 2,
      y0: centre.y - HEIGHT / tile / 2,
      x1: centre.x + WIDTH / tile / 2,
      y1: centre.y + HEIGHT / tile / 2,
    };
    landscape.show(view, cells);
    landscape.update(ticker.deltaMS / 1000);
    world.scale.set(tile);
    world.position.set(Math.round(-cells.x0 * tile), Math.round(-cells.y0 * tile));
  });
}

void start();
