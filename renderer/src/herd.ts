/**
 * The animals of the state stream in the scene (R3): R2's creature layers fed from the
 * `fauna`, `rare`, `species` and `creatures` messages, one layer drawn for the middle view
 * (and as dots on the map) and one for the local view, each animal standing among the
 * plants of the view shown.
 *
 * The stream names animals by ids they keep for life; a layer holds them in slots. The
 * roster gives each newcomer a free slot and frees the slots of the dead. Each animal is
 * kept near where the sim last put it (`life: "anchored"`), and lives there between ticks.
 */
import type { Container } from "pixi.js";
import type { Spot } from "./atmosphere/atmosphere";
import type { CardFacts } from "./card";
import { colour, lookOf } from "./creatures/body";
import { ownColours, speciesColours, type SpeciesColour } from "./creatures/colours";
import { GENE_NAMES, type Genome } from "./creatures/genome";
import { parsePhenotypeConfig, phenotype, type PhenotypeConfig } from "./creatures/phenotype";
import { DYING, Remains, type BodyView, type Cause, type Laid } from "./creatures/remains";
import {
  parseRareConfig,
  rareLooks,
  withRare,
  type RareConfig,
  type Signatures,
} from "./creatures/rare";
import type { SeaAt } from "./creatures/water";
import type { Subject } from "./director";
import { TILES, type ViewName } from "./landscape";
import type { PlantLayer } from "./plants/plants";
import type { CreaturesMessage, FaunaMessage, Message } from "./protocol";
import type { Random } from "./rng";
import type { Atlas } from "./creatures/atlas";
import { CreatureLayer } from "./creatures/layer";
import type { CreatureSeed } from "./creatures/seed";
import { passableIn, type Passable } from "./creatures/habitat";
import { CREATURE_SCALE, LOCAL_PIXELS, MID_BODY, WATER_LOOK, localBody } from "./creatures/views";
import type { CellRect, Land } from "./terrain/land";
import { seaAt } from "./terrain/sea";

/** What changed in the cast with a `creatures` message. */
export interface Casting {
  /** Newcomers, each with the slot it was given. */
  placed: { slot: number; id: number }[];
  /** Slots of the dead, now free. */
  removed: number[];
}

/** Which slot holds which animal, and what the stream has said of each. */
export class Roster {
  private readonly slots = new Map<number, number>();
  private readonly free: number[] = [];
  private next = 0;
  /** Genome and rare-gene slots by id, as they came in `born`, until the animal dies. */
  readonly genomes = new Map<number, { genome: readonly number[]; slots: number }>();
  /** By id, as of the last message: where, of which species, whether torpid. */
  readonly where = new Map<number, { x: number; y: number }>();
  readonly species = new Map<number, number>();
  readonly torpid = new Set<number>();
  /** The young by id: how far grown toward coming of age, in sixteenths (R5); the rest are grown. */
  readonly young = new Map<number, number>();

  /** The slot of animal `id`, if it lives. */
  slotOf(id: number): number | undefined {
    return this.slots.get(id);
  }

  /** The ids alive, in the order of the last message. */
  get ids(): readonly number[] {
    return [...this.where.keys()];
  }

  take(message: CreaturesMessage): Casting {
    for (const born of message.born) {
      this.genomes.set(born.id, { genome: born.genome, slots: born.slots ?? 0 });
    }
    const alive = new Set(message.ids);
    const removed: number[] = [];
    // The dead, in the order they were placed: the free slots are reused in a fixed order.
    for (const [id, slot] of this.slots) {
      if (alive.has(id)) continue;
      this.slots.delete(id);
      this.genomes.delete(id);
      this.free.push(slot);
      removed.push(slot);
    }
    this.where.clear();
    this.species.clear();
    this.torpid.clear();
    for (const id of message.torpid ?? []) this.torpid.add(id);
    this.young.clear();
    for (const [id, steps] of message.young ?? []) {
      if (id !== undefined && steps !== undefined) this.young.set(id, steps);
    }
    const placed: { slot: number; id: number }[] = [];
    message.ids.forEach((id, index) => {
      const [x, y] = message.positions[index] ?? [0, 0];
      this.where.set(id, { x, y });
      this.species.set(id, message.species?.[index] ?? 0);
      // An animal whose genome never came cannot be drawn (it should not happen).
      if (this.slots.has(id) || !this.genomes.has(id)) return;
      const slot = this.free.shift() ?? this.next++;
      this.slots.set(id, slot);
      placed.push({ slot, id });
    });
    return { placed, removed };
  }
}

