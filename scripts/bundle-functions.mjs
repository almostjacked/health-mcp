import { build } from "esbuild";

for (const name of ["health-mcp", "health-ingest"]) {
	await build({
		entryPoints: [`supabase/functions/${name}/index.ts`],
		bundle: true,
		format: "esm",
		platform: "neutral",
		mainFields: ["module", "main"],
		conditions: ["deno", "import", "node"],
		// Deno supports node:* built-ins natively; leave them unbundled rather than
		// making esbuild (running with platform: "neutral") try to polyfill them.
		external: ["node:*"],
		outfile: `dist/functions/${name}.ts`,
		banner: {
			js: `// ${name} — single-file bundle for Supabase Edge Functions.\n// Paste into the dashboard editor or deploy with the setup wizard.`,
		},
	});
	console.log(`bundled dist/functions/${name}.ts`);
}
