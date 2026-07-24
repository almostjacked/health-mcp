import { describe, it, expect, vi, afterEach } from "vitest";
import { runSql, lit } from "../src/supabase";

const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SECRET_KEY: "sk" };

afterEach(() => vi.unstubAllGlobals());

describe("lit", () => {
	it("quotes strings and doubles embedded quotes", () => {
		expect(lit("weight")).toBe("'weight'");
		expect(lit("o'brien")).toBe("'o''brien'");
	});
	it("passes finite numbers through, rejects non-finite", () => {
		expect(lit(42)).toBe("42");
		expect(lit(2.5)).toBe("2.5");
		expect(() => lit(Infinity)).toThrow();
		expect(() => lit(NaN)).toThrow();
	});
});

describe("writeRows", () => {
	it("POSTs batches with conflict params and sums returned rows", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), { status: 201 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { writeRows } = await import("../src/supabase");
		const n = await writeRows(env, "measurements", "external_id", "ignore-duplicates", [{ a: 1 }, { a: 2 }, { a: 3 }]);
		expect(n).toBe(2); // server reported 2 written (1 duplicate ignored)
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://proj.supabase.co/rest/v1/measurements?on_conflict=external_id");
		expect(init.headers["Prefer"]).toBe("resolution=ignore-duplicates,return=representation");
		expect(JSON.parse(init.body).length).toBe(3);
	});
	it("throws with body text on non-2xx", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 409 })));
		const { writeRows } = await import("../src/supabase");
		await expect(writeRows(env, "daily_totals", "date,metric", "merge-duplicates", [{ a: 1 }])).rejects.toThrow(/409/);
	});
});

describe("runSql", () => {
	it("POSTs to the rpc endpoint with auth headers and returns rows", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify([{ n: 1 }]), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const rows = await runSql(env, "SELECT 1 AS n");
		expect(rows).toEqual([{ n: 1 }]);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://proj.supabase.co/rest/v1/rpc/run_readonly");
		expect(init.method).toBe("POST");
		expect(init.headers["apikey"]).toBe("sk");
		expect(init.headers["Authorization"]).toBe("Bearer sk");
		expect(JSON.parse(init.body)).toEqual({ q: "SELECT 1 AS n" });
	});
	it("returns [] for a null jsonb result", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("null", { status: 200 })));
		expect(await runSql(env, "SELECT 1")).toEqual([]);
	});
	it("throws with the response body on non-200", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ message: "syntax error at or near X" }), { status: 400 }),
		));
		await expect(runSql(env, "SELEC 1")).rejects.toThrow(/syntax error/);
	});
});
