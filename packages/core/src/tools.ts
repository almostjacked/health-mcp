import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { REGISTRY } from "./registry.js";
import { guardSql } from "./sql-guard.js";
import { statsQueries } from "./stats.js";
import { lit } from "./supabase.js";

export type Exec = (sql: string) => Promise<Record<string, unknown>[]>;

const SCHEMA_TEXT = `-- keep in sync with supabase/setup.sql
CREATE TABLE daily_totals (date DATE NOT NULL, metric TEXT NOT NULL, value DOUBLE PRECISION NOT NULL, unit TEXT NOT NULL,
  source TEXT, updated_at TIMESTAMPTZ, PRIMARY KEY (date, metric));
CREATE TABLE measurements (id BIGINT PRIMARY KEY, date DATE NOT NULL, timestamp TIMESTAMPTZ, metric TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL, unit TEXT NOT NULL, source TEXT, external_id TEXT UNIQUE, created_at TIMESTAMPTZ);`;

function ok(data: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function err(message: string) {
	return { content: [{ type: "text" as const, text: message }], isError: true };
}
async function run(fn: () => Promise<unknown>) {
	try {
		return ok(await fn());
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
}

export function registerTools(server: McpServer, exec: Exec, opts: { schemaNote?: string } = {}): void {
	server.registerTool(
		"get_schema",
		{
			title: "Get schema",
			description: "The Postgres schema (two tables) and the metric registry (names, units, classes). Call before writing SQL for the query tool.",
			inputSchema: {},
			annotations: { title: "Get schema", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		async () => run(async () => ({ schema: SCHEMA_TEXT, metrics: REGISTRY })),
	);

	server.registerTool(
		"get_sync_status",
		{
			title: "Get sync status",
			description:
				"Latest date, row count, and days-since-last-entry per metric. Use to detect a stalled daily sync before trusting an analysis. " +
				"days_since is measured against the UTC calendar date, so a healthy daily sync typically reads 1–2 (never 0 in the evening US time); treat 3+ as a stalled sync.",
			inputSchema: {},
			annotations: { title: "Get sync status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		async () =>
			run(async () => {
				const rows = await exec(
					`SELECT metric, MAX(date)::text AS latest, COUNT(*)::int AS row_count FROM daily_totals GROUP BY metric
					 UNION ALL
					 SELECT metric, MAX(date)::text AS latest, COUNT(*)::int AS row_count FROM measurements GROUP BY metric
			 ORDER BY metric`);
				const now = Date.parse(new Date().toISOString().slice(0, 10));
				return (rows as { metric: string; latest: string; row_count: number }[]).map((r) => ({
					...r,
					days_since: Math.round((now - Date.parse(r.latest)) / 86_400_000),
				}));
			}),
	);

	server.registerTool(
		"get_recent",
		{
			title: "Get recent rows",
			description: "Rows for the last N days (default 30), optionally one metric. Daily totals and individual measurements in one date-sorted list.",
			inputSchema: {
				metric: z.string().optional().describe("One of the registry metrics; omit for all."),
				days: z.number().int().min(1).max(3650).optional(),
			},
			annotations: { title: "Get recent rows", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		async ({ metric, days }) =>
			run(async () => {
				if (metric && !REGISTRY[metric]) throw new Error(`unknown metric "${metric}" — valid: ${Object.keys(REGISTRY).join(", ")}`);
				const cutoff = new Date(Date.now() - (days ?? 30) * 86_400_000).toISOString().slice(0, 10);
				const filt = metric ? ` AND metric = ${lit(metric)}` : "";
				const t = await exec(`SELECT date::text AS date, metric, value, unit, NULL::text AS timestamp FROM daily_totals WHERE date >= ${lit(cutoff)}${filt}`);
				const m = await exec(`SELECT date::text AS date, metric, value, unit, to_char(timestamp at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS timestamp FROM measurements WHERE date >= ${lit(cutoff)}${filt}`);
				const rows = [...t, ...m].sort((a, b) =>
					String((a as { date: string }).date).localeCompare(String((b as { date: string }).date)),
				);
				return { since: cutoff, rows };
			}),
	);

	server.registerTool(
		"get_daily_summary",
		{
			title: "Get daily summary",
			description: "All metrics for one day (default: the most recent day with any data): totals plus every weigh-in/measurement.",
			inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
			annotations: { title: "Get daily summary", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		async ({ date }) =>
			run(async () => {
				const target = date ?? ((await exec(
					`SELECT MAX(d)::text AS d FROM (SELECT MAX(date) AS d FROM daily_totals UNION ALL SELECT MAX(date) AS d FROM measurements) x`))[0]?.d as string | undefined);
				if (!target) return { message: "no data ingested yet" };
				const totals = await exec(`SELECT metric, value, unit FROM daily_totals WHERE date = ${lit(target)}`);
				const meas = await exec(`SELECT metric, value, unit, to_char(timestamp at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS timestamp FROM measurements WHERE date = ${lit(target)} ORDER BY timestamp`);
				return {
					date: target,
					totals: Object.fromEntries((totals as { metric: string; value: number; unit: string }[]).map((r) => [r.metric, { value: r.value, unit: r.unit }])),
					measurements: meas,
				};
			}),
	);

	server.registerTool(
		"get_stats",
		{
			title: "Get stats",
			description: "Min/max/avg plus a rolling-average series for one metric over a date range. rollup: daily (7-day rolling), weekly, monthly (rolling window = 7 periods). Measurements average multiple samples per day first.",
			inputSchema: {
				metric: z.string(),
				start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				rollup: z.enum(["daily", "weekly", "monthly"]).optional(),
			},
			annotations: { title: "Get stats", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		async ({ metric, start, end, rollup }) =>
			run(async () => {
				const q = statsQueries(metric, start, end, rollup ?? "daily");
				const overall = (await exec(q.overall.sql))[0];
				const series = await exec(q.series.sql);
				return { metric, start, end, rollup: rollup ?? "daily", overall, series };
			}),
	);

	server.registerTool(
		"query",
		{
			title: "Run read-only SQL",
			description:
				"Escape hatch: run one read-only SQL statement (SELECT or WITH…SELECT) against the schema from get_schema. " +
				"Writes/DDL/PRAGMA are rejected; LIMIT 500 enforced when absent. Use for anything the other tools can't answer.",
			inputSchema: { sql: z.string().describe("A single SELECT/WITH statement.") },
			annotations: { title: "Run read-only SQL", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		async ({ sql }) =>
			run(async () => {
				const g = guardSql(sql);
				if (!g.ok) throw new Error(g.reason);
				const rows = await exec(g.sql);
				return { columns: rows.length ? Object.keys(rows[0]) : [], rows, row_count: rows.length };
			}),
	);

	server.registerTool(
		"get_energy_inputs",
		{
			title: "Get energy-model inputs",
			description:
				"Daily (date, weight, kcal) entries for days having BOTH a calorie total and at least one " +
				"weigh-in — shaped exactly for the fitness-tools `adaptive-tdee` tool. Pass the returned " +
				"`entries` array straight through to compute measured TDEE. Weight is the day's average in lb.",
			inputSchema: {
				window_days: z.number().int().min(10).max(3650).optional()
					.describe("Trailing window (default 90 days)."),
			},
			annotations: { title: "Get energy-model inputs", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		async ({ window_days }) =>
			run(async () => {
				const days = window_days ?? 90;
				const rows = await exec(
					`SELECT t.date::text AS date, m.avg_lb, t.value AS kcal
					 FROM daily_totals t
					 JOIN (SELECT date, AVG(value) AS avg_lb FROM measurements WHERE metric = 'weight' GROUP BY date) m
					   USING (date)
					 WHERE t.metric = 'calories' AND t.date >= current_date - interval '${days} days'
					 ORDER BY t.date`,
				);
				return {
					entries: rows.map((r) => ({
						date: r.date as string,
						weight: { value: r.avg_lb as number, unit: "lb" },
						kcal: r.kcal as number,
					})),
				};
			}),
	);
}
