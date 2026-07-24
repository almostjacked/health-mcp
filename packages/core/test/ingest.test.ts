import { describe, it, expect, vi, afterEach } from "vitest";
import { planWrites, synthId, executeIngest } from "../src/ingest";

const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SECRET_KEY: "sk" };

describe("planWrites", () => {
	it("routes totals and measurements to their regimes and keeps rejects with reasons", () => {
		const plan = planWrites({
			entries: [
				{ date: "2026-07-19", metric: "calories", value: 2450, unit: "kcal", source: "shortcut" },
				{ date: "2026-07-19", metric: "weight", value: 191.2, unit: "lb", timestamp: "2026-07-19T07:41:12-06:00", external_id: "ABC-123" },
				{ date: "2026-07-19", metric: "steps", value: 9000, unit: "count" },
			],
		});
		expect(plan.totals).toHaveLength(1);
		expect(plan.measurements).toHaveLength(1);
		expect(plan.measurements[0].external_id).toBe("ABC-123");
		expect(plan.rejected).toHaveLength(1);
		expect(plan.rejected[0].reason).toContain("unknown metric");
	});

	it("synthesizes a stable external_id for measurements lacking one", () => {
		const mk = () => planWrites({ entries: [{ date: "2026-07-19", metric: "weight", value: 191.2, unit: "lb" }] });
		const a = mk().measurements[0].external_id!;
		const b = mk().measurements[0].external_id!;
		expect(a).toMatch(/^synth-[0-9a-f]{16}$/);
		expect(a).toBe(b); // deterministic → INSERT OR IGNORE dedups re-runs
	});

	it("different values produce different synthetic ids", () => {
		const e1 = { date: "2026-07-19", metric: "weight", value: 191.2, unit: "lb", source: null, timestamp: null, external_id: null, cls: "measurement" as const };
		expect(synthId(e1)).not.toBe(synthId({ ...e1, value: 190 }));
	});

	it("rejects a non-{entries:[…]} body wholesale", () => {
		const plan = planWrites({ nope: true });
		expect(plan.totals).toHaveLength(0);
		expect(plan.rejected[0].reason).toContain("entries");
	});

	it("synthId is stable across timestamp renderings of the same instant", () => {
		const base = { date: "2026-07-19", metric: "weight", value: 191.2, unit: "lb", source: null, external_id: null, cls: "measurement" as const };
		const a = synthId({ ...base, timestamp: "2026-07-19T07:41:12-06:00" });
		const b = synthId({ ...base, timestamp: "2026-07-19T13:41:12Z" });
		const c = synthId({ ...base, timestamp: "2026-07-19T13:41:12+00:00" });
		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	it("collapses same-batch duplicate (date, metric) totals — last entry wins", () => {
		const plan = planWrites({
			entries: [
				{ date: "2026-07-19", metric: "calories", value: 2000, unit: "kcal" },
				{ date: "2026-07-19", metric: "calories", value: 2450, unit: "kcal" },
				{ date: "2026-07-19", metric: "protein", value: 180, unit: "g" },
			],
		});
		expect(plan.totals).toHaveLength(2);
		expect(plan.totals.find((t) => t.metric === "calories")?.value).toBe(2450);
	});
});

describe("executeIngest", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("writes totals to daily_totals with merge-duplicates on (date, metric)", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 1 }]), { status: 201 }));
		vi.stubGlobal("fetch", fetchMock);
		const plan = planWrites({
			entries: [{ date: "2026-07-19", metric: "calories", value: 2450, unit: "kcal", source: "shortcut" }],
		});
		const result = await executeIngest(env, plan);
		expect(result.updated).toBe(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://proj.supabase.co/rest/v1/daily_totals?on_conflict=date,metric");
		expect(init.headers["Prefer"]).toBe("resolution=merge-duplicates,return=representation");
	});

	it("writes measurements to measurements with ignore-duplicates on external_id", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 1 }]), { status: 201 }));
		vi.stubGlobal("fetch", fetchMock);
		const plan = planWrites({
			entries: [{ date: "2026-07-19", metric: "weight", value: 191.2, unit: "lb", external_id: "ABC-123" }],
		});
		const result = await executeIngest(env, plan);
		expect(result.inserted).toBe(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://proj.supabase.co/rest/v1/measurements?on_conflict=external_id");
		expect(init.headers["Prefer"]).toBe("resolution=ignore-duplicates,return=representation");
	});

	it("reports skipped as batch size minus rows returned", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 1 }]), { status: 201 })));
		const plan = planWrites({
			entries: [
				{ date: "2026-07-19", metric: "weight", value: 191.2, unit: "lb", external_id: "ABC-1" },
				{ date: "2026-07-19", metric: "weight", value: 191.4, unit: "lb", external_id: "ABC-2" },
			],
		});
		const result = await executeIngest(env, plan);
		expect(result.inserted).toBe(1);
		expect(result.skipped).toBe(1);
	});

	it("maps measurement columns without cls, keeping external_id", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 1 }]), { status: 201 }));
		vi.stubGlobal("fetch", fetchMock);
		const plan = planWrites({
			entries: [{ date: "2026-07-19", metric: "weight", value: 191.2, unit: "lb", timestamp: "2026-07-19T07:41:12-06:00", external_id: "ABC-123" }],
		});
		await executeIngest(env, plan);
		const [, init] = fetchMock.mock.calls[0];
		const body = JSON.parse(init.body);
		expect(body).toEqual([{
			date: "2026-07-19",
			timestamp: "2026-07-19T07:41:12-06:00",
			metric: "weight",
			value: 191.2,
			unit: "lb",
			source: null,
			external_id: "ABC-123",
		}]);
	});
});
