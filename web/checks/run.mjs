import { createRequire } from "node:module";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const require=createRequire(import.meta.url);
const {build}=require(createRequire(require.resolve("vite/package.json")).resolve("esbuild"));
const dir=await mkdtemp(join(tmpdir(),"splitlink-public-check-"));
try {
 const live=process.argv.includes("--public-readonly"), timing=process.argv.includes("--preview-timing");
 const env=Object.fromEntries((await readFile(".env.production","utf8")).trim().split(/\r?\n/).map(line=>line.split("=")));
 await build({entryPoints:timing?["checks/preview-timing.ts"]:live?["checks/public-readonly.ts"]:["checks/focused.test.ts","checks/mainnet.test.ts"],outdir:dir,bundle:true,platform:"node",format:"esm",packages:"external",define:{"import.meta.env":JSON.stringify(env)},outExtension:{".js":".mjs"}});
 // External packages resolve from the candidate; no shared dependency modifications.
 const {symlink}=await import("node:fs/promises");
 await symlink(require.resolve("vite/package.json").split("/node_modules/.pnpm/")[0]+"/node_modules",join(dir,"node_modules"));
 const args=timing?[join(dir,"preview-timing.mjs")]:live?[join(dir,"public-readonly.mjs")]:["--test",join(dir,"focused.test.mjs"),join(dir,"mainnet.test.mjs")];
 const r=spawnSync(process.execPath,args,{stdio:"inherit"});
 if(r.status!==0)process.exitCode=r.status??1;
}finally{await rm(dir,{recursive:true,force:true});}
