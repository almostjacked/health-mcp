// Builds the onboarding page: bundles src/main.ts, copies src/index.html +
// src/styles.css, copies the repo-root bundled edge functions (produced by
// `pnpm bundle:functions`) into dist/functions/, and copies
// packages/core/setup.sql to dist/setup.sql — all three fetched same-origin
// by the in-browser provisioner at provision time (src/panels/provision.ts).
import { build } from "esbuild";
import { readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = path.join(root, "dist");
const functionsSrcDir = fileURLToPath(new URL("../../dist/functions", import.meta.url));
const functionsDestDir = path.join(distDir, "functions");
const setupSqlSrc = fileURLToPath(new URL("../../packages/core/setup.sql", import.meta.url));
const assetsDir = path.join(root, "assets");

if (!existsSync(functionsSrcDir)) {
  console.error(
    `build: ${functionsSrcDir} not found — run \`pnpm bundle:functions\` first.`,
  );
  process.exit(1);
}

if (!existsSync(setupSqlSrc)) {
  console.error(`build: ${setupSqlSrc} not found.`);
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

copyFileSync(setupSqlSrc, path.join(distDir, "setup.sql"));
console.log("build: copied setup.sql -> dist/");

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

// The signed canonical shortcut (produced by `pnpm build:shortcut` + macOS
// `shortcuts sign -m anyone`, see .github/workflows/sign-shortcut.yml and
// docs/RESIGNING.md) is committed to web/assets/ when signing succeeds. Copy
// it into dist/ same-origin for the Shortcut panel's download button — but
// tolerate its absence: if CI signing isn't working yet (or a maintainer
// hasn't resigned after a shortcut change), the site should still build and
// the panel falls back to its manual/advanced instructions.
if (existsSync(assetsDir)) {
  const assetFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".shortcut"));
  for (const file of assetFiles) {
    copyFileSync(path.join(assetsDir, file), path.join(distDir, file));
  }
  console.log(`build: copied ${assetFiles.length} shortcut asset(s) -> dist/`);
} else {
  console.log("build: web/assets/ not found — no signed shortcut to copy (panel will show the fallback instructions)");
}
