import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: "threads",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "next/headers": path.resolve(
        __dirname,
        "./tests/e2e/helpers/next-mock.ts"
      ),
      "next/server": path.resolve(
        __dirname,
        "./tests/e2e/helpers/next-server-mock.ts"
      ),
    },
  },
});
