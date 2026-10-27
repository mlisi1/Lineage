/**
 * The painted ground kept between visits (R5, the owner: "save the world once generated and
 * pre-compute all we can"). Painting a piece of ground takes the board most of a second,
 * and the painted ground changes only a little from one sim-day to the next, so every
 * piece painted is kept in the browser's storage (IndexedDB).
 *
 * Each painting is kept under a stamp: everything it was painted from (the world, the land
 * message, the day of the year, the look, the painter's own code). Several stamps are
 * kept for each piece, the land as it was on several days or before and after an event
 * (the showcase goes from autumn to winter to a meteor's crater and back every loop): a
 * piece kept for today's stamp is shown as it is, unpainted; with none, the latest kept
 * of any stamp is shown at once while today's is painted over it. Beyond `MOST_STAMPS`
 * the stamp used longest ago is let go, with all its pieces.
 *
 * Nothing waits on the storage: an entry not read in time is painted, one not written is
 * painted again next time. Where there is no storage (tests, a private window) it keeps
 * nothing.
 */
import type { Pixels } from "./pixels";

/** A piece as kept: the stamp it was painted for, and its pixels. */
export interface Kept {
  stamp: string;
  pixels: Pixels;
}

export interface GroundCache {
  /** The piece kept under `key` for `stamp`; undefined if none. */
  get(key: string, stamp: string): Promise<Pixels | undefined>;
  /** The piece kept under `key` most lately, whatever its stamp; undefined if none. */
  latest(key: string): Promise<Kept | undefined>;
  /** Keep `pixels` under `key` for `stamp`. */
  put(key: string, stamp: string, pixels: Pixels): void;
}

/** Stamps kept, each with the pieces painted for it: some days, and the showcase's states. */
export const MOST_STAMPS = 12;

const DATABASE = "lineage-ground";
const VERSION = 2;
/** Pieces by stamp and key; the latest stamp kept for each key; when each stamp was used. */
const PIECES = "pieces";
const LATEST = "latest";
const STAMPS = "stamps";
/** Between a stamp and a key in a piece's name: no stamp has it. */
const JOIN = "\u0000";

const pieceName = (stamp: string, key: string): string => `${stamp}${JOIN}${key}`;

/** A cache that keeps nothing. */
export const NO_CACHE: GroundCache = {
  get: () => Promise.resolve(undefined),
  latest: () => Promise.resolve(undefined),
  put: () => undefined,
};

/** A cache in memory, as the stored one keeps: for tests. */
export class MemoryCache implements GroundCache {
  /** The pieces, by stamp and key. */
  readonly kept = new Map<string, Kept>();
  private readonly latestOf = new Map<string, string>();
  private readonly used = new Map<string, number>();
  private clock = 0;

  get(key: string, stamp: string): Promise<Pixels | undefined> {
    const kept = this.kept.get(pieceName(stamp, key));
    if (kept !== undefined) this.used.set(stamp, ++this.clock);
    return Promise.resolve(kept?.pixels);
  }

  latest(key: string): Promise<Kept | undefined> {
    const stamp = this.latestOf.get(key);
    return Promise.resolve(stamp === undefined ? undefined : this.kept.get(pieceName(stamp, key)));
  }

  put(key: string, stamp: string, pixels: Pixels): void {
    this.kept.set(pieceName(stamp, key), { stamp, pixels: copyOf(pixels) });
    this.latestOf.set(key, stamp);
    this.used.set(stamp, ++this.clock);
    while (this.used.size > MOST_STAMPS) {
      const oldest = [...this.used].sort((a, b) => a[1] - b[1])[0]?.[0];
      if (oldest === undefined) break;
      this.used.delete(oldest);
      for (const name of [...this.kept.keys()]) {
        if (name.startsWith(oldest + JOIN)) this.kept.delete(name);
      }
    }
  }

  /** The stamps kept (tests). */
  get stamps(): string[] {
    return [...this.used.keys()];
  }
}

/** The pieces in IndexedDB. */
class StoredCache implements GroundCache {
  private readonly database: Promise<IDBDatabase | null>;

