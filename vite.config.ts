import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { rmSync } from "node:fs";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "exclude-local-deployment-from-release",
      closeBundle() {
        if (process.env.VITE_ENABLE_LOCAL !== "true")
          rmSync("dist/local-manifest.json", { force: true });
      },
    },
  ],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
