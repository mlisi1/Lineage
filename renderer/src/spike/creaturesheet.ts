/**
 * The creature sheet (R2): how the renderer draws animals, the phenotype it draws them
 * from, and the styles to choose between, side by side on the same animals walking the
 * same paths.
 *
 *   creatures.html             live: creatures walk
 *   creatures.html?still=8     let them walk for 8 s, then draw every picture once
 *
 * `npm run creatures` turns the still page into a self-contained report. The words are
 * in creatures.html; this file fills in the pictures and the table.
 */
import reference from "../../../sim/tests/fixtures/phenotypes.json";
import { PATTERNS, bodyPlan, kindOf, type CreatureStyle } from "../creatures/body";
import type { Point } from "../creatures/chain";
import { parsePhenotypeConfig, phenotype, type Phenotype } from "../creatures/phenotype";
import { DESIGN_HEIGHT, DESIGN_WIDTH } from "../scene";
import type { CellRect } from "./camera";
import type { CreatureLayer } from "./creatures";
import { parseFixture, type Cast, type CreatureSeed } from "./fixture";
import { MID_TILE, paintGround } from "./ground";
import {
  CREATURE_SCALE,
  GROUND,
  LOCAL_PIXELS,
  MID_CREATURE_SCALE,
  PORTRAIT_PIXELS,
} from "./proposal";
import { mulberry32 } from "./rng";
import {
  around,
  create,
  describe,
  element,
  middle,
  packed,
  pen,
  scatter,
  size,
  standalone,
  type Drawn,
} from "./sheetkit";
import { findSite, meadow, shore } from "./sites";
import { standingPlants } from "./plants";
import { Stage, type Picture } from "./stage";

/** Replaced by Vite with the commit the page was built from. */
declare const __BUILD_COMMIT__: string;

/** The styles compared: R0's, then the one chosen in R2 (ADR 0013). */
const STYLES: readonly CreatureStyle[] = ["lit", "cosy"];
const STYLE_NAMES: Readonly<Record<string, string>> = {
  lit: "lit (R0)",
  cosy: "cosy (chosen, ADR 0013)",
};
/** Screen pixels per art pixel, as on the desk. */
const ART = 2;
const VIEW = { width: DESIGN_WIDTH / ART, height: DESIGN_HEIGHT / ART };
/** A specimen on its patch of ground at the local view's size, and as a portrait on sand. */
const SPECIMEN = { width: 112, height: 88, enlarged: 2 };
const SWATCH = { width: 84, height: 64, enlarged: 2 };
const SPECIMEN_PEN = { x: 0.8, y: 0.55 };
const SCENE_PEN = { x: 5, y: 3 };
/** Animals of the world's own herd that join the specimens in the middle view. */
const HERD_IN_MID = 10;
/** Cells painted beyond a picture's edge, so that the shore's outline has what to meet. */
const PAINT_MARGIN = 1;
const MAX_STEP_S = 0.1;
const STILL_STEP_S = 1 / 30;
/**
 * The stand-in for the sim's ticks in the sheet: every this many seconds (the sim's ten
 * minutes, sped up so a loop holds a few), each animal's place moves up to this far.
 */
const SIM_TICK_S = 3;
const SIM_STEP_CELLS = 1.6;
/** The local view's scenes: who is in each. */
const SCENES = {
  meadow: ["grazer", "giant", "mouse", "hunter", "random-3", "tank"],
  shore: ["random-2", "frog", "eel", "all-one", "random-1"],
} as const;

interface Specimen {
  name: string;
  genome: number[];
  phenotype: Record<string, number>;
}

/** The sim's field names (`land_speed`) to the port's (`landSpeed`). */
const camel = (name: string): string => name.replace(/_(.)/g, (_, c: string) => c.toUpperCase());

