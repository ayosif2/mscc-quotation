import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";

// The app version shown in the UI comes from package.json (bumped by release.ps1).
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Only the real entry page — never the snapshots kept under versions/.
  optimizeDeps: { entries: ["index.html"] },
  server: {
    watch: { ignored: ["**/versions/**"] },
    // During development (npm run dev), proxy API calls to the backend
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
