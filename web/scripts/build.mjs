// Builds the onboarding page: bundles src/main.ts, copies src/index.html +
// src/styles.css, and copies the repo-root bundled edge functions (produced
// by `pnpm bundle:functions`) into dist/functions/ so the in-browser
// provisioner can fetch them same-origin.
import { build } from "esbuild";
import { readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(root, "dist");
const functionsSrcDir = fileURLToPath(new URL("../../dist/functions", import.meta.url));
const functionsDestDir = path.join(distDir, "functions");

if (!existsSync(functionsSrcDir)) {
  console.error(
    `build: ${functionsSrcDir} not found — run \`pnpm bundle:functions\` first.`,
  );
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/main.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  minify: true,
  outfile: path.join(distDir, "main.js"),
});
console.log("build: bundled dist/main.js");

copyFileSync(path.join(root, "src/index.html"), path.join(distDir, "index.html"));
copyFileSync(path.join(root, "src/styles.css"), path.join(distDir, "styles.css"));
console.log("build: copied index.html + styles.css -> dist/");

mkdirSync(functionsDestDir, { recursive: true });
const files = readdirSync(functionsSrcDir).filter((f) => f.endsWith(".ts"));
if (files.length === 0) {
  console.error(
    `build: no bundles found in ${functionsSrcDir} — run \`pnpm bundle:functions\` first.`,
  );
  process.exit(1);
}
for (const file of files) {
  copyFileSync(path.join(functionsSrcDir, file), path.join(functionsDestDir, file));
}
console.log(`build: copied ${files.length} function bundle(s) -> dist/functions/`);
