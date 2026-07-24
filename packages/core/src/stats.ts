import { REGISTRY } from "./registry.js";
import { lit } from "./supabase.js";

export type Rollup = "daily" | "weekly" | "monthly";

export function statsQueries(metric: string, start: string, end: string, rollup: Rollup) {
	const spec = REGISTRY[metric];
	if (!spec) throw new Error(`unknown metric "${metric}" — valid: ${Object.keys(REGISTRY).join(", ")}`);
	const table = spec.cls === "total" ? "daily_totals" : "measurements";
	const period =
		rollup === "weekly" ? `to_char(date, 'IYYY-"W"IW')` :
		rollup === "monthly" ? `to_char(date, 'YYYY-MM')` : "date::text";
	const where = `WHERE metric = ${lit(metric)} AND date BETWEEN ${lit(start)} AND ${lit(end)}`;
	return {
		overall: {
			sql: `SELECT COUNT(*) AS n, ROUND(MIN(value)::numeric, 2) AS min, ROUND(MAX(value)::numeric, 2) AS max, ROUND(AVG(value)::numeric, 2) AS avg
			      FROM ${table} ${where}`,
		},
		series: {
			sql: `WITH d AS (SELECT ${period} AS period, AVG(value) AS v FROM ${table}
			      ${where} GROUP BY 1)
			      SELECT period, ROUND(v::numeric, 2) AS value,
			             ROUND(AVG(v) OVER (ORDER BY period ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)::numeric, 2) AS rolling_7
			      FROM d ORDER BY period`,
		},
	};
}