/**
 * In the local view animals are drawn this much larger than R2's true-to-the-trees size
 * (the owner, 2026-10-20: at that size markings and eyes were lost).
 */
const LOCAL_ENLARGED = 1.2;
/** The body plans of the two views: larger than life in the middle view (R2). */
const BODIES = {
  middle: MID_BODY,
  local: localBody(LOCAL_PIXELS, CREATURE_SCALE * LOCAL_ENLARGED),
} as const;

/** Growth comes in sixteenths of the way to coming of age (`young` on the wire). */
const YOUNG_STEPS = 16;

/** Seconds a newborn takes to fade in where it was born. */
const BORN_S = 0.6;

export class Herd {
  private readonly roster = new Roster();
  private readonly layers: Record<"middle" | "local", CreatureLayer>;
  private phenotypeConfig: PhenotypeConfig | null = null;
  private rareConfig: RareConfig = { giant_mass_factor: 1 };
  private signatures: Signatures = new Map();
  /** The rare-gene bits whose look is glow (R4: they shine in the dark). */
  private glowBits = 0;
  /** Whether the swash covers the beach at a place now, from the scene's sea (R5, wet feet). */
  set swash(covers: ((x: number, y: number) => boolean) | null) {
    for (const layer of Object.values(this.layers)) layer.swash = covers;
  }

  /**
   * Put animal `id` at (x, y) facing `heading` and hold it there, in both views (debugging
   * the look, `CreatureLayer.pin`); false if it is not alive.
   */
  pin(id: number, x: number, y: number, heading: number): boolean {
    const slot = this.roster.slotOf(id);
    if (slot === undefined) return false;
    for (const layer of Object.values(this.layers)) layer.pin(slot, x, y, heading);
    return true;
  }

  /** Send animal `id` to (x, y), in both views (debugging the look, `CreatureLayer.send`). */
  send(id: number, x: number, y: number): boolean {
    const slot = this.roster.slotOf(id);
    if (slot === undefined) return false;
    for (const layer of Object.values(this.layers)) layer.send(slot, x, y);
    return true;
  }

  /** Species names by id, from the `species` messages. */
  readonly names = new Map<number, string>();
  /**
   * Told where each animal that dies was last, and of what if the stream says (R4: the
   * fire's dead leave a puff of ash).
   */
  onGone: ((x: number, y: number, cause: Cause | undefined) => void) | null = null;
  /** What deaths and landings leave (R5): bones, dust, bubbles, splashes. */
  readonly remains = new Remains();
  /**
   * Asked of each animal new to the scene where it is (R4): whether it arrives with the ark,
   * so comes into being over this many seconds; 0 for one simply born.
   */
  arrival: ((x: number, y: number) => number) | null = null;
  private land: Land | null = null;
  private sea: SeaAt | null = null;
  private passable: Passable | null = null;
  /** The view drawn last; null before the first frame. */
  private view: ViewName | null = null;

  /** `land` says what the scene stands on now (the latest land of the stream). */
  constructor(
    atlas: Atlas,
    random: Random,
    private readonly landOf: () => Land | null,
  ) {
    const passable: Passable = (x, y, swims) =>
      this.current() !== null && (this.passable?.(x, y, swims) ?? false);
    const sea: SeaAt = (x, y) => (this.current() === null ? null : (this.sea?.(x, y) ?? null));
    const layer = (body: (typeof BODIES)["middle"]): CreatureLayer =>
      new CreatureLayer(atlas, [], passable, random, body, "anchored", sea, WATER_LOOK);
    this.layers = { middle: layer(BODIES.middle), local: layer(BODIES.local) };
    for (const each of Object.values(this.layers)) each.show("hidden");
  }

  /** The containers to add to the world layer (in cells): the animals not among plants, and the dots. */
  get containers(): Container[] {
    return [this.layers.middle.container, this.layers.local.container, this.remains.over];
  }

  /** The latest land, and the sea read from it when it changes. */
  private current(): Land | null {
    const land = this.landOf();
    if (land !== this.land) {
      this.land = land;
      this.sea = land === null ? null : seaAt(land);
      this.passable = land === null ? null : passableIn(land);
    }
    return land;
  }