/** The port against the sim, one row per specimen: largest relative difference over every value. */
function phenotypeTable(host: HTMLElement): void {
  const config = parsePhenotypeConfig(reference.config);
  const table = create("table", "cost");
  const head = create("tr");
  for (const title of [
    "Specimen",
    "Kind",
    "Mass",
    "Leg pairs",
    "Land speed (cells/h)",
    "Swim speed (cells/h)",
    "Values checked",
    "Largest difference",
  ]) {
    head.append(create("th", "", title));
  }
  table.append(head);
  let worst = 0;
  for (const specimen of reference.specimens as Specimen[]) {
    const body = phenotype(config, specimen.genome);
    let largest = 0;
    const expected = Object.entries(specimen.phenotype);
    for (const [name, value] of expected) {
      const ported = body[camel(name) as keyof Phenotype];
      largest = Math.max(largest, Math.abs(ported - value) / Math.max(Math.abs(value), 1e-6));
    }
    worst = Math.max(worst, largest);
    const look = { ...body, ...lookGenes(specimen.genome) };
    const row = create("tr");
    for (const cell of [
      specimen.name,
      kindOf(look),
      body.mass.toFixed(2),
      body.limbPairs.toFixed(0),
      body.landSpeed.toFixed(2),
      body.swimSpeed.toFixed(2),
      String(expected.length),
      largest === 0 ? "none" : largest.toExponential(1),
    ]) {
      row.append(create("td", "", cell));
    }
    table.append(row);
  }
  const wrap = create("div", "wrap");
  wrap.append(table);
  host.append(wrap);
  element("phenotype-worst").textContent = worst === 0 ? "none" : worst.toExponential(1);
}

/** The genes a look needs, from a genome in the sim's order. */
function lookGenes(genome: readonly number[]): Omit<CreatureSeed, keyof Phenotype | "x" | "y"> {
  const gene = (name: string): number => genome[reference.genes.indexOf(name)] ?? 0;
  return {
    genome,
    diet: gene("DIET"),
    speed: gene("SPEED"),
    armour: gene("ARMOUR"),
    sense: gene("SENSE"),
    aquatic: gene("AQUATIC"),
    jaw: gene("JAW"),
    hue: gene("HUE"),
    pattern: gene("PATTERN"),
  };
}

