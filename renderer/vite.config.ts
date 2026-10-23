import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { BuildEnvironmentOptions } from "vite";
import { defineConfig } from "vitest/config";

/** The commit the pages are built from, so benchmark results say what they measured. */
function buildCommit(): string {
  const git = (command: string): string =>
    execSync(`git ${command}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  try {
    // Uncommitted changes under renderer/ (the working directory of the build).
    const dirty = git("status --porcelain -- .") !== "";
    return git("rev-parse --short=12 HEAD") + (dirty ? "-dirty" : "");
  } catch {
    return "unknown";
  }
}

const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

/**
 * The desk's build (`npm run build:kiosk`, `vite build --mode kiosk`): the scene alone,
 * into `dist-kiosk/`, with its demo paths compiled out (`src/main.ts`, `KIOSK`); the
 * committed recordings come along in `stream/` for its benchmark (`?bench`).
 */
const KIOSK_MODE = "kiosk";

/** Every page: the scene and the sheets and spike the reports and tests use. */
const BUILD: BuildEnvironmentOptions = {
  rolldownOptions: {
    // index.html is the scene (R1+); spike.html is the R0 benchmark; look.html shows
    // how the spike draws everything; land.html the ground and plants in each look (R1);
    // creatures.html how animals are drawn (R2).
    input: {
      index: page("index.html"),
      spike: page("spike.html"),
      look: page("look.html"),
      creatures: page("creatures.html"),
      land: page("land.html"),
    },
  },
};
/** The desk's: the scene alone. */
const KIOSK_BUILD: BuildEnvironmentOptions = {
  outDir: "dist-kiosk",
  rolldownOptions: { input: { index: page("index.html") } },
};

export default defineConfig(({ mode }) => ({
  define: { __BUILD_COMMIT__: JSON.stringify(buildCommit()) },
  build: mode === KIOSK_MODE ? KIOSK_BUILD : BUILD,
  server: {
    // The creature sheet reads the sim's reference phenotypes.
    fs: { allow: [".", "../sim/tests/fixtures"] },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
}));
