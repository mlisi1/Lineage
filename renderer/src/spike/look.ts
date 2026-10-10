/**
 * The look sheet: how the renderer draws terrain, plants and creatures today.
 *
 *   look.html             live: creatures walk, pictures on screen keep updating
 *   look.html?still=8     let the creatures walk for 8 s, then draw every picture once
 *
 * `npm run look` turns the still page into a self-contained report. The words are in
 * look.html; this file fills in the pictures.
 */
import { bodyPlan } from "./body";
import type { CellRect } from "./camera";
import type { Point } from "./chain";
import type { CreatureLayer } from "./creatures";
import { parseFixture, type Cast, type CreatureSeed, type WorldFixture } from "./fixture";
import type { Passable } from "./habitat";
import { LIGHT_ORDER } from "./light";
import { ART, FORMS, STAGES, VARIANTS, hexToRgb, rasterise, type Form } from "./pixelart";
import { mulberry32, type Random } from "./rng";
import { DESIGN_HEIGHT, DESIGN_WIDTH } from "../scene";
import { findSite, forest, meadow, shore } from "./sites";
import { Stage, type Picture } from "./stage";

/** Replaced by Vite with the commit the page was built from. */
declare const __BUILD_COMMIT__: string;

declare global {
  interface Window {
    /** Set once every picture has been drawn (the report script waits for it). */
    __lookReady?: boolean;
    /** The page as one self-contained HTML document, pictures as inline images. */
    __lookStandalone?: () => string;
  }
}

/** Screen pixels per cell in a wide shot and in a close-up, at 1024×600. */
const WIDE_ZOOM = 4;
const CLOSE_ZOOM = 16;
/** A portrait: this many art pixels, at the close-up's scale, shown enlarged. */
const PORTRAIT = { width: 64, height: 60 };
const SPECIMEN_ENLARGED = 3;
const SWEEP_ENLARGED = 2;
/** Members of the world's own herd that join the specimens in the staged shot. */
const HERD_IN_STAGED_SHOT = 10;
/** Cells kept clear of a region's edge when placing creatures in it. */
const PLACING_MARGIN = 3;
const PLACING_TRIES = 300;
/** Longest step of the animation, so a stalled tab does not teleport anybody. */
const MAX_STEP_S = 0.1;
const STILL_STEP_S = 1 / 30;
/** Enlargement of the plant drawings in the sprite sheet. */
const SPRITE_ENLARGED = 6;

/** What each swept gene does to the body, in the sheet's words. */
const SWEEP_NOTES: Readonly<Record<string, readonly [string, string]>> = {
  size: [
    "Size",
    "Mass from 0.25 to 16. Length grows with its cube root; longer bodies get more segments.",
  ],
  limbs: [
    "Limbs",
    "Zero to four leg pairs, spread from chest to hips. Without legs the body slithers.",
  ],
  speed: ["Speed", "Muscle. A fast animal is slimmer, longer in the leg, and walks faster."],
  armour: ["Armour", "A dark shell around the whole outline, thicker with the gene."],
  sense: ["Sense", "Bigger eyes."],
  aquatic: [
    "Aquatic",
    "Side fins and a tail fluke from 0.3. From 0.6 the animal lives in the water.",
  ],
  jaw: ["Jaw", "Mandibles, longer with the gene."],
  diet: ["Diet", "The colour of the jaws: dark on a grazer, ivory on a hunter."],
  hue: ["Hue", "Body colour, once round the colour wheel."],
  pattern: ["Pattern", "Plain, then banded, then spotted."],
};

interface Drawn {
  picture: Picture;
  context: CanvasRenderingContext2D;
  /** On screen now; pictures out of sight are not redrawn. */
  seen: boolean;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`look.html has no #${id}`);
  return found;
}

function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

