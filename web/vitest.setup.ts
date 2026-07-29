// Node 18 only exposes Web Crypto at node:crypto.webcrypto; Node >= 19 and
// browsers guarantee a global Web Crypto. Provide the standard global when
// running tests on Node 18 so code that expects globalThis.crypto works.
// (Same shim as apps/mcp/vitest.setup.ts — kept in sync deliberately.)
if (typeof globalThis.crypto === "undefined") {
	const { webcrypto } = await import("node:crypto");
	globalThis.crypto = webcrypto as Crypto;
}

// Node 18's global fetch (undici) has FormData but not File — it landed as a
// Node global in v20. Provider (provision/api.ts) constructs `new File(...)`
// for the function-deploy multipart body, so pull it in from node:buffer
// (stable there since Node 18.13) when the browser-standard global is missing.
if (typeof globalThis.File === "undefined") {
	const { File } = await import("node:buffer");
	globalThis.File = File as unknown as typeof globalThis.File;
}
