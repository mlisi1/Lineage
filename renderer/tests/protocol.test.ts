import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface Generator {
  generate: () => Promise<string>;
  TYPES: URL;
}

describe("the protocol's types", () => {
  it("are what the server's schema generates (run `npm run protocol` if not)", async () => {
    const { generate, TYPES } = (await import("../scripts/protocol.mjs" as string)) as Generator;
    expect(await readFile(TYPES, "utf-8")).toBe(await generate());
  });
});
