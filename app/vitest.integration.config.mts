import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration tests: these touch testnet and spend gas, so they are opt-in.
 *
 *   pnpm test:integration
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    // One wallet round trip plus several transactions.
    testTimeout: 180_000,
    // Transactions against one contract must not interleave.
    fileParallelism: false,
  },
});
