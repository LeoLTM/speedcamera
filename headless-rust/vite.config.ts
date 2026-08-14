import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "frontend",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./frontend/src"),
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/image": "http://127.0.0.1:3000",
      "/skinned-image": "http://127.0.0.1:3000",
      "/api": "http://127.0.0.1:3000",
      "/ws": {
        target: "ws://127.0.0.1:3000",
        ws: true,
      },
    },
  },
});
