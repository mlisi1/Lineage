/**
 * The plants' drawings kept between page loads (R5, the optimization plan). A plant layer's
 * sheet is drawn from every form, growth, variant, season in play and snow at its view's
 * size (`plants.ts`, `sheetOf`): 4.3 s on the board for the local view, the longest wait of
 * its first switch after every start. Kept here, as the ground's paintings are
 * (`terrain/groundcache.ts`), it is drawn once per build and palette and read back after.
 *
 * Read whole into memory when the page starts (a few sheets of a few megabytes), long
 * before the first lay-out wants one; written after a sheet is drawn. At most
 * `MOST_SHEETS` are kept, the oldest let go.
 */
import type { StandingArt } from "./plants";

export interface ArtCache {
  /** The drawings kept under `key`, if they have been read in. */
  get(key: string): readonly StandingArt[] | undefined;
  /** Keep `arts` under `key`. */
  put(key: string, arts: readonly StandingArt[]): void;
}

/** Sheets kept at most. */
export const MOST_SHEETS = 8;
const DATABASE = "lineage-plant-arts";
const VERSION = 1;
const STORE = "sheets";
/** When each sheet was kept: the oldest are let go first. */
const TIMES = "times";

/** Nothing kept: every sheet drawn. */
export const NO_ART_CACHE: ArtCache = { get: () => undefined, put: () => undefined };

class StoredArtCache implements ArtCache {
  private readonly held = new Map<string, readonly StandingArt[]>();
  private readonly database: Promise<IDBDatabase | null>;

  constructor(
    factory: IDBFactory,
    private readonly code: string,
  ) {
    this.database = new Promise((resolve) => {
      try {
        const opening = factory.open(DATABASE, VERSION);
        opening.onupgradeneeded = () => {
          opening.result.createObjectStore(STORE);
          opening.result.createObjectStore(TIMES);
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => resolve(null);
        opening.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    void this.database.then((database) => this.readAll(database));
  }

  get(key: string): readonly StandingArt[] | undefined {
    return this.held.get(this.named(key));
  }

  put(key: string, arts: readonly StandingArt[]): void {
    const name = this.named(key);
    this.held.set(name, arts);
    void this.database.then((database) => {
      if (database === null) return;
      try {
        const writing = database.transaction([STORE, TIMES], "readwrite", {
          durability: "relaxed",
        });
        writing.objectStore(STORE).put([...arts], name);
        const times = writing.objectStore(TIMES);
        times.put(Date.now(), name);
        // The oldest let go beyond `MOST_SHEETS`, and any of another build.
        const keys = times.getAllKeys();
        const ats = times.getAll();
        ats.onsuccess = () => {
          const all = keys.result.map((k, i) => [String(k), Number(ats.result[i])] as const);
          const ours = all
            .filter(([k]) => k.startsWith(`${this.code}|`))
            .sort((x, y) => y[1] - x[1]);
          const stale = all.filter(([k]) => !k.startsWith(`${this.code}|`));
          for (const [k] of [...stale, ...ours.slice(MOST_SHEETS)]) {
            times.delete(k);
            writing.objectStore(STORE).delete(k);
          }
        };
      } catch {
        // Not kept: drawn again next time.
      }
    });
  }

  /** The cache's name for `key`: the build's, so that another build's drawings are not used. */
  private named(key: string): string {
    return `${this.code}|${key}`;
  }

  private readAll(database: IDBDatabase | null): void {
    if (database === null) return;
    try {
      const reading = database.transaction(STORE, "readonly").objectStore(STORE);
      const values = reading.getAll();
      const keys = reading.getAllKeys();
      values.onsuccess = () => {
        keys.onsuccess = () => {
          keys.result.forEach((key, i) => {
            const name = String(key);
            const kept = values.result[i] as StandingArt[] | undefined;
            if (name.startsWith(`${this.code}|`) && Array.isArray(kept) && !this.held.has(name)) {
              this.held.set(name, kept);
            }
          });
        };
      };
    } catch {
      // Nothing read: drawn as needed.
    }
  }
}

/** Plants' drawings kept in the browser's storage for build `code`; none without storage. */
export function makeArtCache(code: string): ArtCache {
  return typeof indexedDB === "undefined" || code === ""
    ? NO_ART_CACHE
    : new StoredArtCache(indexedDB, code);
}

/** A short name for a palette (or anything JSON can write): its content's hash. */
export function contentKey(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36) + text.length.toString(36);
}
