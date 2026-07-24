// Node 18's worker_threads (vitest's default test pool) don't inherit the
// main thread's globalThis.crypto — a Node quirk fixed in later versions,
// but our CI matrix still tests Node 18. The MCP SDK's web-standard
// streamable-http transport calls crypto.randomUUID() directly (it assumes
// a Deno/browser/modern-Node global), so we polyfill it here for tests only;
// production (Deno) always has a native global crypto.
import { webcrypto } from "node:crypto";

if (typeof globalThis.crypto === "undefined") {
	Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}
