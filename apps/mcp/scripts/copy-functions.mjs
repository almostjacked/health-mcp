// Copies the repo-root bundled edge functions (produced by the root
// `pnpm bundle:functions`, which esbuild-bundles supabase/functions/*/index.ts
// into single dependency-free files) into this package's dist/, so the setup
// wizard can resolve+deploy them from wherever the npm package is installed.
import { readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const srcDir = fileURLToPath(new URL("../../../dist/functions", import.meta.url));
const destDir = fileURLToPath(new URL("../dist/functions", import.meta.url));

if (!existsSync(srcDir)) {
  console.error(
    `copy-functions: ${srcDir} not found — run \`pnpm bundle:functions\` at the repo root first.`,
  );
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
for (const file of files) {
  copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}
console.log(`copy-functions: copied ${files.length} bundle(s) -> ${path.relative(process.cwd(), destDir)}`);
