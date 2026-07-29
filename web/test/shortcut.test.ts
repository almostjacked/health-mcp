import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildShortcut, buildWorkflow, serializePlist } from "../src/shortcut/plist.js";

const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/golden.shortcut", import.meta.url));
const DUMMY_URL = "https://example.test/functions/v1/health-ingest";
const DUMMY_KEY = "k123";

/** The golden fixture was produced by running the real
 * scripts/generate_shortcut.py with `uuid.uuid4` monkeypatched to this exact
 * counter-based sequence (deterministic uuid.UUID(int=n), str()'d and
 * upper()'d — see .superpowers/sdd/c3-task-5-report.md for the generator
 * script) so the run is reproducible. Matching that sequence here is what
 * makes buildWorkflow's output byte-identical to the fixture — production
 * `buildShortcut` uses real `crypto.randomUUID()` instead. */
function deterministicUuidGen(): () => string {
	let n = 0;
	return () => {
		n += 1;
		const hex = n.toString(16).padStart(32, "0");
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toUpperCase();
	};
}

describe("plist golden test (vs. scripts/generate_shortcut.py)", () => {
	it("buildWorkflow + serializePlist reproduces the python generator's bytes exactly", () => {
		const golden = readFileSync(FIXTURE_PATH);
		const workflow = buildWorkflow(DUMMY_URL, DUMMY_KEY, deterministicUuidGen());
		const actual = serializePlist(workflow);

		expect(Buffer.from(actual).equals(golden)).toBe(true);
	});

	it("golden fixture contains only the dummy endpoint/key, never a real one", () => {
		const text = readFileSync(FIXTURE_PATH, "utf8");
		expect(text).toContain(DUMMY_URL);
		expect(text).toContain(DUMMY_KEY);
		expect(text).not.toContain("supabase.co");
	});
});

describe("buildShortcut (real entry point)", () => {
	it("bakes in the given URL and key, and is a well-formed, parseable XML plist", () => {
		const bytes = buildShortcut(DUMMY_URL, DUMMY_KEY);
		const text = new TextDecoder().decode(bytes);

		expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(text).toContain(DUMMY_URL);
		expect(text).toContain(DUMMY_KEY);
		expect(text).toContain("<key>WFWorkflowName</key>");
		expect(text).toContain("<string>Sync Health Data</string>");
	});

	it("uses a fresh random UUID sequence on every call (never matches a fixed golden run)", () => {
		const a = new TextDecoder().decode(buildShortcut(DUMMY_URL, DUMMY_KEY));
		const b = new TextDecoder().decode(buildShortcut(DUMMY_URL, DUMMY_KEY));
		expect(a).not.toBe(b);
	});
});
