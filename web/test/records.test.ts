import { describe, it, expect } from "vitest";
import { RecordScanner } from "../src/import/records.js";

const REC = `<Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" value="205.4" startDate="2026-07-19 07:41:12 -0600" creationDate="2026-07-19 07:41:20 -0600"/>`;
const NOISE = `<ExportDate value="2026-07-28"/><Me HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexMale"/>`;

describe("RecordScanner", () => {
	it("extracts attributes from a whole Record element", () => {
		const s = new RecordScanner();
		const out = [...s.feed(NOISE + REC), ...s.end()];
		expect(out).toEqual([{
			type: "HKQuantityTypeIdentifierBodyMass", unit: "lb", value: "205.4",
			startDate: "2026-07-19 07:41:12 -0600", creationDate: "2026-07-19 07:41:20 -0600",
		}]);
	});
	it("is chunk-boundary safe: 1-byte feeding equals whole-string feeding", () => {
		const xml = NOISE + REC + REC.replace("205.4", "204.9") + NOISE;
		const whole = (() => { const s = new RecordScanner(); return [...s.feed(xml), ...s.end()]; })();
		const byBytes = (() => {
			const s = new RecordScanner();
			const out = [];
			for (const ch of xml) out.push(...s.feed(ch));
			out.push(...s.end());
			return out;
		})();
		expect(byBytes).toEqual(whole);
		expect(whole.length).toBe(2);
	});
	it("ignores multi-line/nested Record bodies gracefully (self-closing only)", () => {
		const s = new RecordScanner();
		const withEntities = `<Record type="HKQuantityTypeIdentifierDietaryProtein" unit="g" value="30" startDate="2026-07-19 08:00:00 -0600" creationDate="2026-07-19 08:00:01 -0600" sourceName="Lose It&#33;"/>`;
		const out = [...s.feed(withEntities), ...s.end()];
		expect(out[0].type).toBe("HKQuantityTypeIdentifierDietaryProtein");
	});
});
