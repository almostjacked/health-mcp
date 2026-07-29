// Tables transcribed verbatim-in-substance from backfill/backfill.py (the
// reference implementation of the Apple Health export import). HealthKit
// type -> (metric, class). Nutrition aggregates per local date; measurements
// keep samples.
export const TYPES: Record<string, { metric: string; cls: "measurement" | "total" }> = {
	HKQuantityTypeIdentifierBodyMass: { metric: "weight", cls: "measurement" },
	HKQuantityTypeIdentifierBodyFatPercentage: { metric: "body_fat_pct", cls: "measurement" },
	HKQuantityTypeIdentifierLeanBodyMass: { metric: "lean_body_mass", cls: "measurement" },
	HKQuantityTypeIdentifierDietaryEnergyConsumed: { metric: "calories", cls: "total" },
	HKQuantityTypeIdentifierDietaryProtein: { metric: "protein", cls: "total" },
	HKQuantityTypeIdentifierDietaryCarbohydrates: { metric: "carbs", cls: "total" },
	HKQuantityTypeIdentifierDietaryFatTotal: { metric: "fat", cls: "total" },
	HKQuantityTypeIdentifierDietaryWater: { metric: "water", cls: "total" },
	HKQuantityTypeIdentifierDietarySodium: { metric: "sodium", cls: "total" },
};

// Canonical unit per total metric (samples in other units are converted before summing).
export const TOTAL_UNIT: Record<string, string> = {
	calories: "kcal",
	protein: "g",
	carbs: "g",
	fat: "g",
	water: "mL",
	sodium: "mg",
};

// Keyed by `${metric}|${unit}` (backfill.py keys by the (metric, unit) tuple).
export const CONVERT: Record<string, number> = {
	"calories|Cal": 1.0,
	"calories|kcal": 1.0,
	"calories|kJ": 1 / 4.184,
	"protein|g": 1.0,
	"carbs|g": 1.0,
	"fat|g": 1.0,
	"protein|mg": 0.001,
	"carbs|mg": 0.001,
	"fat|mg": 0.001,
	"water|mL": 1.0,
	"water|ml": 1.0,
	"water|L": 1000.0,
	"water|fl_oz_us": 29.5735295625,
	"sodium|mg": 1.0,
	"sodium|g": 1000.0,
};

const ATTR_RE = /(\w+)="([^"]*)"/g;
const KEEP = new Set(["type", "unit", "value", "startDate", "creationDate"]);

export interface RawRecord {
	type: string;
	unit?: string;
	value?: string;
	startDate?: string;
	creationDate?: string;
}

/** Streams `<Record .../>` elements out of export.xml text chunks. We only
 * need a Record's own attributes, so a scanning tokenizer beats a real XML
 * parser at GB scale. Records may be self-closing (`<Record .../>`) or, as
 * real Apple Health exports routinely do, wrap `<MetadataEntry key value/>`
 * children (`<Record ...>...</Record>`) — either way the Record's own
 * attributes end at the first ">" after "<Record ". Scanning for that "/>"
 * instead would let a child's `value=` attribute overwrite the Record's own.
 * Carries an internal tail buffer so elements split across chunk boundaries
 * are reassembled; everything that is not a Record's opening tag (children,
 * `</Record>` closers, other noise) is discarded as it streams past. */
export class RecordScanner {
	private buf = "";

	feed(chunk: string): RawRecord[] {
		this.buf += chunk;
		const out: RawRecord[] = [];
		let idx: number;
		while ((idx = this.buf.indexOf("<Record ")) !== -1) {
			const close = this.buf.indexOf(">", idx);
			if (close === -1) {
				// incomplete element — keep from the element start, drop the prefix
				this.buf = this.buf.slice(idx);
				return out;
			}
			// Attribute region = the opening tag only (stops before any child
			// elements like <MetadataEntry .../>, whose value= would otherwise
			// overwrite the Record's own — real exports nest these routinely).
			const element = this.buf.slice(idx, close);
			this.buf = this.buf.slice(close + 1);
			const rec: Partial<RawRecord> = {};
			for (const m of element.matchAll(ATTR_RE)) {
				if (KEEP.has(m[1])) (rec as Record<string, string>)[m[1]] = m[2];
			}
			if (rec.type) out.push(rec as RawRecord);
		}
		// no Record start in the remainder — keep only a tail long enough to
		// hold a split "<Record " opener
		if (this.buf.length > 8) this.buf = this.buf.slice(-8);
		return out;
	}

	end(): RawRecord[] {
		const out = this.feed("");
		this.buf = "";
		return out;
	}
}
