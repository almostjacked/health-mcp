#!/usr/bin/env node
// Builds the canonical "Sync Health Data" shortcut — no per-user URL/key
// baked in, just placeholders + WFWorkflowImportQuestions (see
// web/src/shortcut/plist.ts's buildCanonicalShortcut). This is the file
// that gets signed ONCE per release (`shortcuts sign -m anyone`, macOS
// only — see .github/workflows/sign-shortcut.yml and docs/RESIGNING.md)
// and shipped as web/assets/sync-health-data-signed.shortcut; every user
// downloads the same signed bytes and iOS prompts them for their own
// URL/key on import instead of needing their own signed copy.
//
// web/src/shortcut/plist.ts is browser-flavored TS (uses
// crypto.randomUUID()/TextEncoder, both present as Node globals) — esbuild
// it to a temp ESM module here rather than duplicating the action-graph
// logic in a second language/runtime.
//
// Usage: node scripts/build-canonical-shortcut.mjs
// (wired up as `pnpm build:shortcut` at the repo root)
import { build } from "esbuild";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const buildDir = path.join(root, "build");
const tmpModule = path.join(buildDir, "_plist.mjs");
const outFile = path.join(buildDir, "sync-health-data.shortcut");

mkdirSync(buildDir, { recursive: true });

await build({
	entryPoints: [path.join(root, "web/src/shortcut/plist.ts")],
	bundle: true,
	format: "esm",
	platform: "node",
	outfile: tmpModule,
});

try {
	const { buildCanonicalShortcut } = await import(pathToFileURL(tmpModule).href);
	const bytes = buildCanonicalShortcut();
	writeFileSync(outFile, Buffer.from(bytes));
	console.log(`wrote ${outFile} (${bytes.length} bytes) — unsigned, needs \`shortcuts sign -m anyone\` before iOS will import it`);
} finally {
	rmSync(tmpModule, { force: true });
}
