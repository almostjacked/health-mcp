import { describe, it, expect } from "vitest";
import { statsQueries } from "../src/stats";

describe("statsQueries (postgres)", () => {
	it("daily rollup builds literal SQL with escaped metric", () => {
		const q = statsQueries("weight", "2026-01-01", "2026-03-01", "daily");
		expect(q.overall.sql).toContain("FROM measurements WHERE metric = 'weight' AND date BETWEEN '2026-01-01' AND '2026-03-01'");
		expect(q.overall.sql).toContain("ROUND(MIN(value)::numeric, 2)");
		expect(q.series.sql).toContain("date::text AS period");
		expect(q.series.sql).toContain("ROWS BETWEEN 6 PRECEDING AND CURRENT ROW");
	});
	it("weekly uses ISO week labels, monthly uses YYYY-MM", () => {
		expect(statsQueries("weight", "2026-01-01", "2026-03-01", "weekly").series.sql)
			.toContain(`to_char(date, 'IYYY-"W"IW')`);
		expect(statsQueries("calories", "2026-01-01", "2026-03-01", "monthly").series.sql)
			.toContain("to_char(date, 'YYYY-MM')");
	});
	it("totals-class metrics hit daily_totals", () => {
		expect(statsQueries("calories", "2026-01-01", "2026-01-31", "daily").overall.sql).toContain("FROM daily_totals");
	});
	it("rejects unknown metrics", () => {
		expect(() => statsQueries("nope", "2026-01-01", "2026-01-31", "daily")).toThrow(/unknown metric/);
	});
});
