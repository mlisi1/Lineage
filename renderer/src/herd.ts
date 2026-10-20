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
import { lookOf } from "./creatures/body";
import { GENE_NAMES, type Genome } from "./creatures/genome";
import { parsePhenotypeConfig, phenotype, type PhenotypeConfig } from "./creatures/phenotype";
import {
  parseRareConfig,
  rareLooks,
  withRare,
  type RareConfig,
  type Signatures,
} from "./creatures/rare";
import type { SeaAt } from "./creatures/water";
import type { Subject } from "./director";
import type { ViewName } from "./landscape";
import type { PlantLayer } from "./plants/plants";
import type { CreaturesMessage, FaunaMessage, Message } from "./protocol";
import type { Random } from "./rng";
import type { Atlas } from "./spike/atlas";
import { CreatureLayer } from "./spike/creatures";
import type { CreatureSeed } from "./spike/fixture";
import { passableIn, type Passable } from "./spike/habitat";
import { MID_BODY, WATER_LOOK, localBody, LOCAL_PIXELS } from "./spike/proposal";
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

/** The body plans of the two views: larger than life in the middle view (R2). */
const BODIES = {
  middle: MID_BODY,
  local: localBody(LOCAL_PIXELS),
} as const;

export class Herd {
  private readonly roster = new Roster();
  private readonly layers: Record<"middle" | "local", CreatureLayer>;
  private phenotypeConfig: PhenotypeConfig | null = null;
  private rareConfig: RareConfig = { giant_mass_factor: 1 };
  private signatures: Signatures = new Map();
  /** Species names by id, from the `species` messages. */
  readonly names = new Map<number, string>();
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
    return [this.layers.middle.container, this.layers.local.container];
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
    } else if (message.type === "species") {
      for (const species of message.species) this.names.set(species.id, species.name);
    } else if (message.type === "creatures") this.takeCreatures(message);
  }

  private genomeOrder: readonly number[] = GENE_NAMES.map((_, index) => index);

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
    const look = lookOf(genome, phenotype(config, genome));
    return {
      x: where.x,
      y: where.y,
      genome,
      species: this.roster.species.get(id) ?? 0,
      slots: known.slots,
      torpid: this.roster.torpid.has(id),
      ...withRare(look, rareLooks(known.slots, this.signatures), this.rareConfig),
    };
  }

  private takeCreatures(message: CreaturesMessage): void {
    const census = new Set(this.roster.species.values());
    const { placed, removed } = this.roster.take(message);
    const layers = Object.values(this.layers);
    for (const slot of removed) for (const layer of layers) layer.remove(slot);
    // A new species, or one gone: newcomers take the kinds of the census as it is now.
    const changed =
      census.size !== new Set(this.roster.species.values()).size ||
      [...this.roster.species.values()].some((species) => !census.has(species));
    if (changed || placed.length > 0) {
      const seeds = this.roster.ids
        .map((id) => this.seedOf(id))
        .filter((seed): seed is CreatureSeed => seed !== null);
      if (changed) for (const layer of layers) layer.replan(seeds);
    }
    for (const { slot, id } of placed) {
      const seed = this.seedOf(id);
      if (seed === null) continue;
      for (const layer of layers) layer.place(slot, seed);
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
    const layer = view === "local" ? this.layers.local : this.layers.middle;
    layer.update(dtS, view === "map" ? undefined : cells, view !== "map");
    if (view === "map") return;
    layer.hostIn(plants?.guests ?? null, plants?.rowsPerCell);
    const slot = subject === null ? undefined : this.roster.slotOf(subject);
    plants?.fade(slot === undefined ? null : layer.box(slot));
  }
}
