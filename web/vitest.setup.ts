// Node 18 only exposes Web Crypto at node:crypto.webcrypto; Node >= 19 and
// browsers guarantee a global Web Crypto. Provide the standard global when
// running tests on Node 18 so code that expects globalThis.crypto works.
// (Same shim as apps/mcp/vitest.setup.ts — kept in sync deliberately.)
if (typeof globalThis.crypto === "undefined") {
	const { webcrypto } = await import("node:crypto");
	globalThis.crypto = webcrypto as Crypto;
}
