import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "test-results", "playwright-report"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    // Node scripts, some of whose callbacks run in a browser page.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", URL: "readonly", window: "readonly" } },
  },
);
