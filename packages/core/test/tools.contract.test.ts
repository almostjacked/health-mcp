import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, type Exec } from "../src/index.js";

const TOOLS = [
	"get_schema", "get_sync_status", "get_recent", "get_daily_summary",
	"get_stats", "query", "get_energy_inputs",
];

function fakeExec(rows: Record<string, unknown>[]): Exec {
	return async () => rows;
}

async function connect(exec: Exec): Promise<Client> {
	const server = new McpServer({ name: "health-mcp-test", version: "0.0.0" });
	registerTools(server, exec);
	const [ct, st] = InMemoryTransport.createLinkedPair();
	await server.connect(st);
	const client = new Client({ name: "t", version: "0" });
	await client.connect(ct);
	return client;
}

describe("core tools contract", () => {
	it("registers exactly the 7 data tools with read-only annotations", async () => {
		const { tools } = await (await connect(fakeExec([]))).listTools();
		expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
		for (const t of tools) {
			expect(t.annotations?.readOnlyHint).toBe(true);
			expect(t.annotations?.destructiveHint).toBe(false);
		}
		expect(tools.some((t) => t.name === "get_energy_model")).toBe(false);
	});

	it("get_energy_inputs returns entries shaped for fitness-tools adaptive-tdee", async () => {
		const client = await connect(fakeExec([
			{ date: "2026-07-01", avg_lb: 180.2, kcal: 2500 },
			{ date: "2026-07-02", avg_lb: 180.0, kcal: 2450 },
		]));
		const res = await client.callTool({ name: "get_energy_inputs", arguments: {} });
		const out = JSON.parse((res.content as { text: string }[])[0].text);
		expect(out.entries).toEqual([
			{ date: "2026-07-01", weight: { value: 180.2, unit: "lb" }, kcal: 2500 },
			{ date: "2026-07-02", weight: { value: 180, unit: "lb" }, kcal: 2450 },
		]);
		// The REAL contract: parses against fitness-tools' adaptive-tdee input schema.
		const { REGISTRY } = await import("@almostjacked/fitness-tools");
		const at = REGISTRY.get("adaptive-tdee")!;
		// adaptive-tdee requires >= 10 entries; pad by repetition for schema validation
		const entries = Array.from({ length: 10 }, (_, i) => ({
			...out.entries[i % 2], date: `2026-07-${String(i + 1).padStart(2, "0")}`,
		}));
		expect(() => at.input.parse({ entries })).not.toThrow();
	});
});
