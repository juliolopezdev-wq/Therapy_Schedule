import { execSync } from "child_process";
import { mkdirSync, writeFileSync, cpSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));

// 1. Build frontend
execSync("npx vite build", { stdio: "inherit" });

// 2. Bundle Express server (all deps inlined; @libsql/client/http is pure JS)
const funcDir = path.join(root, ".vercel/output/functions/api/[...path].func");
mkdirSync(funcDir, { recursive: true });

execSync(
  [
    "npx esbuild server/_core/app.ts",
    "--bundle",
    "--platform=node",
    "--target=node20",
    "--format=esm",
    "--packages=external",
    `--alias:@shared=${path.join(root, "shared")}`,
    `--outfile=${path.join(funcDir, "index.js")}`,
  ].join(" "),
  { stdio: "inherit" }
);

// 3. Function runtime config
writeFileSync(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify({
    runtime: "nodejs20.x",
    handler: "index.js",
    launcherType: "Nodejs",
    shouldAddHelpers: false,
  })
);

// 4. Static files
const staticDir = path.join(root, ".vercel/output/static");
mkdirSync(staticDir, { recursive: true });
cpSync(path.join(root, "dist/public"), staticDir, { recursive: true });

// 5. Routing config
writeFileSync(
  path.join(root, ".vercel/output/config.json"),
  JSON.stringify({
    version: 3,
    routes: [
      { handle: "filesystem" },
      { src: "/api/(.*)", dest: "/api/[...path]" },
      { src: "/(.*)", dest: "/index.html" },
    ],
  })
);

console.log("✓ Build complete");