/** Size a canvas for a picture drawn at `width` × `height` and shown `enlarged` times. */
function size(canvas: HTMLCanvasElement, width: number, height: number, enlarged: number): void {
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * enlarged}px`;
  canvas.style.height = `${height * enlarged}px`;
}

/** "#rrggbb" → 0xRRGGBB. */
function packed(colour: string): number {
  const [r, g, b] = hexToRgb(colour);
  return (r << 16) | (g << 8) | b;
}

const middle = (rect: CellRect): Point => ({
  x: (rect.x0 + rect.x1) / 2,
  y: (rect.y0 + rect.y1) / 2,
});

/** Copies of `seeds` placed at random in `region`, each where its body can live. */
function scatter(
  seeds: readonly CreatureSeed[],
  region: CellRect,
  passable: Passable,
  random: Random,
): CreatureSeed[] {
  const width = region.x1 - region.x0 - 2 * PLACING_MARGIN;
  const height = region.y1 - region.y0 - 2 * PLACING_MARGIN;
  return seeds.map((seed) => {
    const swims = bodyPlan(seed).swims;
    // Should nothing fit (no water in sight for a swimmer), the layer moves it to the nearest.
    let spot = middle(region);
    for (let attempt = 0; attempt < PLACING_TRIES; attempt++) {
      const x = region.x0 + PLACING_MARGIN + random() * width;
      const y = region.y0 + PLACING_MARGIN + random() * height;
      if (passable(x, y, swims)) {
        spot = { x, y };
        break;
      }
    }
    return { ...seed, x: spot.x, y: spot.y };
  });
}

/** "herbivore · mass 0.9 · 2 leg pairs · armoured, spotted" */
function describe(seed: CreatureSeed, fixture: WorldFixture): string {
  const plan = bodyPlan(seed);
  const diet =
    seed.diet <= fixture.herbivoreMaxDiet
      ? "herbivore"
      : seed.diet >= fixture.predatorMinDiet
        ? "predator"
        : "omnivore";
  const pairs = plan.legJoints.length;
  const legs = pairs === 0 ? "no legs" : `${pairs} leg pair${pairs === 1 ? "" : "s"}`;
  const traits = [
    plan.swims ? "swimmer" : plan.finLength > 0 ? "finned" : "",
    plan.shell > 0 ? "armoured" : "",
    plan.pattern === "plain" ? "" : plan.pattern === "bands" ? "banded" : "spotted",
  ].filter((trait) => trait !== "");
  const mass = seed.mass >= 10 ? seed.mass.toFixed(0) : seed.mass.toFixed(1);
  return [diet, `mass ${mass}`, legs, traits.join(", ")].filter((part) => part !== "").join(" · ");
}

/** The plant drawings, enlarged: a row per form, young then grown, green then dry. */
function plantSheet(host: HTMLElement, fixture: WorldFixture): void {
  const table = create("table", "sprites");
  const head = create("tr");
  head.append(create("th"));
  for (const title of ["young", "grown", "young, dry", "grown, dry"]) {
    const cell = create("th", "", title);
    cell.colSpan = VARIANTS;
    head.append(cell);
  }
  table.append(head);
  const draw = (form: Form, dormant: boolean): HTMLTableCellElement[] =>
    STAGES.flatMap((stage) =>
      Array.from({ length: VARIANTS }, (_, variant) => {
        const cell = create("td");
        const bitmap = ART[form][stage][variant];
        const ramp = fixture.palette[dormant ? "DORMANT" : form];
        if (bitmap === undefined || ramp === undefined) return cell;
        if (dormant && !fixture.dormantClasses.includes(form)) return cell;
        const pixels = rasterise(bitmap, ramp);
        const canvas = create("canvas");
        size(canvas, pixels.width, pixels.height, SPRITE_ENLARGED);
        canvas.setAttribute(
          "aria-label",
          `${form.toLowerCase()}, ${stage}${dormant ? ", dry" : ""}`,
        );
        canvas
          .getContext("2d")
          ?.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
        cell.append(canvas);
        return cell;
      }),
    );
  for (const form of FORMS) {
    const row = create("tr");
    row.append(create("th", "", form.toLowerCase()), ...draw(form, false), ...draw(form, true));
    table.append(row);
  }
  host.append(table);
}

async function main(): Promise<void> {
  const still = new URLSearchParams(window.location.search).get("still");
  const response = await fetch("spike/world.json");
  if (!response.ok) throw new Error(`spike/world.json: HTTP ${response.status}`);
  const fixture = parseFixture(await response.json());
  const stage = await Stage.create(fixture, "spike", DESIGN_WIDTH, DESIGN_HEIGHT);
  const { passable } = stage.layers;
  const random = mulberry32(2026);
  const island: CellRect = { x0: 0, y0: 0, x1: fixture.width, y1: fixture.height };
  const cast = (name: string): Cast => {
    const found = fixture.casts.find((candidate) => candidate.name === name);
    if (found === undefined) throw new Error(`the fixture has no cast "${name}"`);
    return found;
  };

  element("world").textContent = fixture.description;
  element("build").textContent =
    typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "unknown";
  element("drawn-with").textContent = stage.api === "webgl" ? "WebGL" : stage.api;

  const drawn: Drawn[] = [];
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const found = drawn.find((candidate) => candidate.context.canvas === entry.target);
      if (found !== undefined) found.seen = entry.isIntersecting;
    }
  });
  const show = (canvas: HTMLCanvasElement, picture: Picture, enlarged: number): void => {
    size(canvas, picture.width, picture.height, enlarged);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2D canvas");
    drawn.push({ picture, context, seen: true });
    watcher.observe(canvas);
  };
  /** A picture the page already has a place for: `<canvas data-picture="name">`. */
  const place = (name: string, picture: Picture, enlarged: number): void => {
    const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-picture="${name}"]`);
    if (canvas === null) throw new Error(`look.html has no picture "${name}"`);
    show(canvas, picture, enlarged);
  };
  const base = {
    backdrop: "ground",
    plants: "icons",
    light: "day",
    cast: null,
    follow: null,
  } as const;

  // 1. The island from afar: the whole world on the screen.
  const wide = { ...base, width: DESIGN_WIDTH, height: DESIGN_HEIGHT, zoom: WIDE_ZOOM };
  const herd = stage.cast(fixture.creatures, 1);
  place("wide-ground", { ...wide, plants: null, centre: middle(island) }, 1);
  place(
    "wide-map",
    { ...wide, backdrop: "map", plants: null, cast: herd, centre: middle(island) },
    1,
  );

  // 2. Plants: the drawings, then two places that show them.
  plantSheet(element("plant-sheet"), fixture);
  const close = { ...base, width: DESIGN_WIDTH, height: DESIGN_HEIGHT, zoom: CLOSE_ZOOM };
  const window64 = [DESIGN_WIDTH / CLOSE_ZOOM, Math.ceil(DESIGN_HEIGHT / CLOSE_ZOOM)] as const;
  place("meadow", { ...close, centre: middle(findSite(fixture, ...window64, meadow)) }, 1);
  place("forest", { ...close, centre: middle(findSite(fixture, ...window64, forest)) }, 1);

  // 3. Creatures: each specimen followed by its own camera, then one gene at a time.
  const portrait = (layer: CreatureLayer, follow: number): Picture => ({
    ...base,
    ...PORTRAIT,
    zoom: CLOSE_ZOOM,
    cast: layer,
    follow,
    centre: middle(island),
  });
  // Gene sweeps are compared on one flat colour: sand, or sea for those that swim.
  const sand = packed(fixture.palette["BARE"]?.[2] ?? "#cdbd9f");
  const sea = packed(fixture.sea[Math.floor(fixture.sea.length / 2)] ?? "#3b7fbf");
  const tile = (name: string, note: string, picture: Picture, enlarged: number): HTMLElement => {
    const figure = create("figure", "tile");
    const canvas = create("canvas");
    canvas.setAttribute("aria-label", `${name}: ${note}`);
    const caption = create("figcaption");
    caption.append(create("b", "", name), create("span", "", note));
    figure.append(canvas, caption);
    show(canvas, picture, enlarged);
    return figure;
  };
  const roomy: CellRect = { x0: 8, y0: 8, x1: fixture.width - 8, y1: fixture.height - 8 };
  const specimens = cast("specimens");
  const specimenLayer = stage.cast(scatter(specimens.creatures, roomy, passable, random), 2);
  specimens.creatures.forEach((seed, index) => {
    const name = specimens.members[index] ?? "";
    const picture = portrait(specimenLayer, index);
    element("specimens").append(tile(name, describe(seed, fixture), picture, SPECIMEN_ENLARGED));
  });
  for (const sweep of fixture.casts.filter((candidate) => candidate.name.startsWith("sweep-"))) {
    const gene = sweep.name.slice("sweep-".length);
    const [title, note] = SWEEP_NOTES[gene] ?? [gene, ""];
    const layer = stage.cast(scatter(sweep.creatures, roomy, passable, random), 3);
    const row = create("div", "sweep");
    const label = create("div", "gene");
    label.append(create("b", "", title), create("span", "", note));
    const steps = create("div", "steps");
    sweep.creatures.forEach((seed, index) => {
      const value = sweep.members[index] ?? "";
      const backdrop = bodyPlan(seed).swims ? sea : sand;
      const picture = { ...portrait(layer, index), plants: null, backdrop };
      steps.append(tile(value, "", picture, SWEEP_ENLARGED));
    });
    row.append(label, steps);
    element("sweeps").append(row);
  }

  // 4. Together: one staged shot at three sizes of art pixel, then in four lights.
  const beach = findSite(fixture, ...window64, shore);
  const troupe = stage.cast(
    scatter(
      [...specimens.creatures, ...fixture.creatures.slice(0, HERD_IN_STAGED_SHOT)],
      beach,
      passable,
      random,
    ),
    4,
  );
  for (const artScale of [1, 2, 4]) {
    const picture = {
      ...base,
      width: DESIGN_WIDTH / artScale,
      height: DESIGN_HEIGHT / artScale,
      zoom: CLOSE_ZOOM / artScale,
      cast: troupe,
      centre: middle(beach),
    };
    place(`together-${artScale}x`, picture, artScale);
    if (artScale !== 2) continue;
    for (const light of LIGHT_ORDER) place(`light-${light}`, { ...picture, light }, 1);
  }

  // 5. Three ways to put plants on the ground, in the wood and on the staged shore.
  const styles = {
    now: { backdrop: "ground", plants: "icons" },
    green: { backdrop: "map", plants: "icons" },
    painted: { backdrop: "painted", plants: "scattered" },
  } as const;
  const half = {
    ...base,
    width: DESIGN_WIDTH / 2,
    height: DESIGN_HEIGHT / 2,
    zoom: CLOSE_ZOOM / 2,
  };
  const wood = middle(findSite(fixture, ...window64, forest));
  for (const [name, style] of Object.entries(styles)) {
    place(`style-wood-${name}`, { ...half, ...style, centre: wood }, 2);
    place(`style-shore-${name}`, { ...half, ...style, cast: troupe, centre: middle(beach) }, 2);
  }
  element("count-icons").textContent = stage.layers.plants.count.toLocaleString("en");
  element("count-scattered").textContent = stage.paintedLayers.scattered.count.toLocaleString("en");

  const drawAll = (): void => {
    for (const { picture, context } of drawn) stage.draw(picture, context);
  };
  if (still !== null) {
    const steps = Math.round(Math.min(Math.max(Number(still) || 0, 0), 120) / STILL_STEP_S);
    for (let step = 0; step < steps; step++) stage.tick(STILL_STEP_S);
    drawAll();
  } else {
    stage.tick(0);
    drawAll();
    let last = performance.now();
    const frame = (now: number): void => {
      stage.tick(Math.min((now - last) / 1000, MAX_STEP_S));
      last = now;
      // Only what moves and can be seen: a picture without creatures never changes.
      for (const { picture, context, seen } of drawn) {
        if (seen && picture.cast !== null) stage.draw(picture, context);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  window.__lookStandalone = (): string => {
    drawAll();
    const copy = document.documentElement.cloneNode(true) as HTMLElement;
    const sources = [...document.querySelectorAll("canvas")];
    [...copy.querySelectorAll("canvas")].forEach((canvas, index) => {
      const image = create("img");
      image.src = sources[index]?.toDataURL("image/png") ?? "";
      image.alt = canvas.getAttribute("aria-label") ?? "";
      image.width = canvas.width;
      image.height = canvas.height;
      image.style.cssText = canvas.style.cssText;
      canvas.replaceWith(image);
    });
    for (const node of copy.querySelectorAll("script, link, [data-live]")) node.remove();
    for (const node of copy.querySelectorAll("[data-still]")) node.removeAttribute("hidden");
    return `<!doctype html>\n${copy.outerHTML}\n`;
  };
  window.__lookReady = true;
}

main().catch((error: unknown) => {
  element("failure").textContent = error instanceof Error ? error.message : String(error);
  element("failure").hidden = false;
  window.__lookReady = true;
});
