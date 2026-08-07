// Shared page state for the three onboarding panels (provision/import/shortcut).
//
// Split deliberately into two very different lifetimes:
//   - `SetupConfig` (project ref, minted app secrets, derived URLs) is safe to
//     survive a reload within the same tab, so Import/Shortcut can pre-fill
//     from whatever Provision just produced — persisted to `sessionStorage`.
//   - The Supabase *personal access token* (full account API access, used only
//     to talk to api.supabase.com while provisioning) is never written to
//     `sessionStorage` or any other durable store: it lives solely in this
//     module's closure and is gone the moment the tab reloads or `forgetAll()`
//     runs. Nothing in `SetupConfig`'s shape has a slot for it, so there is no
//     field to accidentally serialize in the first place.
const STORAGE_KEY = "health-mcp-setup";

export interface SetupConfig {
	ref?: string;
	mcpToken?: string;
	ingestKey?: string;
	connectorUrl?: string;
	ingestUrl?: string;
}

const CONFIG_KEYS = ["ref", "mcpToken", "ingestKey", "connectorUrl", "ingestUrl"] as const;

/** Fired on `window` after every `setConfig`/`forgetAll` so panels other than
 * the one that made the change (e.g. Import, once Provision finishes) can
 * refresh their pre-filled-but-editable fields without a page reload. No-op
 * outside a browser (there is no `window` in the unit-test/Node environment). */
export const CONFIG_CHANGED_EVENT = "health-mcp:config-changed";

function notifyChange(): void {
	if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
		window.dispatchEvent(new Event(CONFIG_CHANGED_EVENT));
	}
}

// Module-scoped only — see file banner. Never read from or written to storage.
let accessToken: string | undefined;

export function setAccessToken(token: string): void {
	accessToken = token;
}

export function getAccessToken(): string | undefined {
	return accessToken;
}

export function clearAccessToken(): void {
	accessToken = undefined;
}

function readStorage(): SetupConfig {
	const raw = sessionStorage.getItem(STORAGE_KEY);
	if (!raw) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null) return {};
	const out: SetupConfig = {};
	for (const key of CONFIG_KEYS) {
		const value = (parsed as Record<string, unknown>)[key];
		if (typeof value === "string") out[key] = value;
	}
	return out;
}

/** Current persisted config (never includes the access token). */
export function getConfig(): SetupConfig {
	return readStorage();
}

/** Merges `partial` into the persisted config and returns the merged result.
 * Only the known `SetupConfig` keys are ever written — passing anything else
 * (e.g. by mistake) is silently dropped by `readStorage`'s allowlist on the
 * next read, but we also filter here so the stored JSON itself stays clean.
 *
 * Skips the write and `notifyChange()` entirely when the merge wouldn't
 * actually change anything. This isn't just an optimization: a
 * CONFIG_CHANGED_EVENT listener that reacts by calling setConfig again with
 * the same values it just received (a legitimate pattern — e.g. a panel
 * persisting the current field values whenever they might have drifted) is a
 * synchronous infinite loop if every call unconditionally re-notifies, since
 * each notify re-invokes every listener including that one. Idempotent
 * writes must be true no-ops for CONFIG_CHANGED_EVENT to be safe to react to
 * by calling setConfig. */
export function setConfig(partial: Partial<SetupConfig>): SetupConfig {
	const current = readStorage();
	const next = { ...current };
	for (const key of CONFIG_KEYS) {
		const value = partial[key];
		if (value !== undefined) next[key] = value;
	}
	const changed = CONFIG_KEYS.some((key) => current[key] !== next[key]);
	if (!changed) return next;
	sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	notifyChange();
	return next;
}

/** Clears both the persisted config and the in-memory access token — wired to
 * the Provision panel's "Forget" button. */
export function forgetAll(): void {
	sessionStorage.removeItem(STORAGE_KEY);
	clearAccessToken();
	notifyChange();
}
