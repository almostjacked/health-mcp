// Import panel: DOM assembly + event wiring only. All parsing/aggregation/
// posting logic lives in ../import/{unzip,records,aggregate,post}.ts, which
// carry their own tests — this file streams a chosen file through those
// modules and renders progress/results.
import { streamExportXml } from "../import/unzip.js";
import { RecordScanner } from "../import/records.js";
import { Aggregator, summarizeByMetric } from "../import/aggregate.js";
import type { IngestEntry } from "../import/aggregate.js";
import { postEntries } from "../import/post.js";
import { getConfig, setConfig, CONFIG_CHANGED_EVENT } from "../state.js";

// Verbatim from README.md's fitness-tools pairing section.
const MIN_DAYS_NOTE =
	"adaptive-tdee needs at least 10 days that have BOTH a weigh-in and a calorie total — expect ~2 weeks of syncing before the pairing works.";

// Update the "Scanned N records…" line at most this often, so a multi-GB
// export doesn't turn into a DOM-churn-bound import.
const SCAN_PROGRESS_STRIDE = 500;

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs: Record<string, string> = {},
	children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === "class") node.className = v;
		else node.setAttribute(k, v);
	}
	for (const child of children) node.append(child);
	return node;
}

export function mountImportPanel(container: HTMLElement): void {
	container.textContent = "";

	const config = getConfig();

	// ---- connection fields (pre-filled from state, editable) ----
	const urlInput = el("input", { type: "text", id: "ing-url", placeholder: "https://<ref>.supabase.co/functions/v1/health-ingest" }) as HTMLInputElement;
	const keyInput = el("input", { type: "password", id: "ing-key", placeholder: "INGEST_KEY", autocomplete: "off" }) as HTMLInputElement;
	if (config.ingestUrl) urlInput.value = config.ingestUrl;
	if (config.ingestKey) keyInput.value = config.ingestKey;
	// Only auto-refresh these fields from a later Provision run if the user
	// hasn't typed something different in the meantime.
	let syncedUrl = urlInput.value;
	let syncedKey = keyInput.value;
	window.addEventListener(CONFIG_CHANGED_EVENT, () => {
		const latest = getConfig();
		if (latest.ingestUrl && urlInput.value === syncedUrl) {
			urlInput.value = latest.ingestUrl;
			syncedUrl = latest.ingestUrl;
		}
		if (latest.ingestKey && keyInput.value === syncedKey) {
			keyInput.value = latest.ingestKey;
			syncedKey = latest.ingestKey;
		}
	});

	const connectionFields = el("div", {}, [
		el("div", { class: "field" }, [el("label", { for: "ing-url" }, ["Ingest URL"]), urlInput]),
		el("div", { class: "field" }, [el("label", { for: "ing-key" }, ["Ingest key"]), keyInput]),
	]);

	// ---- file picker + drag-drop zone ----
	const fileInput = el("input", { type: "file", id: "export-file", accept: ".zip" }) as HTMLInputElement;
	fileInput.style.display = "none";
	const dropzoneLabel = el("p", {}, ["Drag your export.zip here, or click to choose a file"]);
	const dropzone = el("div", { class: "dropzone" }, [dropzoneLabel]) as HTMLDivElement;
	dropzone.addEventListener("click", () => fileInput.click());
	dropzone.addEventListener("dragover", (e) => {
		e.preventDefault();
		dropzone.classList.add("dragover");
	});
	dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
	dropzone.addEventListener("drop", (e) => {
		e.preventDefault();
		dropzone.classList.remove("dragover");
		const file = e.dataTransfer?.files?.[0];
		if (file) {
			const transfer = new DataTransfer();
			transfer.items.add(file);
			fileInput.files = transfer.files;
			dropzoneLabel.textContent = file.name;
		}
	});
	fileInput.addEventListener("change", () => {
		const file = fileInput.files?.[0];
		dropzoneLabel.textContent = file ? file.name : "Drag your export.zip here, or click to choose a file";
	});

	// ---- dry run (default ON) ----
	const dryRunInput = el("input", { type: "checkbox", id: "dry-run", checked: "checked" }) as HTMLInputElement;
	const dryRunRow = el("label", { class: "checkbox-row" }, [dryRunInput, "Dry run (parse only — don't send anything)"]);

	const importBtn = el("button", { type: "button", class: "btn" }, ["Import"]) as HTMLButtonElement;
	const errorText = el("p", { class: "error-text" }, []) as HTMLParagraphElement;
	errorText.style.display = "none";
	const progressLine = el("p", { class: "progress-line" }, []) as HTMLParagraphElement;
	progressLine.style.display = "none";
	const summaryWrap = el("div", { class: "summary-wrap" }, []) as HTMLDivElement;

	container.append(
		el("p", { class: "notice" }, [MIN_DAYS_NOTE]),
		connectionFields,
		dropzone,
		fileInput,
		dryRunRow,
		el("div", { class: "btn-row" }, [importBtn]),
		errorText,
		progressLine,
		summaryWrap,
	);

	function renderSummary(
		entries: IngestEntry[],
		badRecords: number,
		skippedUnits: string[],
		totals: { inserted: number; updated: number; skipped: number; rejected: number } | null,
	): void {
		summaryWrap.textContent = "";
		const perMetric = summarizeByMetric(entries);
		const metrics = Object.keys(perMetric).sort();

		const table = el("table", { class: "summary" }, [
			el("thead", {}, [el("tr", {}, [el("th", {}, ["Metric"]), el("th", {}, ["Entries parsed"])])]),
			el(
				"tbody",
				{},
				metrics.map((m) => el("tr", {}, [el("td", {}, [m]), el("td", {}, [String(perMetric[m])])])),
			),
		]);
		summaryWrap.append(table);

		const kvRows: Array<[string, string]> = [["Total parsed", String(entries.length)]];
		if (totals) {
			kvRows.push(
				["Sent", String(entries.length)],
				["Written (inserted + updated)", String(totals.inserted + totals.updated)],
				["Skipped", String(totals.skipped)],
				["Rejected", String(totals.rejected)],
			);
		} else {
			kvRows.push(["Sent", "0 (dry run — nothing was sent)"]);
		}
		if (badRecords > 0) kvRows.push(["Unparseable records skipped", String(badRecords)]);
		if (skippedUnits.length > 0) kvRows.push(["Unrecognized units skipped", skippedUnits.join(", ")]);

		summaryWrap.append(
			el(
				"dl",
				{ class: "kv" },
				kvRows.flatMap(([k, v]) => [el("dt", {}, [k]), el("dd", {}, [v])]),
			),
		);
		summaryWrap.append(
			el("p", { class: "next-step" }, [el("strong", {}, ["Next:"]), " set up the daily sync below."]),
		);
	}

	importBtn.addEventListener("click", () => {
		void runImport();
	});

	async function runImport(): Promise<void> {
		errorText.style.display = "none";
		summaryWrap.textContent = "";
		const file = fileInput.files?.[0];
		if (!file) {
			errorText.textContent = "Choose an export.zip file first.";
			errorText.style.display = "";
			return;
		}
		const dryRun = dryRunInput.checked;
		const url = urlInput.value.trim();
		const key = keyInput.value.trim();
		if (!dryRun && (!url || !key)) {
			errorText.textContent = "Enter the ingest URL and key first (or check Dry run to just parse).";
			errorText.style.display = "";
			return;
		}

		importBtn.disabled = true;
		progressLine.style.display = "";
		progressLine.textContent = "Reading export.zip…";

		try {
			const aggregator = new Aggregator();
			const scanner = new RecordScanner();
			let scanned = 0;
			let lastReported = 0;

			await new Promise<void>((resolve, reject) => {
				streamExportXml(
					file,
					(chunk) => {
						for (const record of scanner.feed(chunk)) {
							aggregator.add(record);
							scanned++;
						}
						if (scanned - lastReported >= SCAN_PROGRESS_STRIDE) {
							lastReported = scanned;
							progressLine.textContent = `Scanned ${scanned} records…`;
						}
					},
					resolve,
					reject,
				);
			});
			for (const record of scanner.end()) {
				aggregator.add(record);
				scanned++;
			}
			progressLine.textContent = `Scanned ${scanned} records.`;

			const { entries, badRecords, skippedUnits } = aggregator.finish();

			if (dryRun) {
				progressLine.textContent = `Scanned ${scanned} records — parsed ${entries.length} entries. Dry run: nothing sent.`;
				renderSummary(entries, badRecords, skippedUnits, null);
				return;
			}

			const totals = await postEntries(entries, url, key, (sent, total, written) => {
				progressLine.textContent = `Sent ${sent}/${total} (written ${written})…`;
			});
			progressLine.textContent = `Done — sent ${entries.length} entries.`;
			renderSummary(entries, badRecords, skippedUnits, totals);
			setConfig({ ingestUrl: url, ingestKey: key });
		} catch (e) {
			errorText.textContent = e instanceof Error ? e.message : String(e);
			errorText.style.display = "";
		} finally {
			importBtn.disabled = false;
		}
	}
}
