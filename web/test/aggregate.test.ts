import { describe, it, expect } from "vitest";
import { Aggregator } from "../src/import/aggregate.js";
import type { RawRecord } from "../src/import/records.js";

const weight = (v: string, start: string): RawRecord => ({
	type: "HKQuantityTypeIdentifierBodyMass", unit: "lb", value: v,
	startDate: start, creationDate: start,
});
const cal = (v: string, start: string, creation = start): RawRecord => ({
	type: "HKQuantityTypeIdentifierDietaryEnergyConsumed", unit: "Cal", value: v,
	startDate: start, creationDate: creation,
});

function runAll(records: RawRecord[]) {
	const a = new Aggregator();
	for (const r of records) a.add(r);
	return a.finish();
}

describe("Aggregator (backfill.py parity)", () => {
	it("measurements keep per-sample entries with local date + ISO timestamp", () => {
		const { entries } = runAll([weight("205.4", "2026-07-19 07:41:12 -0600")]);
		expect(entries).toEqual([{
			date: "2026-07-19", metric: "weight", value: 205.4, unit: "lb",
			timestamp: "2026-07-19T07:41:12-06:00", source: "backfill-web",
		}]);
	});
	it("body_fat fractions become percent", () => {
		const { entries } = runAll([{ type: "HKQuantityTypeIdentifierBodyFatPercentage", unit: "%", value: "0.213", startDate: "2026-07-19 07:41:12 -0600", creationDate: "x" }]);
		expect(entries[0].value).toBeCloseTo(21.3, 6);
	});
	it("LOSE IT CLONE-DEDUP: exact duplicate totals collapse via ceil(count/2)", () => {
		// 2 identical clones -> counted once; 3 identical -> counted twice; a
		// distinct sample -> counted once. Mirrors backfill.py lines 96-104.
		const recs = [
			cal("500", "2026-07-19 08:00:00 -0600"), cal("500", "2026-07-19 08:00:00 -0600"),
			cal("300", "2026-07-19 12:00:00 -0600"), cal("300", "2026-07-19 12:00:00 -0600"), cal("300", "2026-07-19 12:00:00 -0600"),
			cal("100", "2026-07-19 18:00:00 -0600"),
		];
		const { entries } = runAll(recs);
		const total = entries.find((e) => e.metric === "calories")!;
		expect(total.value).toBe(500 * 1 + 300 * 2 + 100 * 1); // 1200
		expect(total.unit).toBe("kcal");
		expect(total.source).toBe("backfill-web");
		expect(total.timestamp).toBeUndefined();
	});
	it("unit conversion + unhandled units skipped with note", () => {
		const { entries, skippedUnits } = runAll([
			{ type: "HKQuantityTypeIdentifierDietaryEnergyConsumed", unit: "kJ", value: "418.4", startDate: "2026-07-19 08:00:00 -0600", creationDate: "c" },
			{ type: "HKQuantityTypeIdentifierDietaryEnergyConsumed", unit: "furlongs", value: "1", startDate: "2026-07-19 09:00:00 -0600", creationDate: "c2" },
		]);
		expect(entries.find((e) => e.metric === "calories")!.value).toBeCloseTo(100, 3);
		expect(skippedUnits).toContain("calories/furlongs");
	});
	it("bad records counted, not thrown", () => {
		const { entries, badRecords } = runAll([{ type: "HKQuantityTypeIdentifierBodyMass", unit: "lb", value: "not-a-number", startDate: "2026-07-19 07:41:12 -0600", creationDate: "c" }]);
		expect(entries).toEqual([]);
		expect(badRecords).toBe(1);
	});
	it("totals round to 6 decimals and sort by (date, metric)", () => {
		const { entries } = runAll([
			cal("100.1234567", "2026-07-20 08:00:00 -0600"),
			cal("50", "2026-07-19 08:00:00 -0600"),
		]);
		const totals = entries.filter((e) => e.metric === "calories");
		expect(totals.map((t) => t.date)).toEqual(["2026-07-19", "2026-07-20"]);
		expect(totals[1].value).toBe(100.123457);
	});
});
