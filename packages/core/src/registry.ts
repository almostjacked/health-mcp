export type MetricClass = "total" | "measurement";

export interface MetricSpec {
	cls: MetricClass;
	unit: string; // canonical
	min: number;
	max: number;
}

export const REGISTRY: Record<string, MetricSpec> = {
	weight: { cls: "measurement", unit: "lb", min: 50, max: 500 },
	body_fat_pct: { cls: "measurement", unit: "%", min: 2, max: 75 },
	lean_body_mass: { cls: "measurement", unit: "lb", min: 30, max: 400 },
	calories: { cls: "total", unit: "kcal", min: 0, max: 10000 },
	protein: { cls: "total", unit: "g", min: 0, max: 1000 },
	carbs: { cls: "total", unit: "g", min: 0, max: 2000 },
	fat: { cls: "total", unit: "g", min: 0, max: 1000 },
	water: { cls: "total", unit: "floz", min: 0, max: 700 },
	sodium: { cls: "total", unit: "mg", min: 0, max: 30000 },
};

// Accepted input units per canonical unit, with conversion to canonical.
const TO_CANONICAL: Record<string, Record<string, (v: number) => number>> = {
	lb: { lb: (v) => v, kg: (v) => v * 2.2046226218487757 },
	"%": { "%": (v) => v },
	kcal: { kcal: (v) => v, Cal: (v) => v, kJ: (v) => v / 4.184 },
	g: { g: (v) => v, mg: (v) => v / 1000 },
	floz: { floz: (v) => v, fl_oz_us: (v) => v, mL: (v) => v / 29.5735295625, L: (v) => (v * 1000) / 29.5735295625 },
	mg: { mg: (v) => v, g: (v) => v * 1000 },
};

export interface RawEntry {
	date?: unknown;
	metric?: unknown;
	value?: unknown;
	unit?: unknown;
	source?: unknown;
	timestamp?: unknown;
	external_id?: unknown;
}

export interface NormalizedEntry {
	date: string;
	metric: string;
	value: number;
	unit: string;
	source: string | null;
	timestamp: string | null;
	external_id: string | null;
	cls: MetricClass;
}

export type NormalizeResult = { ok: true; entry: NormalizedEntry } | { ok: false; reason: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeEntry(raw: RawEntry): NormalizeResult {
	const metric = String(raw.metric ?? "");
	const spec = REGISTRY[metric];
	if (!spec) return { ok: false, reason: `unknown metric "${metric}" — valid: ${Object.keys(REGISTRY).join(", ")}` };
	if (typeof raw.date !== "string" || !DATE_RE.test(raw.date)) {
		return { ok: false, reason: `bad date "${String(raw.date)}" — need YYYY-MM-DD` };
	}
	// Strings tolerated for iOS Shortcuts text interpolation, which can emit
	// locale-grouped numbers ("2,450"); commas are stripped before parsing.
	const rawV = raw.value;
	const v =
		typeof rawV === "number"
			? rawV
			: typeof rawV === "string" && rawV.trim() !== ""
				? Number(rawV.replace(/,/g, "").trim())
				: Number.NaN;
	if (!Number.isFinite(v)) return { ok: false, reason: "value must be a finite number" };
	const unit = raw.unit == null ? spec.unit : String(raw.unit);
	const convert = TO_CANONICAL[spec.unit][unit];
	if (!convert) {
		return { ok: false, reason: `unit "${unit}" not accepted for ${metric} — accepted: ${Object.keys(TO_CANONICAL[spec.unit]).join(", ")}` };
	}
	const value = Math.round(convert(v) * 1e6) / 1e6;
	if (metric === "body_fat_pct" && value < spec.min) {
		return { ok: false, reason: `body_fat_pct ${value} looks like a HealthKit fraction — send percent (e.g. 15.3, not 0.153)` };
	}
	if (value < spec.min || value > spec.max) {
		return { ok: false, reason: `${metric} ${value} ${spec.unit} outside sane range [${spec.min}, ${spec.max}]` };
	}
	return {
		ok: true,
		entry: {
			date: raw.date,
			metric,
			value,
			unit: spec.unit,
			source: raw.source != null ? String(raw.source) : null,
			timestamp: typeof raw.timestamp === "string" ? raw.timestamp : null,
			external_id: raw.external_id != null ? String(raw.external_id) : null,
			cls: spec.cls,
		},
	};
}
