import { describe, it, expect, vi, afterEach } from "vitest";
import { buildMcpApp } from "../../../supabase/functions/_shared/mcp-app.js";
import { buildIngestApp } from "../../../supabase/functions/_shared/ingest-app.js";

const env = { SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "srk", MCP_TOKEN: "tok123", INGEST_KEY: "ing456" };
afterEach(() => vi.unstubAllGlobals());
const initBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } });

describe("health-mcp edge function", () => {
	it("404s wrong token, 200s initialize on right token path", async () => {
		const app = buildMcpApp(env);
		expect((await app.request("/health-mcp/wrong", { method: "POST", body: initBody, headers: { "content-type": "application/json", accept: "application/json, text/event-stream" } })).status).toBe(404);
		const ok = await app.request("/health-mcp/tok123", { method: "POST", body: initBody, headers: { "content-type": "application/json", accept: "application/json, text/event-stream" } });
		expect(ok.status).toBe(200);
		expect(await ok.text()).toContain("health-mcp");
	});
	it("405s GET/DELETE on the token path", async () => {
		const app = buildMcpApp(env);
		for (const method of ["GET", "DELETE"]) {
			const res = await app.request("/health-mcp/tok123", { method });
			expect(res.status).toBe(405);
			expect(res.headers.get("allow")).toBe("POST");
		}
	});
});

describe("health-ingest edge function", () => {
	it("401s without key; writes normalized entries with key", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 1 }]), { status: 201 }));
		vi.stubGlobal("fetch", fetchMock);
		const app = buildIngestApp(env);
		expect((await app.request("/health-ingest", { method: "POST", body: "{}" })).status).toBe(401);
		const res = await app.request("/health-ingest", {
			method: "POST",
			headers: { "X-Api-Key": "ing456", "content-type": "application/json" },
			body: JSON.stringify({ entries: [{ date: "2026-07-24", metric: "weight", value: "180.4", unit: "lb" }] }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.inserted).toBe(1);
		const url = String(fetchMock.mock.calls[0][0]);
		expect(url).toContain("/rest/v1/measurements?on_conflict=external_id");
	});
});
