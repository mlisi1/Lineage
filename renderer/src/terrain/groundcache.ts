/**
 * The painted ground kept between visits (R5, the owner: "save the world once generated and
 * pre-compute all we can"). Painting a piece of ground takes the board most of a second,
 * and the painted ground changes only a little from one sim-day to the next, so every
 * piece painted is kept in the browser's storage (IndexedDB), the latest for each place.
 *
 * Each entry carries a stamp: everything the painting was made from (the world, the land
 * message, the day of the year, the look, the painter's own code). A piece whose stamp is
 * today's is shown as it is, unpainted; one with an older stamp is shown at once while
 * today's is painted, and today's fades in over it, as each new day does.
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
  /** The piece kept under `key`, whatever its stamp; undefined if none. */
  get(key: string): Promise<Kept | undefined>;
  /** Keep `pixels` under `key` for `stamp`, in place of what was there. */
  put(key: string, stamp: string, pixels: Pixels): void;
}

const DATABASE = "lineage-ground";
const STORE = "pieces";

/** A cache that keeps nothing. */
export const NO_CACHE: GroundCache = {
  get: () => Promise.resolve(undefined),
  put: () => undefined,
};

/** A cache in memory: for tests. */
export class MemoryCache implements GroundCache {
  readonly kept = new Map<string, Kept>();

  get(key: string): Promise<Kept | undefined> {
    return Promise.resolve(this.kept.get(key));
  }

  put(key: string, stamp: string, pixels: Pixels): void {
    this.kept.set(key, { stamp, pixels: copyOf(pixels) });
  }
}

/** The pieces in IndexedDB. */
class StoredCache implements GroundCache {
  private readonly database: Promise<IDBDatabase | null>;

  constructor(factory: IDBFactory) {
    this.database = new Promise((resolve) => {
      try {
        const opening = factory.open(DATABASE, 1);
        opening.onupgradeneeded = () => {
          if (!opening.result.objectStoreNames.contains(STORE)) {
            opening.result.createObjectStore(STORE);
          }
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => resolve(null);
        opening.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async get(key: string): Promise<Kept | undefined> {
    const database = await this.database;
    if (database === null) return undefined;
    return new Promise((resolve) => {
      try {
        const reading = database.transaction(STORE, "readonly").objectStore(STORE).get(key);
        reading.onsuccess = () => resolve(isKept(reading.result) ? reading.result : undefined);
        reading.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  put(key: string, stamp: string, pixels: Pixels): void {
    // The pixels are copied now (structured clone), before a texture or a transfer takes them.
    const entry: Kept = { stamp, pixels: copyOf(pixels) };
    void this.database.then((database) => {
      if (database === null) return;
      try {
        database.transaction(STORE, "readwrite").objectStore(STORE).put(entry, key);
      } catch {
        // Full, or gone: the piece is painted again next time.
      }
    });
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

function isKept(value: unknown): value is Kept {
  if (typeof value !== "object" || value === null) return false;
  const kept = value as Partial<Kept>;
  return typeof kept.stamp === "string" && kept.pixels?.rgba instanceof Uint8ClampedArray;
}

/** The browser's storage where there is some, else nothing. */
export function makeGroundCache(): GroundCache {
  return typeof indexedDB === "undefined" ? NO_CACHE : new StoredCache(indexedDB);
}
