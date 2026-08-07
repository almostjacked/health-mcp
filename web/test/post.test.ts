import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { postEntries } from "../src/import/post.js";
import type { IngestEntry } from "../src/import/aggregate.js";

function entry(i: number): IngestEntry {
	return { date: "2026-07-19", metric: "calories", value: i, unit: "kcal", source: "backfill-web" };
}

describe("postEntries", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("batches in groups of 500, sends X-Api-Key, and aggregates result counts", async () => {
		const entries = Array.from({ length: 1200 }, (_, i) => entry(i));
		fetchMock.mockImplementation(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ inserted: 10, updated: 2, skipped: 1, rejected: [] }),
		}));
		const progress: Array<[number, number, number]> = [];
		const totals = await postEntries(entries, "https://example.com/functions/v1/health-ingest", "test-key", (sent, total, written) => {
			progress.push([sent, total, written]);
		});

		expect(fetchMock).toHaveBeenCalledTimes(3);
		for (const call of fetchMock.mock.calls) {
			const [url, init] = call as [string, RequestInit];
			expect(url).toBe("https://example.com/functions/v1/health-ingest");
			expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key");
			const body = JSON.parse(init.body as string);
			expect(body.entries.length).toBeLessThanOrEqual(500);
		}
		expect(totals).toEqual({ inserted: 30, updated: 6, skipped: 3, rejected: 0 });
		expect(progress).toHaveLength(3);
		expect(progress[2]).toEqual([1200, 1200, 1200]);
	});

	it("counts rejected entries", async () => {
		fetchMock.mockImplementation(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ inserted: 0, updated: 0, skipped: 0, rejected: [{ reason: "bad" }, { reason: "bad2" }] }),
		}));
		const totals = await postEntries([entry(1)], "https://example.com", "k", () => {});
		expect(totals.rejected).toBe(2);
	});

	it("throws with batch context on a non-2xx response", async () => {
		fetchMock.mockImplementation(async () => ({
			ok: false,
			status: 500,
			text: async () => "internal error blah blah",
		}));
		await expect(postEntries(Array.from({ length: 501 }, (_, i) => entry(i)), "https://example.com", "k", () => {}))
			.rejects.toThrow(/batch 1/i);
	});

	it("posts to the URL exactly as given (modulo trailing slash) — no path appending", async () => {
		fetchMock.mockImplementation(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ inserted: 0, updated: 0, skipped: 0, rejected: [] }),
		}));
		await postEntries([entry(1)], "https://p.supabase.co/functions/v1/health-ingest/", "k", () => {});
		const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://p.supabase.co/functions/v1/health-ingest");
	});
});
