import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      react: path.resolve(import.meta.dirname, "apps/desktop/node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "apps/desktop/node_modules/react-dom"),
      "react-router-dom": path.resolve(
        import.meta.dirname,
        "apps/desktop/node_modules/react-router-dom",
      ),
      "@": path.resolve(import.meta.dirname, "apps/desktop/src"),
      "@arrab/shared": path.resolve(import.meta.dirname, "packages/shared/src/index.ts"),
      "@arrab/core": path.resolve(import.meta.dirname, "packages/core/src/index.ts"),
      "@arrab/ai": path.resolve(import.meta.dirname, "packages/ai/src/index.ts"),
      "@arrab/agents": path.resolve(import.meta.dirname, "packages/agents/src/index.ts"),
      "@arrab/database": path.resolve(import.meta.dirname, "packages/database/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/api/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
});
