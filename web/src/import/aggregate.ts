import { TYPES, TOTAL_UNIT, CONVERT } from "./records.js";
import type { RawRecord } from "./records.js";

export interface IngestEntry {
	date: string;
	metric: string;
	value: number;
	unit: string | null;
	timestamp?: string;
	source: "backfill-web";
}

interface TotalGroup {
	count: number;
	convertedValue: number;
}

/** Parses Apple Health's `"YYYY-MM-DD HH:MM:SS ±HHMM"` startDate/creationDate
 * strings by pure string transform (never via `new Date`, which would
 * normalize away the original UTC offset). Returns the local date substring
 * (chars 0-10 — already local time, per backfill.py) plus the ISO-8601 form
 * with the original offset preserved. */
function parseStartDate(s: string | undefined): { date: string; iso: string } | null {
	if (!s) return null;
	const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(s);
	if (!m) return null;
	const [, datePart, timePart, offHours, offMinutes] = m;
	return { date: datePart, iso: `${datePart}T${timePart}${offHours}:${offMinutes}` };
}

/** Direct port of backfill.py's `parse_export` per-record body (lines
 * 66-111), adapted to a push-based add()/finish() API so records can be fed
 * in as the export.zip is decompressed instead of loaded into memory whole.
 * Reference: backfill/backfill.py in the private repo (read-only source of
 * truth for this port; ported faithfully, never linked or leaked). */
export class Aggregator {
	private entries: IngestEntry[] = [];
	private badRecords = 0;
	private skippedUnits = new Set<string>();
	// bucketKey `${date}|${metric}` -> dedupKey `${startDate}|${value}|${creationDate}` -> group
	private totals = new Map<string, Map<string, TotalGroup>>();

	add(r: RawRecord): void {
		const spec = TYPES[r.type];
		if (!spec) return;
		const { metric, cls } = spec;
		const unit = r.unit ?? "";
		const rawValue = r.value ?? "";
		const value = rawValue === "" ? NaN : Number(rawValue);
		const parsed = parseStartDate(r.startDate);
		if (!Number.isFinite(value) || !parsed) {
			this.badRecords++;
			return;
		}
		const { date, iso } = parsed;

		if (cls === "measurement") {
			let v = value;
			// HealthKit stores body-fat fractions; the API wants percent.
			if (metric === "body_fat_pct" && v <= 1.0) v = v * 100.0;
			this.entries.push({
				date,
				metric,
				value: v,
				unit: unit || null,
				timestamp: iso,
				source: "backfill-web",
			});
			return;
		}

		const factor = CONVERT[`${metric}|${unit}`];
		if (factor === undefined) {
			this.skippedUnits.add(`${metric}/${unit}`);
			return;
		}
		// Lose It! writes every sample to HealthKit TWICE (backfill.py verified:
		// 1705 of 1707 days are perfect whole-day clones — same start/value/
		// creationDate). Group by exact identity on the RAW attribute strings
		// and later keep ceil(count/2) of each group: halves the cloned groups,
		// preserves genuine singles and repeats. Mirrors backfill.py lines 96-104.
		const bucketKey = `${date}|${metric}`;
		let bucket = this.totals.get(bucketKey);
		if (!bucket) {
			bucket = new Map();
			this.totals.set(bucketKey, bucket);
		}
		const dedupKey = `${r.startDate}|${r.value}|${r.creationDate}`;
		const existing = bucket.get(dedupKey);
		bucket.set(dedupKey, {
			count: (existing?.count ?? 0) + 1,
			convertedValue: value * factor,
		});
	}

	finish(): { entries: IngestEntry[]; badRecords: number; skippedUnits: string[] } {
		const totalEntries: IngestEntry[] = [];
		const keys = [...this.totals.keys()].sort((a, b) => {
			const [dateA, metricA] = a.split("|");
			const [dateB, metricB] = b.split("|");
			return dateA === dateB ? metricA.localeCompare(metricB) : dateA.localeCompare(dateB);
		});
		for (const key of keys) {
			const [date, metric] = key.split("|");
			const groups = this.totals.get(key)!;
			let sum = 0;
			// ceil(count/2), implemented as floor((count+1)/2) to mirror Python's (c+1)//2.
			for (const { count, convertedValue } of groups.values()) {
				sum += convertedValue * Math.floor((count + 1) / 2);
			}
			totalEntries.push({
				date,
				metric,
				value: Math.round(sum * 1e6) / 1e6,
				unit: TOTAL_UNIT[metric],
				source: "backfill-web",
			});
		}
		return {
			entries: [...this.entries, ...totalEntries],
			badRecords: this.badRecords,
			skippedUnits: [...this.skippedUnits],
		};
	}
}

/** Per-metric entry counts, for the Import panel's summary table. Purely a
 * client-side count of parsed entries — independent of (and always available
 * before, in a dry run instead of) whatever `postEntries` reports it wrote. */
export function summarizeByMetric(entries: IngestEntry[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const e of entries) counts[e.metric] = (counts[e.metric] ?? 0) + 1;
	return counts;
}
