import { describe, it, expect } from "vitest";
import { REGISTRY, normalizeEntry } from "../src/registry";

const base = { date: "2026-07-19", metric: "weight", value: 191.2, unit: "lb", source: "shortcut" };

describe("normalizeEntry", () => {
	it("passes canonical units through and stamps the metric class", () => {
		const r = normalizeEntry(base);
		expect(r).toMatchObject({ ok: true, entry: { metric: "weight", value: 191.2, unit: "lb", cls: "measurement" } });
	});

	it("converts kg to lb at full precision (6dp)", () => {
		const r = normalizeEntry({ ...base, value: 86.7, unit: "kg" });
		expect(r.ok && r.entry.value).toBe(191.140781); // 86.7 × 2.2046226218487757 = 191.14078131…
	});

	it("converts mL to floz and kJ to kcal", () => {
		const w = normalizeEntry({ date: "2026-07-19", metric: "water", value: 500, unit: "mL" });
		expect(w.ok && w.entry.value).toBe(16.907011); // 500 / 29.5735295625
		const c = normalizeEntry({ date: "2026-07-19", metric: "calories", value: 8368, unit: "kJ" });
		expect(c.ok && c.entry.value).toBe(2000);
	});

	it("rejects a body-fat fraction with an actionable hint", () => {
		const r = normalizeEntry({ date: "2026-07-19", metric: "body_fat_pct", value: 0.153, unit: "%" });
		expect(r).toMatchObject({ ok: false });
		expect(!r.ok && r.reason).toMatch(/fraction.*percent/i);
	});

	it("accepts a real body-fat percent", () => {
		expect(normalizeEntry({ date: "2026-07-19", metric: "body_fat_pct", value: 15.3, unit: "%" }).ok).toBe(true);
	});

	it("rejects unknown metrics and unknown units with lists", () => {
		const m = normalizeEntry({ ...base, metric: "steps" });
		expect(!m.ok && m.reason).toContain("weight");
		const u = normalizeEntry({ ...base, unit: "stone" });
		expect(!u.ok && u.reason).toContain("kg");
	});

	it("rejects out-of-range values and bad dates", () => {
		expect(normalizeEntry({ ...base, value: 2500 }).ok).toBe(false);
		expect(normalizeEntry({ ...base, date: "07/19/2026" }).ok).toBe(false);
		expect(normalizeEntry({ ...base, value: Number.NaN }).ok).toBe(false);
	});

	it("registry covers exactly the 9 spec metrics", () => {
		expect(Object.keys(REGISTRY).sort()).toEqual(
			["body_fat_pct", "calories", "carbs", "fat", "lean_body_mass", "protein", "sodium", "water", "weight"],
		);
	});
});

describe("string value coercion (Shortcuts text interpolation)", () => {
	it("accepts numeric strings, stripping locale comma grouping", () => {
		const r = normalizeEntry({ date: "2026-07-21", metric: "calories", value: "2,450" as unknown as number, unit: "kcal" });
		expect(r).toMatchObject({ ok: true, entry: { value: 2450 } });
		const w = normalizeEntry({ date: "2026-07-21", metric: "weight", value: "191.2" as unknown as number, unit: "lb" });
		expect(w).toMatchObject({ ok: true, entry: { value: 191.2 } });
	});
	it("still rejects non-numeric strings and empty strings", () => {
		expect(normalizeEntry({ date: "2026-07-21", metric: "calories", value: "abc" as unknown as number, unit: "kcal" }).ok).toBe(false);
		expect(normalizeEntry({ date: "2026-07-21", metric: "calories", value: "" as unknown as number, unit: "kcal" }).ok).toBe(false);
	});
});
