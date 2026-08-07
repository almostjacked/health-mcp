import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Map-backed sessionStorage shim — the vitest environment for this project is
// "node" (see vitest.config.ts), which has no Storage global at all. A real
// jsdom Storage would work too, but this is simpler than pulling in a whole
// DOM environment for one file, and it doubles as a spy: `store` lets tests
// inspect exactly what got persisted, which is the whole point of this suite.
class MapStorage implements Storage {
	private store = new Map<string, string>();

	get length(): number {
		return this.store.size;
	}
	clear(): void {
		this.store.clear();
	}
	getItem(key: string): string | null {
		return this.store.has(key) ? this.store.get(key)! : null;
	}
	key(index: number): string | null {
		return [...this.store.keys()][index] ?? null;
	}
	removeItem(key: string): void {
		this.store.delete(key);
	}
	setItem(key: string, value: string): void {
		this.store.set(key, value);
	}
	/** Test-only escape hatch onto the raw backing map. */
	raw(): Map<string, string> {
		return this.store;
	}
}

let storage: MapStorage;

beforeEach(async () => {
	storage = new MapStorage();
	vi.stubGlobal("sessionStorage", storage);
	// Each test gets a fresh module instance so the in-memory access token
	// (module-scoped state) never leaks between tests.
	vi.resetModules();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function loadState() {
	return import("../src/state.js");
}

describe("state", () => {
	it("getConfig returns {} before anything is set", async () => {
		const { getConfig } = await loadState();
		expect(getConfig()).toEqual({});
	});

	it("setConfig persists and merges into sessionStorage under health-mcp-setup, roundtripping through getConfig", async () => {
		const { setConfig, getConfig } = await loadState();

		setConfig({ ref: "abcxyz" });
		expect(getConfig()).toEqual({ ref: "abcxyz" });

		setConfig({ connectorUrl: "https://abcxyz.supabase.co/functions/v1/health-mcp/tok" });
		expect(getConfig()).toEqual({
			ref: "abcxyz",
			connectorUrl: "https://abcxyz.supabase.co/functions/v1/health-mcp/tok",
		});

		const raw = storage.getItem("health-mcp-setup");
		expect(raw).not.toBeNull();
		expect(JSON.parse(raw!)).toEqual({
			ref: "abcxyz",
			connectorUrl: "https://abcxyz.supabase.co/functions/v1/health-mcp/tok",
		});
	});

	it("setConfig ignores undefined fields in the partial (does not clobber existing values)", async () => {
		const { setConfig, getConfig } = await loadState();
		setConfig({ ref: "r1", ingestUrl: "https://r1.supabase.co/functions/v1/health-ingest" });
		setConfig({ ref: undefined, mcpToken: "tok1" });
		expect(getConfig()).toEqual({
			ref: "r1",
			ingestUrl: "https://r1.supabase.co/functions/v1/health-ingest",
			mcpToken: "tok1",
		});
	});

	it("forgetAll removes the storage key entirely and clears the in-memory access token", async () => {
		const { setConfig, getConfig, forgetAll, setAccessToken, getAccessToken } = await loadState();
		setConfig({ ref: "r1" });
		setAccessToken("sbp_super_secret_pat");

		forgetAll();

		expect(getConfig()).toEqual({});
		expect(storage.getItem("health-mcp-setup")).toBeNull();
		expect(getAccessToken()).toBeUndefined();
	});

	it("the access token is module-scoped memory only: setAccessToken never touches sessionStorage", async () => {
		const { setConfig, setAccessToken, getAccessToken } = await loadState();
		const secret = "sbp_super_secret_pat_0123456789";

		setAccessToken(secret);
		expect(getAccessToken()).toBe(secret);
		// storage untouched by setAccessToken alone
		expect(storage.raw().size).toBe(0);

		// Writing unrelated config afterwards still must not leak the token —
		// asserted two ways: the JSON has no "token"-shaped key, and the raw
		// persisted string never contains the secret value anywhere in it.
		setConfig({ ref: "r1", mcpToken: "unrelated-minted-secret" });
		const raw = storage.getItem("health-mcp-setup")!;
		const parsed = JSON.parse(raw) as Record<string, unknown>;

		expect(Object.keys(parsed).some((k) => k.toLowerCase().includes("access"))).toBe(false);
		expect(raw).not.toContain(secret);
	});

	it("setConfig is a true no-op (no sessionStorage write) when the merge wouldn't change anything", async () => {
		// Regression test: a CONFIG_CHANGED_EVENT listener that reacts to a
		// config change by calling setConfig again with the same values (a
		// legitimate pattern — see web/src/panels/shortcut.ts's credentialFields)
		// is a synchronous infinite loop unless idempotent writes skip
		// notifyChange entirely. This can't exercise the event round-trip itself
		// (this suite's vitest environment has no `window` — see ../vitest.config.ts
		// — so notifyChange's dispatchEvent is a no-op here regardless), but it
		// locks in the half of the fix that IS testable without a DOM: identical
		// input must never re-write storage.
		const { setConfig } = await loadState();
		const setItemSpy = vi.spyOn(storage, "setItem");

		setConfig({ ref: "r1", ingestUrl: "https://r1.supabase.co/functions/v1/health-ingest" });
		expect(setItemSpy).toHaveBeenCalledTimes(1);

		setConfig({ ref: "r1", ingestUrl: "https://r1.supabase.co/functions/v1/health-ingest" });
		expect(setItemSpy).toHaveBeenCalledTimes(1); // still 1 — the second call changed nothing

		setConfig({ ref: "r2" });
		expect(setItemSpy).toHaveBeenCalledTimes(2); // an actual change does write
	});

	it("setConfig passed an access-token-shaped key (not part of SetupConfig) is dropped, not persisted", async () => {
		const { setConfig, getConfig } = await loadState();
		// @ts-expect-error deliberately passing a key outside SetupConfig's shape
		setConfig({ ref: "r1", accessToken: "sbp_should_not_persist" });
		const raw = storage.getItem("health-mcp-setup")!;
		expect(raw).not.toContain("sbp_should_not_persist");
		expect(getConfig()).toEqual({ ref: "r1" });
	});
});
