import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { rmSync } from "node:fs";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "exclude-local-fixture",
      closeBundle() {
        if (process.env.VITE_ENABLE_LOCAL !== "true")
          rmSync("dist/local-manifest.json", { force: true });
      },
    },
  ],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  server: { host: "127.0.0.1", port: 5274 },
  preview: { host: "127.0.0.1", port: 4274 },
});
