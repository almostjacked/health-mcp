// Shortcut panel: DOM assembly + event wiring only. The action graph and
// plist byte format live in ../shortcut/plist.ts, golden-tested against
// scripts/generate_shortcut.py — this file just collects the ingest URL/key,
// triggers a download, and walks through installing + automating the result.
import { buildShortcut } from "../shortcut/plist.js";
import { getConfig, setConfig, CONFIG_CHANGED_EVENT } from "../state.js";

const SHORTCUT_DOCS_URL = "https://github.com/almostjacked/health-mcp/blob/main/docs/shortcut.md";
const SHORTCUT_FILE_NAME = "sync-health-data.shortcut";

// Task 6 feasibility gate. iOS only accepts *unsigned* shortcuts (which is
// all a browser can produce — signing needs Apple's `shortcuts` CLI on a
// Mac) when the device's security setting allows it, and that's unverified
// until Task 6 tests an on-device import of a browser-generated file. If
// that import fails, flip this to false to ship the proven python-script
// path instead — both code paths are implemented below and ship together;
// this flag just picks which one renders.
const BROWSER_SHORTCUT_ENABLED = true;

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

function installSteps(): HTMLOListElement {
	return el("ol", { class: "install-steps" }, [
		el("li", {}, [
			"Get the downloaded ",
			el("code", {}, [SHORTCUT_FILE_NAME]),
			" onto your iPhone — AirDrop from a Mac, or upload it somewhere and open the link in Safari on the phone.",
		]),
		el("li", {}, ["Opening it launches the Shortcuts app's import screen. Tap ", el("strong", {}, ["Add Shortcut"]), "."]),
		el("li", {}, [
			"The first time it runs, iOS will ask for permission to read each Health metric (Dietary Calories, Protein, " +
				"Carbohydrates, Total Fat, Water, Sodium, Weight, Body Fat Percentage). Allow all of them.",
		]),
		el("li", {}, [
			"Run it once manually (tap the shortcut in the Shortcuts app) to confirm it works — each day's POST response " +
				"is shown on screen. You should see a response indicating rows were inserted/updated, not an error.",
		]),
		el("li", {}, [
			"If a Health metric picker chip (e.g. \"Dietary Calories\") imported blank or wrong, tap that action and " +
				"reselect the correct type. Likewise, if the ",
			el("strong", {}, ["Repeat Index"]),
			" chip inside the date-subtraction step imported blank, tap it and choose Repeat Index from the magic-variable list.",
		]),
	]);
}

function automationSteps(): HTMLOListElement {
	return el("ol", { class: "install-steps" }, [
		el("li", {}, [
			"In the Shortcuts app, go to the ",
			el("strong", {}, ["Automation"]),
			" tab → ",
			el("strong", {}, ["+"]),
			" → ",
			el("strong", {}, ["Create Personal Automation"]),
			".",
		]),
		el("li", {}, [
			"Choose ",
			el("strong", {}, ["Time of Day"]),
			", set it to ",
			el("strong", {}, ["9:00 AM"]),
			" (or any time after your data for \"yesterday\" is likely finalized), repeat ",
			el("strong", {}, ["Daily"]),
			".",
		]),
		el("li", {}, ["Add action ", el("strong", {}, ["Run Shortcut"]), ", choose ", el("strong", {}, ["Sync Health Data"]), "."]),
		el("li", {}, ["Turn ", el("strong", {}, ["off"]), " \"Ask Before Running\" so it runs silently in the background."]),
		el("li", {}, [
			"Before relying on the automation, open the shortcut and delete the ",
			el("strong", {}, ["Show Result"]),
			" action at the end — it's useful for confirming manual runs but will otherwise pop up a dialog during the silent automation.",
		]),
	]);
}

