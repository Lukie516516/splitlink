import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function sourceDigest() {
  const files = [];
  const roots = [
    "src",
    "contracts",
    "scripts",
    "test",
    "tests",
    ".github",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "hardhat.config.cjs",
    "playwright.config.ts",
    "vite.config.ts",
    "tsconfig.json",
    "index.html",
    "public/_redirects",
    "vercel.json",
    "docs/splitlink-design-v1.1.md",
  ];
  function visit(p) {
    if (!fs.existsSync(p)) return;
    if (fs.statSync(p).isDirectory()) {
      for (const name of fs.readdirSync(p).sort()) visit(path.join(p, name));
    } else files.push(p);
  }
  roots.forEach(visit);
  const records = files.sort().map((file) => ({
    file,
    sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  }));
  return {
    sha256: createHash("sha256").update(JSON.stringify(records)).digest("hex"),
    files: records,
  };
}