async function main(): Promise<void> {
  const still = new URLSearchParams(window.location.search).get("still");
  const response = await fetch("spike/world.json");
  if (!response.ok) throw new Error(`spike/world.json: HTTP ${response.status}`);
  const fixture = parseFixture(await response.json());
  const stage = await Stage.create(fixture, "spike", VIEW.width, VIEW.height);
  const { passable } = stage;
  const random = mulberry32(2026);
  const island: CellRect = { x0: 0, y0: 0, x1: fixture.width, y1: fixture.height };
  const cast = (name: string): Cast => {
    const found = fixture.casts.find((candidate) => candidate.name === name);
    if (found === undefined) throw new Error(`the fixture has no cast "${name}"`);
    return found;
  };
  const specimens = cast("specimens");
  const specimen = (name: string): CreatureSeed => {
    const found = specimens.creatures[specimens.members.indexOf(name)];
    if (found === undefined) throw new Error(`no specimen "${name}"`);
    return found;
  };

  element("world").textContent = fixture.description;
  element("build").textContent =
    typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "unknown";
  phenotypeTable(element("phenotype"));

  const drawn: Drawn[] = [];
  const show = (canvas: HTMLCanvasElement, picture: Picture, enlarged: number): void => {
    size(canvas, picture.width, picture.height, enlarged);
    const context = canvas.getContext("2d", { willReadFrequently: still !== null });
    if (context === null) throw new Error("no 2D canvas");
    drawn.push({ picture, context, seen: true });
  };
  /** A figure: one picture per style, side by side, and a caption. */
  const pair = (name: string, note: string, pictures: readonly Picture[], enlarged: number) => {
    const figure = create("figure", "tile");
    const row = create("div", "pair");
    pictures.forEach((picture, index) => {
      const canvas = create("canvas");
      canvas.setAttribute("aria-label", `${name}, ${STYLES[index] ?? ""}`);
      row.append(canvas);
      show(canvas, picture, enlarged);
    });
    const caption = create("figcaption");
    caption.append(create("b", "", name), create("span", "", note));
    figure.append(row, caption);
    return figure;
  };
  const base = {
    ...VIEW,
    plants: null,
    light: "day",
    cast: null,
    markers: false,
    follow: null,
    only: null,
    subject: null,
  } as const;
  /** Paint ground round `centre`; with `plants`, under the shadows of what grows there. */
  const paint = (
    name: string,
    centre: Point,
    pixels: number,
    width: number,
    height: number,
    plants = false,
  ) => {
    const cells = around(centre, width / pixels, height / pixels, PAINT_MARGIN, fixture);
    const shading = plants ? standingPlants(fixture, pixels, { close: true }) : null;
    stage.addGround(
      name,
      paintGround(fixture, {
        tile: pixels,
        style: GROUND,
        grain: true,
        cells,
        season: fixture.season,
        ...(shading === null ? {} : { shadows: shading.shadows(cells) }),
      }),
      pixels,
      cells,
    );
  };
  /** One cast per style: the same animals, the same seed, so the same paths. */
  const casts = (seeds: readonly CreatureSeed[], seed: number, pixels: number, scale: number) =>
    STYLES.map((style) =>
      stage.cast(seeds, seed, { style, scale, pixels, pace: pixels >= LOCAL_PIXELS ? 0.35 : 1 }),
    );

  // 1. The local view: two scenes, the whole screen, in each style.
  const localCells = [VIEW.width / LOCAL_PIXELS, Math.ceil(VIEW.height / LOCAL_PIXELS)] as const;
  const sites = {
    meadow: middle(findSite(fixture, ...localCells, meadow)),
    shore: middle(findSite(fixture, ...localCells, shore)),
  };
  stage.addPlants("local", standingPlants(fixture, LOCAL_PIXELS, { close: true }));
  for (const scene of ["meadow", "shore"] as const) {
    const centre = sites[scene];
    paint(scene, centre, LOCAL_PIXELS, VIEW.width, VIEW.height, true);
    const players = scatter(
      SCENES[scene].map(specimen),
      pen(centre, SCENE_PEN),
      passable,
      random,
    ).map((seed) => ({ ...seed, pen: pen(centre, SCENE_PEN) }));
    const layers = casts(players, 5, LOCAL_PIXELS, CREATURE_SCALE);
    STYLES.forEach((style, index) => {
      const figure = create("figure", "screen");
      const canvas = create("canvas");
      canvas.setAttribute("aria-label", `${scene}, ${style}`);
      const caption = create("figcaption", "", STYLE_NAMES[style] ?? style);
      figure.append(canvas, caption);
      element(`local-${scene}`).append(figure);
      show(
        canvas,
        {
          ...base,
          zoom: LOCAL_PIXELS,
          ground: scene,
          plants: "local",
          cast: layers[index] ?? null,
          subject: 0,
          centre,
        },
        ART,
      );
    });
  }

  // Between sim ticks: the same meadow, its animals anchored to places a stand-in for the
  // sim moves on every few seconds, as the sim does every ten minutes.
  {
    const centre = sites.meadow;
    const players = scatter(SCENES.meadow.map(specimen), pen(centre, SCENE_PEN), passable, random);
    const anchored = stage.cast(
      players,
      7,
      { style: "cosy", scale: CREATURE_SCALE, pixels: LOCAL_PIXELS, pace: 0.35 },
      "anchored",
    );
    const sim = mulberry32(77);
    const places = players.map((seed) => ({ x: seed.x, y: seed.y }));
    let sinceTick = 0;
    stage.onTick((dtS) => {
      sinceTick += dtS;
      if (sinceTick < SIM_TICK_S) return;
      sinceTick -= SIM_TICK_S;
      places.forEach((place, index) => {
        // A step of up to a cell or so, where the body can live and within the scene.
        const player = players[index];
        const swims = player === undefined ? false : bodyPlan(player).swims;
        for (let attempt = 0; attempt < 8; attempt++) {
          const angle = sim() * 2 * Math.PI;
          const x = place.x + Math.cos(angle) * SIM_STEP_CELLS * sim();
          const y = place.y + Math.sin(angle) * SIM_STEP_CELLS * sim();
          const inside =
            Math.abs(x - centre.x) < SCENE_PEN.x && Math.abs(y - centre.y) < SCENE_PEN.y;
          if (inside && passable(x, y, swims)) {
            place.x = x;
            place.y = y;
            break;
          }
        }
        anchored.anchor(index, place.x, place.y);
      });
    });
    const figure = create("figure", "screen");
    const canvas = create("canvas");
    canvas.setAttribute("aria-label", "the meadow, anchored to the sim's places");
    figure.append(canvas, create("figcaption", "", "cosy, anchored: life between sim ticks"));
    element("ticks").append(figure);
    show(
      canvas,
      {
        ...base,
        zoom: LOCAL_PIXELS,
        ground: "meadow",
        plants: "local",
        cast: anchored,
        subject: 0,
        centre,
      },
      ART,
    );
  }

  // 2. The middle view: the specimens and some of the herd on a shore.
  const midPlants = standingPlants(fixture, MID_TILE);
  const midCells = [VIEW.width / MID_TILE, Math.ceil(VIEW.height / MID_TILE)] as const;
  const midShore = middle(findSite(fixture, ...midCells, shore));
  const midArea = around(midShore, midCells[0], midCells[1], PAINT_MARGIN, fixture);
  stage.addGround(
    "mid",
    paintGround(fixture, {
      tile: MID_TILE,
      style: GROUND,
      grain: true,
      cells: midArea,
      season: fixture.season,
      shadows: midPlants.shadows(midArea),
    }),
    MID_TILE,
    midArea,
  );
  stage.addPlants("mid", midPlants);
  const troupe = scatter(
    [...specimens.creatures, ...fixture.creatures.slice(0, HERD_IN_MID)],
    around(midShore, midCells[0], midCells[1], 0, fixture),
    passable,
    random,
  );
  casts(troupe, 4, MID_TILE, MID_CREATURE_SCALE).forEach((layer, index) => {
    const style = STYLES[index] ?? "lit";
    const figure = create("figure", "screen");
    const canvas = create("canvas");
    canvas.setAttribute("aria-label", `middle view, ${style}`);
    figure.append(canvas, create("figcaption", "", STYLE_NAMES[style] ?? style));
    element("mid").append(figure);
    show(
      canvas,
      { ...base, zoom: MID_TILE, ground: "mid", plants: "mid", cast: layer, centre: midShore },
      ART,
    );
  });

  // 3. Each specimen: on its patch at the local view's size, and as a portrait on sand.
  const roomy: CellRect = { x0: 8, y0: 8, x1: fixture.width - 8, y1: fixture.height - 8 };
  const standing = scatter(specimens.creatures, roomy, passable, random).map((seed) => ({
    ...seed,
    pen: pen(seed, SPECIMEN_PEN),
  }));
  const onPatch = casts(standing, 2, LOCAL_PIXELS, CREATURE_SCALE);
  const sand = packed(fixture.palette["BARE"]?.[2] ?? "#cdbd9f");
  const sea = packed(fixture.sea[Math.floor(fixture.sea.length / 2)] ?? "#3b7fbf");
  const swatch = (layer: CreatureLayer, seed: CreatureSeed, index: number, zoom: number) => ({
    ...base,
    ...SWATCH,
    zoom,
    ground: bodyPlan(seed).swims ? sea : sand,
    cast: layer,
    follow: index,
    centre: middle(island),
  });
  const portraits = casts(
    scatter(specimens.creatures, roomy, passable, random),
    3,
    PORTRAIT_PIXELS,
    CREATURE_SCALE,
  );
  standing.forEach((seed, index) => {
    const name = specimens.members[index] ?? "";
    paint(`specimen-${name}`, seed, LOCAL_PIXELS, SPECIMEN.width, SPECIMEN.height);
    const patch = onPatch.map((layer): Picture => ({
      ...base,
      ...SPECIMEN,
      zoom: LOCAL_PIXELS,
      ground: `specimen-${name}`,
      cast: layer,
      only: index,
      centre: { x: seed.x, y: seed.y },
    }));
    const row = create("div", "specimen");
    row.append(
      pair(name, describe(seed, fixture), patch, SPECIMEN.enlarged),
      pair(
        "portrait",
        "",
        portraits.map((layer) => swatch(layer, seed, index, PORTRAIT_PIXELS)),
        SWATCH.enlarged,
      ),
    );
    element("specimens").append(row);
  });

  // 4. Markings on a beast's back in both styles.
  const plain = cast("sweep-pattern").creatures[0];
  if (plain !== undefined) {
    const beast = { ...plain, speed: 0.3 };
    const marked = PATTERNS.map((_, k) => ({
      ...beast,
      pattern: (k + 0.1 + 0.25 * (k % 4)) / PATTERNS.length,
    }));
    const layers = casts(
      scatter(marked, roomy, passable, random),
      6,
      PORTRAIT_PIXELS,
      CREATURE_SCALE,
    );
    marked.forEach((seed, k) => {
      element("patterns").append(
        pair(
          PATTERNS[k] ?? "",
          "",
          layers.map((layer) => swatch(layer, seed, k, PORTRAIT_PIXELS)),
          SWATCH.enlarged,
        ),
      );
    });
  }

  // 5. One gene at a time, in the proposed style only.
  for (const sweep of fixture.casts.filter((candidate) => candidate.name.startsWith("sweep-"))) {
    const gene = sweep.name.slice("sweep-".length);
    const zoom = gene === "size" ? LOCAL_PIXELS : PORTRAIT_PIXELS;
    const layer = stage.cast(scatter(sweep.creatures, roomy, passable, random), 3, {
      style: "cosy",
      scale: CREATURE_SCALE,
      pixels: zoom,
      pace: 0.35,
    });
    const row = create("div", "sweep");
    const label = create("div", "gene");
    label.append(create("b", "", gene));
    const steps = create("div", "steps");
    sweep.creatures.forEach((seed, index) => {
      const figure = create("figure", "tile");
      const canvas = create("canvas");
      canvas.setAttribute("aria-label", `${gene} ${sweep.members[index] ?? ""}`);
      figure.append(
        canvas,
        create("figcaption", "", `${sweep.members[index] ?? ""} · ${kindOf(seed)}`),
      );
      steps.append(figure);
      show(canvas, swatch(layer, seed, index, zoom), SWATCH.enlarged);
    });
    row.append(label, steps);
    element("sweeps").append(row);
  }

  const drawAll = (): void => {
    for (const { picture, context } of drawn) stage.draw(picture, context);
  };
  let filming = false;
  if (still !== null) {
    const steps = Math.round(Math.min(Math.max(Number(still) || 0, 0), 120) / STILL_STEP_S);
    // Pose every body once, so that a sheet taken at once (still=0) shows them.
    stage.tick(0);
    for (let step = 0; step < steps; step++) stage.tick(STILL_STEP_S);
    drawAll();
  } else {
    stage.tick(0);
    drawAll();
    let last = performance.now();
    const frame = (now: number): void => {
      const dtS = Math.min((now - last) / 1000, MAX_STEP_S);
      last = now;
      requestAnimationFrame(frame);
      if (filming) return;
      stage.tick(dtS);
      for (const { picture, context } of drawn) {
        if (picture.cast !== null) stage.draw(picture, context);
      }
    };
    requestAnimationFrame(frame);
  }
  window.__lookStandalone = async (film): Promise<string> => {
    filming = true;
    drawAll();
    const html = await standalone(drawn, stage, STILL_STEP_S, film);
    filming = false;
    return html;
  };
  window.__lookReady = true;
}

main().catch((error: unknown) => {
  element("failure").textContent = error instanceof Error ? error.message : String(error);
  element("failure").hidden = false;
  window.__lookReady = true;
});
