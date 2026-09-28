import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${process.env.PORT ?? 8787}` },
  },
});
