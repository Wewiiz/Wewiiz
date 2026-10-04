import { defineConfig } from "vite";

// base "./" so the built dist/ folder works from any sub-path (GitHub Pages, itch.io, a plain folder on a web host).
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 1000 },
  test: { environment: "node" },
});
