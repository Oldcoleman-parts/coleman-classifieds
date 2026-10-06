import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Kept separate from vite.config.js so the React Router plugin isn't loaded in tests.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["app/**/*.test.{js,jsx}", "tests/**/*.test.js"],
    globalSetup: "tests/setup/global-setup.js",
    setupFiles: ["tests/setup/env.js"],
    // One shared test database, reset per file, so files run one at a time.
    fileParallelism: false,
  },
});
