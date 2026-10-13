import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";


export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // src/**/*.test.ts are node:test files (npm run test:node).
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      // Server-side modules are imported directly in tests; the marker
      // package's default export throws outside a react-server bundle.
      "server-only": new URL("./node_modules/server-only/empty.js", import.meta.url).pathname,
    },
  },
});