  receive(message: Message): void {
    if (message.type === "fauna") this.takeFauna(message);
    else if (message.type === "rare") {
      this.signatures = new Map(
        message.genes
          .filter((gene) => gene.kingdom === "creature")
          .map((gene) => [gene.bit, gene.signature]),
      );
      this.glowBits = 0;
      for (const [bit, signature] of this.signatures)
        if (signature === "glow") this.glowBits |= bit;
    } else if (message.type === "species") {
      for (const species of message.species) this.names.set(species.id, species.name);
    } else if (message.type === "creatures") this.takeCreatures(message);
    if (message.type === "clock" || message.type === "creatures") this.remains.now = message.t_ms;
    // A new world: nothing of the old one lies on its land.
    if (message.type === "events" && message.events.some(({ kind }) => kind === "world_began")) {
      this.remains.clear();
    }
  }

  /** Where slot `slot` is drawn in each view's layer, as it lies (`remains.ts`). */
  private laid(slot: number): Record<BodyView, Laid> {
    const of = (layer: CreatureLayer): Laid => {
      const { joints, radii } = layer.spine(slot);
      const head = joints[0] ?? { x: 0, y: 0 };
      const tail = joints[joints.length - 1] ?? head;
      let length = 0;
      for (let i = 1; i < joints.length; i++) {
        const a = joints[i - 1];
        const b = joints[i];
        if (a !== undefined && b !== undefined) length += Math.hypot(b.x - a.x, b.y - a.y);
      }
      // The body reaches past its end joints by their radii.
      length += (radii[0] ?? 0) + (radii[radii.length - 1] ?? 0);
      const centre = layer.centre(slot);
      return {
        x: centre.x,
        y: centre.y,
        heading: Math.atan2(head.y - tail.y, head.x - tail.x),
        length,
        width: 2 * Math.max(0, ...radii),
      };
    };
    return { middle: of(this.layers.middle), local: of(this.layers.local) };
  }

  private genomeOrder: readonly number[] = GENE_NAMES.map((_, index) => index);
  /** The growth step each young animal was last drawn at. */
  private readonly drawnGrowth = new Map<number, number>();
  /** Each living species' colours, ranked against the others (`colours.ts`). */
  private colours = new Map<number, SpeciesColour>();

  private rankColours(): void {
    const members: { species: number; genome: Genome }[] = [];
    for (const id of this.roster.ids) {
      const known = this.roster.genomes.get(id);
      if (known === undefined) continue;
      members.push({
        species: this.roster.species.get(id) ?? 0,
        genome: this.genomeOrder.map((index) => known.genome[index] ?? 0),
      });
    }
    this.colours = speciesColours(members);
  }

  private takeFauna(message: FaunaMessage): void {
    this.phenotypeConfig = parsePhenotypeConfig(message.phenotype_config);
    if (Object.keys(message.rare_config).length > 0) {
      this.rareConfig = parseRareConfig(message.rare_config);
    }
    // The renderer's genes in the order the stream sends them.
    this.genomeOrder = GENE_NAMES.map((name) => {
      const index = message.genes.indexOf(name);
      if (index < 0) throw new Error(`stream: no creature gene ${name}`);
      return index;
    });
  }

  /** The seed a layer draws animal `id` from, where the sim has it now. */
  private seedOf(id: number): CreatureSeed | null {
    const config = this.phenotypeConfig;
    const known = this.roster.genomes.get(id);
    const where = this.roster.where.get(id);
    if (config === null || known === undefined || where === undefined) return null;
    const genome: Genome = this.genomeOrder.map((index) => known.genome[index] ?? 0);
    const species = this.roster.species.get(id) ?? 0;
    const ranked = this.colours.get(species);
    const steps = this.roster.young.get(id);
    const look = {
      ...lookOf(genome, phenotype(config, genome)),
      ...(ranked === undefined ? {} : { colours: ownColours(ranked, genome) }),
      ...(steps === undefined ? {} : { growth: steps / YOUNG_STEPS }),
    };
    return {
      x: where.x,
      y: where.y,
      genome,
      species,
      slots: known.slots,
      torpid: this.roster.torpid.has(id),
      ...withRare(look, rareLooks(known.slots, this.signatures), this.rareConfig),
    };
  }

