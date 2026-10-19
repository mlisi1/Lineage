/**
 * Generate the protocol's TypeScript types from the server's JSON Schema.
 *
 *   npm run protocol     writes src/protocol.ts
 *
 * The schema (server/lineage_server/protocol/schema.json) is the one definition of the
 * wire format (CLAUDE.md §4.7); src/protocol.ts is never edited by hand. A test fails
 * when it is out of date.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

export const SCHEMA = new URL("../../server/lineage_server/protocol/schema.json", import.meta.url);
export const TYPES = new URL("../src/protocol.ts", import.meta.url);
const BANNER = [
  "/**",
  " * The state stream's messages, generated from server/lineage_server/protocol/schema.json",
  " * by `npm run protocol` (json-schema-to-typescript). Do not edit by hand.",
  " */",
].join("\n");

/** The contents of src/protocol.ts for the schema as it is now. */
export async function generate() {
  const schema = JSON.parse(await readFile(SCHEMA, "utf-8"));
  return compile(schema, "Message", {
    bannerComment: BANNER,
    additionalProperties: false,
    unreachableDefinitions: true,
    style: { printWidth: 100 },
  });
}

if (globalThis.process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(TYPES, await generate());
  console.log(`wrote ${fileURLToPath(TYPES)}`);
}
