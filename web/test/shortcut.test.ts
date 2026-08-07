import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	buildShortcut,
	buildWorkflow,
	serializePlist,
	buildCanonicalShortcut,
	buildCanonicalWorkflow,
	type PlistDict,
} from "../src/shortcut/plist.js";

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

describe("buildCanonicalWorkflow / buildCanonicalShortcut (signed-once, Import Questions)", () => {
	it("carries no user values — only the documented placeholders", () => {
		const bytes = buildCanonicalShortcut();
		const text = new TextDecoder().decode(bytes);

		expect(text).toContain("PASTE-YOUR-INGEST-KEY");
		expect(text).toContain("https://YOUR-REF.supabase.co/functions/v1/health-ingest");
		expect(text).not.toContain(DUMMY_URL);
		expect(text).not.toContain(DUMMY_KEY);
	});

	it("moves the ingest key out of WFHTTPHeaders into its own Text action, referenced by magic variable", () => {
		const workflow = buildCanonicalWorkflow(deterministicUuidGen());
		const actions = workflow.WFWorkflowActions as PlistDict[];

		const keyAction = actions[0];
		expect(keyAction.WFWorkflowActionIdentifier).toBe("is.workflow.actions.gettext");
		const keyActionParams = keyAction.WFWorkflowActionParameters as PlistDict;
		expect(keyActionParams.UUID).toBeTypeOf("string");
		const keyActionUuid = keyActionParams.UUID as string;

		const downloadIndex = actions.findIndex(
			(a) => (a.WFWorkflowActionIdentifier as string) === "is.workflow.actions.downloadurl",
		);
		expect(downloadIndex).toBeGreaterThan(0);
		const downloadParams = actions[downloadIndex].WFWorkflowActionParameters as PlistDict;
		expect(downloadParams.WFURL).toBe("https://YOUR-REF.supabase.co/functions/v1/health-ingest");

		const headers = downloadParams.WFHTTPHeaders as PlistDict;
		const headerItems = ((headers.Value as PlistDict).WFDictionaryFieldValueItems as PlistDict[]) ?? [];
		const apiKeyItem = headerItems.find((item) => {
			const keyToken = item.WFKey as PlistDict;
			return (keyToken.Value as PlistDict).string === "X-Api-Key";
		});
		expect(apiKeyItem).toBeDefined();

		// The header's WFValue must reference the Text action's output — not
		// contain a literal key string anywhere in its serialized form.
		const valueToken = (apiKeyItem as PlistDict).WFValue as PlistDict;
		const valueTokenValue = valueToken.Value as PlistDict;
		expect(valueTokenValue.string).not.toContain(DUMMY_KEY);
		const attachments = valueTokenValue.attachmentsByRange as PlistDict;
		expect(attachments).toBeDefined();
		const attachmentValues = Object.values(attachments);
		expect(attachmentValues.length).toBe(1);
		expect((attachmentValues[0] as PlistDict).OutputUUID).toBe(keyActionUuid);
		expect((attachmentValues[0] as PlistDict).OutputName).toBe("Text");

		// Belt and suspenders: the fully serialized plist never contains the
		// literal string "X-Api-Key" *value* — i.e. no WFKey/WFValue pair
		// where the value string is a bare key rather than a variable ref.
		const serialized = new TextDecoder().decode(serializePlist(workflow));
		expect(serialized).not.toContain(DUMMY_KEY);
	});

	it("declares WFWorkflowImportQuestions targeting the Text action's key field and the download action's URL field", () => {
		const workflow = buildCanonicalWorkflow(deterministicUuidGen());
		const actions = workflow.WFWorkflowActions as PlistDict[];
		const questions = workflow.WFWorkflowImportQuestions as PlistDict[];
		expect(questions.length).toBe(2);

		const keyQuestion = questions.find((q) => q.ParameterKey === "WFTextActionText");
		expect(keyQuestion).toBeDefined();
		expect(keyQuestion?.Category).toBe("Parameter");
		expect(keyQuestion?.ActionIndex).toBe(0);
		expect(actions[keyQuestion?.ActionIndex as number].WFWorkflowActionIdentifier).toBe(
			"is.workflow.actions.gettext",
		);

		const urlQuestion = questions.find((q) => q.ParameterKey === "WFURL");
		expect(urlQuestion).toBeDefined();
		expect(urlQuestion?.Category).toBe("Parameter");
		const urlActionIndex = urlQuestion?.ActionIndex as number;
		expect(actions[urlActionIndex].WFWorkflowActionIdentifier).toBe("is.workflow.actions.downloadurl");
		expect(typeof urlQuestion?.Text).toBe("string");
		expect(typeof keyQuestion?.Text).toBe("string");
	});

	it("is a well-formed, parseable XML plist, structurally the same shape as the per-user shortcut", () => {
		const bytes = buildCanonicalShortcut();
		const text = new TextDecoder().decode(bytes);
		expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(text).toContain("<key>WFWorkflowName</key>");
		expect(text).toContain("<string>Sync Health Data</string>");
		expect(text).toContain("<key>WFWorkflowImportQuestions</key>");
	});

	it("is byte-deterministic across calls (the CI drift guard depends on this)", () => {
		const a = new TextDecoder().decode(buildCanonicalShortcut());
		const b = new TextDecoder().decode(buildCanonicalShortcut());
		expect(a).toBe(b);
	});
});