  private takeCreatures(message: CreaturesMessage): void {
    const causes = new Map((message.died ?? []).map(({ id, cause }) => [id, cause]));
    const alive = new Set(message.ids);
    const layers = Object.values(this.layers);
    // The dead go where they fell, as their cause says, and leave their remains (R5).
    for (const [id, at] of this.roster.where) {
      if (alive.has(id)) continue;
      const cause = causes.get(id);
      this.onGone?.(at.x, at.y, cause);
      const slot = this.roster.slotOf(id);
      if (slot === undefined) continue;
      if (cause !== undefined && this.layers.middle.has(slot)) {
        this.remains.died(cause, this.laid(slot));
      }
      for (const layer of layers) layer.remove(slot, true, DYING[cause ?? "unknown"]);
    }
    const census = new Set(this.roster.species.values());
    const { placed, removed } = this.roster.take(message);
    // Any left (it should not happen) are taken off.
    for (const slot of removed) for (const layer of layers) layer.remove(slot, true);
    // A new species, or one gone: newcomers take the kinds of the census as it is now.
    const changed =
      census.size !== new Set(this.roster.species.values()).size ||
      [...this.roster.species.values()].some((species) => !census.has(species));
    // Colours rank the species alive against each other: read again when they change.
    if (changed || this.colours.size === 0) this.rankColours();
    if (changed || placed.length > 0) {
      const seeds = this.roster.ids
        .map((id) => this.seedOf(id))
        .filter((seed): seed is CreatureSeed => seed !== null);
      if (changed) for (const layer of layers) layer.replan(seeds);
    }
    // Drawn again: everyone when the colours were ranked anew, else the young that grew a step.
    const placedIds = new Set(placed.map(({ id }) => id));
    for (const id of this.roster.ids) {
      const steps = this.roster.young.get(id);
      const grew = steps !== this.drawnGrowth.get(id);
      if (steps === undefined) this.drawnGrowth.delete(id);
      else this.drawnGrowth.set(id, steps);
      if (placedIds.has(id) || !(changed || grew)) continue;
      const slot = this.roster.slotOf(id);
      const seed = slot === undefined ? null : this.seedOf(id);
      if (slot === undefined || seed === null) continue;
      for (const layer of layers) layer.rebuild(slot, seed);
    }
    for (const id of this.drawnGrowth.keys())
      if (!this.roster.where.has(id)) this.drawnGrowth.delete(id);
    const landed = new Set(message.landed ?? []);
    for (const { slot, id } of placed) {
      const seed = this.seedOf(id);
      if (seed === null) continue;
      // An ark's newcomer comes into being under its light; one born, quickly; one landed
      // from the sea is there at once, under a splash (R5).
      const ark = this.arrival?.(seed.x, seed.y) ?? 0;
      const arriving = ark > 0 ? ark : landed.has(id) ? 0 : BORN_S;
      for (const layer of layers) {
        layer.place(slot, seed);
        if (arriving > 0) layer.arrive(slot, arriving);
      }
      if (landed.has(id)) this.remains.landed(this.laid(slot));
    }
    for (const id of this.roster.ids) {
      const slot = this.roster.slotOf(id);
      const where = this.roster.where.get(id);
      if (slot === undefined || where === undefined) continue;
      for (const layer of layers) {
        layer.anchor(slot, where.x, where.y);
        layer.setTorpid(slot, this.roster.torpid.has(id));
      }
    }
  }

  /** Each living species' name, members and colours as drawn (R5's report, tests). */
  colourTable(): { id: number; name: string; members: number; body: number; mark: number }[] {
    const members = new Map<number, number>();
    for (const species of this.roster.species.values())
      members.set(species, (members.get(species) ?? 0) + 1);
    return [...this.colours].map(([id, { colours }]) => ({
      id,
      name: this.names.get(id) ?? "",
      members: members.get(id) ?? 0,
      body: colour(colours.body.hue, colours.body.light, colours.body.saturation),
      mark: colour(colours.mark.hue, colours.mark.light, colours.mark.saturation),
    }));
  }