  constructor(factory: IDBFactory) {
    this.database = new Promise((resolve) => {
      try {
        const opening = factory.open(DATABASE, VERSION);
        opening.onupgradeneeded = () => {
          const db = opening.result;
          // A store from before several stamps were kept is let go.
          for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
          db.createObjectStore(PIECES);
          db.createObjectStore(LATEST);
          db.createObjectStore(STAMPS);
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => resolve(null);
        opening.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async get(key: string, stamp: string): Promise<Pixels | undefined> {
    const pixels = await this.read<Pixels>(PIECES, pieceName(stamp, key));
    if (isPixels(pixels)) {
      this.touch(stamp);
      return pixels;
    }
    return undefined;
  }

  async latest(key: string): Promise<Kept | undefined> {
    const stamp = await this.read<string>(LATEST, key);
    if (typeof stamp !== "string") return undefined;
    const pixels = await this.read<Pixels>(PIECES, pieceName(stamp, key));
    return isPixels(pixels) ? { stamp, pixels } : undefined;
  }

  put(key: string, stamp: string, pixels: Pixels): void {
    // The pixels are copied now (structured clone), before a texture or a transfer takes them.
    const copy = copyOf(pixels);
    void this.database.then((database) => {
      if (database === null) return;
      try {
        const writing = database.transaction([PIECES, LATEST, STAMPS], "readwrite");
        writing.objectStore(PIECES).put(copy, pieceName(stamp, key));
        writing.objectStore(LATEST).put(stamp, key);
        writing.objectStore(STAMPS).put(Date.now(), stamp);
        writing.oncomplete = () => this.evict(database);
      } catch {
        // Full, or gone: the piece is painted again next time.
      }
    });
  }

  private async read<T>(store: string, key: string): Promise<T | undefined> {
    const database = await this.database;
    if (database === null) return undefined;
    return new Promise((resolve) => {
      try {
        const reading = database.transaction(store, "readonly").objectStore(store).get(key);
        reading.onsuccess = () => resolve(reading.result as T | undefined);
        reading.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  /** Mark `stamp` used now, so that it is let go after the others. */
  private touch(stamp: string): void {
    void this.database.then((database) => {
      try {
        database?.transaction(STAMPS, "readwrite").objectStore(STAMPS).put(Date.now(), stamp);
      } catch {
        // Not marked: it may be let go a little sooner.
      }
    });
  }

  /** Let go of the stamps used longest ago beyond `MOST_STAMPS`, with their pieces. */
  private evict(database: IDBDatabase): void {
    try {
      const transaction = database.transaction([PIECES, STAMPS], "readwrite");
      const stamps = transaction.objectStore(STAMPS);
      const listing = stamps.openCursor();
      const all: [string, number][] = [];
      listing.onsuccess = () => {
        const cursor = listing.result;
        if (cursor !== null) {
          all.push([String(cursor.key), Number(cursor.value)]);
          cursor.continue();
          return;
        }
        if (all.length <= MOST_STAMPS) return;
        all.sort((a, b) => a[1] - b[1]);
        for (const [stamp] of all.slice(0, all.length - MOST_STAMPS)) {
          stamps.delete(stamp);
          transaction
            .objectStore(PIECES)
            .delete(IDBKeyRange.bound(stamp + JOIN, stamp + JOIN + "￿"));
        }
      };
    } catch {
      // Not let go now: next time.
    }
  }
}

function copyOf(pixels: Pixels): Pixels {
  return {
    width: pixels.width,
    height: pixels.height,
    rgba: pixels.rgba.slice(),
    ...(pixels.shore === undefined ? {} : { shore: pixels.shore.slice() }),
  };
}

function isPixels(value: unknown): value is Pixels {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<Pixels>).rgba instanceof Uint8ClampedArray
  );
}

/** The browser's storage where there is some, else nothing. */
export function makeGroundCache(): GroundCache {
  return typeof indexedDB === "undefined" ? NO_CACHE : new StoredCache(indexedDB);
}