function mountBrowserBuilder(container: HTMLElement): void {
	const config = getConfig();

	const urlInput = el("input", {
		type: "text",
		id: "sc-url",
		placeholder: "https://<ref>.supabase.co/functions/v1/health-ingest",
	}) as HTMLInputElement;
	const keyInput = el("input", { type: "password", id: "sc-key", autocomplete: "off", placeholder: "INGEST_KEY" }) as HTMLInputElement;
	if (config.ingestUrl) urlInput.value = config.ingestUrl;
	if (config.ingestKey) keyInput.value = config.ingestKey;
	// Only auto-refresh these fields from a later Provision/Import run if the
	// user hasn't typed something different in the meantime (same pattern as
	// the Import panel).
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

	const fields = el("div", {}, [
		el("div", { class: "field" }, [el("label", { for: "sc-url" }, ["Ingest URL"]), urlInput]),
		el("div", { class: "field" }, [el("label", { for: "sc-key" }, ["Ingest key"]), keyInput]),
	]);

	const generateBtn = el("button", { type: "button", class: "btn" }, ["Generate Shortcut"]) as HTMLButtonElement;
	const errorText = el("p", { class: "error-text" }, []) as HTMLParagraphElement;
	errorText.style.display = "none";
	const successText = el("p", { class: "hint" }, []) as HTMLParagraphElement;
	successText.style.display = "none";

	container.append(
		el("p", {}, [
			"Reads eight metrics (calories, protein, carbs, fat, water, sodium, weight, body fat %) out of Apple Health " +
				"for the last 3 days and POSTs one JSON body per day to your ingest endpoint — built entirely in your " +
				"browser, byte-identical in structure to the ",
			el("a", { href: SHORTCUT_DOCS_URL, target: "_blank", rel: "noreferrer" }, ["python generator"]),
			".",
		]),
		fields,
		el("div", { class: "btn-row" }, [generateBtn]),
		errorText,
		successText,
		el("h3", {}, ["1. Install it on your iPhone"]),
		installSteps(),
		el("h3", {}, ["2. Turn on the daily automation"]),
		automationSteps(),
	);

	generateBtn.addEventListener("click", () => {
		errorText.style.display = "none";
		successText.style.display = "none";
		const url = urlInput.value.trim();
		const key = keyInput.value.trim();
		if (!url || !key) {
			errorText.textContent = "Enter your ingest URL and key first.";
			errorText.style.display = "";
			return;
		}
		try {
			const bytes = buildShortcut(url, key);
			const blob = new Blob([bytes], { type: "application/octet-stream" });
			const objectUrl = URL.createObjectURL(blob);
			const link = el("a", { href: objectUrl, download: SHORTCUT_FILE_NAME });
			document.body.append(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(objectUrl);

			setConfig({ ingestUrl: url, ingestKey: key });
			successText.textContent = `Downloaded ${SHORTCUT_FILE_NAME} — follow the install steps below.`;
			successText.style.display = "";
		} catch (e) {
			errorText.textContent = e instanceof Error ? e.message : String(e);
			errorText.style.display = "";
		}
	});
}

function mountPythonFallback(container: HTMLElement): void {
	container.append(
		el("p", {}, [
			"Generate the Shortcut with the bundled python script — follow ",
			el("a", { href: SHORTCUT_DOCS_URL, target: "_blank", rel: "noreferrer" }, ["docs/shortcut.md"]),
			".",
		]),
	);

	const config = getConfig();
	if (config.ingestUrl) {
		container.append(
			el("p", { class: "hint" }, [
				"Once you're following the doc: your ingest URL is ",
				el("code", {}, [config.ingestUrl]),
				" — use the ingest key from the Import panel above as the Shortcut's header value.",
			]),
		);
	}

	container.append(el("h3", {}, ["Install it on your iPhone"]), installSteps(), el("h3", {}, ["Turn on the daily automation"]), automationSteps());
}

export function mountShortcutPanel(container: HTMLElement): void {
	container.textContent = "";
	if (BROWSER_SHORTCUT_ENABLED) mountBrowserBuilder(container);
	else mountPythonFallback(container);
}