  /** What the name card says of animal `id` (R5, `card.ts`); null if it is not known, or not yet coloured. */
  cardOf(id: number): CardFacts | null {
    const config = this.phenotypeConfig;
    const known = this.roster.genomes.get(id);
    const species = this.roster.species.get(id) ?? 0;
    const ranked = this.colours.get(species);
    if (config === null || known === undefined || ranked === undefined) return null;
    const genome: Genome = this.genomeOrder.map((index) => known.genome[index] ?? 0);
    const body = phenotype(config, genome);
    const colours = ownColours(ranked, genome);
    const signatures = [...this.signatures]
      .sort(([a], [b]) => a - b)
      .filter(([bit]) => (known.slots & bit) !== 0)
      .map(([, signature]) => signature);
    const tint = (part: { hue: number; light: number; saturation: number }): number =>
      colour(part.hue, part.light, part.saturation);
    return {
      id,
      name: this.names.get(species) ?? "",
      genome,
      mass: body.mass * (signatures.includes("giant") ? this.rareConfig.giant_mass_factor : 1),
      limbPairs: body.limbPairs,
      signatures,
      body: tint(colours.body),
      mark: tint(colours.mark),
    };
  }

  /** The animals alive, where the view's layer draws them (the local view's, when hidden). */
  subjects(): Subject[] {
    const layer = this.view === "middle" ? this.layers.middle : this.layers.local;
    const subjects: Subject[] = [];
    for (const id of this.roster.ids) {
      const slot = this.roster.slotOf(id);
      if (slot === undefined || !layer.has(slot)) continue;
      const at = layer.centre(slot);
      subjects.push({
        id,
        species: this.roster.species.get(id) ?? 0,
        x: at.x,
        y: at.y,
        torpid: this.roster.torpid.has(id),
      });
    }
    return subjects;
  }

  /**
   * Where the animals with the glow gene shine (R4): a spot at every other joint of their
   * backs, in the view's layer (on the map, where its dots are), those in `cells` only.
   */
  glowing(cells: CellRect): Spot[] {
    if (this.view === null) return [];
    // The map's dots are the middle view's animals.
    const layer = this.view === "local" ? this.layers.local : this.layers.middle;
    const spots: Spot[] = [];
    for (const id of this.roster.ids) {
      const slot = this.roster.slotOf(id);
      const known = this.roster.genomes.get(id);
      if (slot === undefined || known === undefined || !layer.has(slot)) continue;
      if ((known.slots & this.glowBits) === 0) continue;
      if (this.view === "map") {
        // On the map, one light round its square.
        const at = layer.centre(slot);
        if (
          at.x >= cells.x0 - 1 &&
          at.x <= cells.x1 + 1 &&
          at.y >= cells.y0 - 1 &&
          at.y <= cells.y1 + 1
        ) {
          spots.push({ x: at.x, y: at.y, size: 0 });
        }
        continue;
      }
      const { joints, radii } = layer.spine(slot);
      joints.forEach((joint, i) => {
        if (i % 2 === 1 || i === joints.length - 1) return;
        if (joint.x < cells.x0 - 1 || joint.x > cells.x1 + 1) return;
        if (joint.y < cells.y0 - 1 || joint.y > cells.y1 + 1) return;
        spots.push({ x: joint.x, y: joint.y, size: radii[i] ?? 0 });
      });
    }
    return spots;
  }

  /** Species of animal `id`, 0 if none or dead. */
  speciesOf(id: number): number {
    return this.roster.species.get(id) ?? 0;
  }

  /**
   * Draw the animals for `view` with `cells` in sight, moved on by `dtS`: among the
   * plants of `plants` (the view's opaque layer), what stands in front of `subject` shown
   * through. Only the view's layer lives; the other waits, anchored, for its turn.
   */
  update(
    dtS: number,
    view: ViewName,
    cells: CellRect,
    plants: PlantLayer | null,
    subject: number | null,
  ): void {
    if (view !== this.view) {
      this.view = view;
      this.layers.middle.show(view === "middle" ? "bodies" : view === "map" ? "markers" : "hidden");
      this.layers.local.show(view === "local" ? "bodies" : "hidden");
    }
    this.remains.update(dtS, view, TILES[view]);
    const layer = view === "local" ? this.layers.local : this.layers.middle;
    // The trees and bushes of the view: its animals keep clear of them (R5).
    if (view !== "map") layer.standAmong(plants);
    layer.update(dtS, view === "map" ? undefined : cells, view !== "map");
    if (view === "map") return;
    layer.hostIn(plants?.guests ?? null, plants?.rowsPerCell, plants ?? null);
    const slot = subject === null ? undefined : this.roster.slotOf(subject);
    plants?.fade(
      slot === undefined ? null : layer.box(slot),
      slot === undefined ? 0 : layer.topOf(slot),
      dtS,
    );
  }
}
