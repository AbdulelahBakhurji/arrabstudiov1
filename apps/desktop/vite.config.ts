import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@arrab/shared": path.resolve(import.meta.dirname, "../../packages/shared/src/index.ts"),
    },
  },
  clearScreen: false,
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        "agent-presence": path.resolve(import.meta.dirname, "agent-presence.html"),
        "companion-panel": path.resolve(import.meta.dirname, "companion-panel.html"),
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
