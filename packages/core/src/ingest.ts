import { normalizeEntry, type NormalizedEntry, type RawEntry } from "./registry.js";
import { writeRows, type SupabaseEnv } from "./supabase.js";

export interface IngestPlan {
	totals: NormalizedEntry[];
	measurements: NormalizedEntry[];
	rejected: { entry: unknown; reason: string }[];
}

export interface IngestResult {
	inserted: number;
	updated: number;
	skipped: number;
	rejected: IngestPlan["rejected"];
}

/** FNV-1a (two lanes, 16 hex chars) — stable dedup key for measurements without a HealthKit UUID.
 * Timestamps are normalized to epoch millis so "-06:00" / "-0600" / "Z" renderings of the same
 * instant hash identically across backfill and Shortcut sources.
 * The lane constants are LOAD-BEARING: changing them changes every synthetic id and breaks dedup
 * against previously stored rows — never alter them. */
export function synthId(e: NormalizedEntry): string {
	const rawTs = e.timestamp ?? "";
	const epoch = rawTs ? Date.parse(rawTs) : Number.NaN;
	const ts = Number.isFinite(epoch) ? String(epoch) : rawTs;
	const s = `${e.date}|${e.metric}|${e.value}|${ts}`;
	let h1 = 0x811c9dc5;
	let h2 = 0xcbf29ce4;
	for (let i = 0; i < s.length; i++) {
		h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0;
		h2 = Math.imul(h2 ^ s.charCodeAt(i), 0x01000197) >>> 0;
	}
	return `synth-${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export function planWrites(raw: unknown): IngestPlan {
	const plan: IngestPlan = { totals: [], measurements: [], rejected: [] };
	const entries = (raw as { entries?: unknown[] } | null)?.entries;
	if (!Array.isArray(entries)) {
		plan.rejected.push({ entry: raw, reason: "body must be {entries: [...]}" });
		return plan;
	}
	for (const e of entries) {
		const r = normalizeEntry(e as RawEntry);
		if (!r.ok) {
			plan.rejected.push({ entry: e, reason: r.reason });
			continue;
		}
		if (r.entry.cls === "total") {
			plan.totals.push(r.entry);
		} else {
			if (!r.entry.external_id) r.entry.external_id = synthId(r.entry);
			plan.measurements.push(r.entry);
		}
	}
	// Same-batch duplicates of one (date, metric) would skew executeIngest's
	// insert/update counts; collapse them here — last entry wins, like the upsert.
	if (plan.totals.length > 1) {
		const byKey = new Map<string, NormalizedEntry>();
		for (const t of plan.totals) byKey.set(`${t.date}|${t.metric}`, t);
		plan.totals = [...byKey.values()];
	}
	return plan;
}

export async function executeIngest(env: SupabaseEnv, plan: IngestPlan): Promise<IngestResult> {
	let upserted = 0;
	let inserted = 0;
	let skipped = 0;

	if (plan.totals.length) {
		upserted = await writeRows(env, "daily_totals", "date,metric", "merge-duplicates",
			plan.totals.map((t) => ({ date: t.date, metric: t.metric, value: t.value, unit: t.unit, source: t.source })));
	}
	if (plan.measurements.length) {
		inserted = await writeRows(env, "measurements", "external_id", "ignore-duplicates",
			plan.measurements.map((m) => ({ date: m.date, timestamp: m.timestamp, metric: m.metric, value: m.value, unit: m.unit, source: m.source, external_id: m.external_id })));
		skipped = plan.measurements.length - inserted;
	}
	// Response contract note: the D1 version split totals into inserted/updated via an
	// existence probe; PostgREST merge-duplicates doesn't distinguish. Totals now report
	// as `updated` (upserted count) and `inserted` counts measurements only — the
	// Shortcut ignores the body, and get_sync_status is the real health check.
	return { inserted, updated: upserted, skipped, rejected: plan.rejected };
}
