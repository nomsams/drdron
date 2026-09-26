import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  // Pinned to the GitHub Pages project URL: built asset URLs become
  // "/drdron/assets/…". (Deploy the contents of dist/, not the repo root —
  // the root index.html points at /src/main.tsx and only works under
  // `npm run dev`.)
  base: "/drdron/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Keep the big libs in shared chunks so the lazy 3D chunk doesn't
        // duplicate three.js (imported by both entry and 3D code).
        manualChunks: {
          three: ["three"],
          fiber: ["@react-three/fiber"],
          vendor: ["react", "react-dom", "zustand"],
        },
      },
    },
  },
});
