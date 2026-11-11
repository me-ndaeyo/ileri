import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The fast suite: unit tests only, offline, no chain and no database.
 *
 * Integration tests are excluded here and have their own config. A default run that
 * needed testnet gas and a live database would stop being run, and a test suite nobody
 * runs is worse than none.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
