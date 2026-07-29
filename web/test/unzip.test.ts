import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { streamExportXml } from "../src/import/unzip.js";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_US">
<ExportDate value="2026-07-28 12:00:00 -0600"/>
<Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" value="205.4" startDate="2026-07-19 07:41:12 -0600" creationDate="2026-07-19 07:41:20 -0600"/>
</HealthData>
`;

function zipBlob(entries: Record<string, Uint8Array>): Blob {
	const zipped = zipSync(entries);
	return new Blob([zipped as unknown as BlobPart]);
}

describe("streamExportXml", () => {
	it("finds and streams apple_health_export/export.xml, reassembling the original text", async () => {
		const blob = zipBlob({ "apple_health_export/export.xml": strToU8(XML) });
		const chunks: string[] = [];
		await new Promise<void>((resolve, reject) => {
			streamExportXml(
				blob,
				(text) => chunks.push(text),
				() => resolve(),
				(e) => reject(e),
			);
		});
		expect(chunks.join("")).toBe(XML);
	});

	it("also finds a bare export.xml at the zip root", async () => {
		const blob = zipBlob({ "export.xml": strToU8(XML) });
		const chunks: string[] = [];
		await new Promise<void>((resolve, reject) => {
			streamExportXml(
				blob,
				(text) => chunks.push(text),
				() => resolve(),
				(e) => reject(e),
			);
		});
		expect(chunks.join("")).toBe(XML);
	});

	it("calls onError mentioning export.xml when the zip has no such entry", async () => {
		const blob = zipBlob({ "apple_health_export/other.xml": strToU8("<x/>") });
		const err = await new Promise<Error>((resolve) => {
			streamExportXml(
				blob,
				() => {},
				() => resolve(new Error("onDone called unexpectedly")),
				(e) => resolve(e),
			);
		});
		expect(err.message).toMatch(/export\.xml/i);
	});

	it("errors cleanly on a non-zip blob", async () => {
		const blob = new Blob(["this is not a zip file"]);
		const err = await new Promise<Error>((resolve) => {
			streamExportXml(
				blob,
				() => {},
				() => resolve(new Error("onDone called unexpectedly")),
				(e) => resolve(e),
			);
		});
		expect(err).toBeInstanceOf(Error);
	});
});
