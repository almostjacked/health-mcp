// Shortcut panel: DOM assembly + event wiring only. The action graph and
// plist byte format live in ../shortcut/plist.ts, golden-tested against
// scripts/generate_shortcut.py — this file wires the primary
// download-the-signed-file flow plus a collapsed "Advanced" per-user
// generator fallback.
//
// Primary flow (no per-user signing!): ONE canonical shortcut, signed once
// per release (docs/RESIGNING.md — CI signing is unavailable, verified;
// the maintainer runs `shortcuts sign -m anyone` by hand after any
// plist.ts change and commits web/assets/sync-health-data-signed.shortcut).
// Every user downloads the same signed bytes; iOS's Import Questions
// mechanism prompts for the ingest URL/key at import time without
// invalidating the signature. Users just paste in the two values shown
// below when prompted — no Mac, no Terminal, no signing step required.
import { buildShortcut } from "../shortcut/plist.js";
import { getConfig, setConfig, CONFIG_CHANGED_EVENT } from "../state.js";

const SHORTCUT_DOCS_URL = "https://github.com/almostjacked/health-mcp/blob/main/docs/shortcut.md";
const RESIGNING_DOCS_URL = "https://github.com/almostjacked/health-mcp/blob/main/docs/RESIGNING.md";
const SIGNED_ASSET_PATH = "./sync-health-data-signed.shortcut";
const SIGNED_ASSET_FILENAME = "sync-health-data-signed.shortcut";
const CUSTOM_SHORTCUT_FILE_NAME = "sync-health-data.shortcut";

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

/** Copy-to-clipboard button — same pattern as ../panels/provision.ts's
 * copyButton, duplicated locally to keep these panels independently
 * readable (neither exports across panel files). */
function copyButton(getText: () => string, label = "Copy"): HTMLButtonElement {
	const btn = el("button", { type: "button", class: "btn secondary" }, [label]) as HTMLButtonElement;
	btn.addEventListener("click", () => {
		const text = getText();
		if (!navigator.clipboard?.writeText) {
			btn.textContent = "Copy failed — select and copy manually";
			return;
		}
		navigator.clipboard
			.writeText(text)
			.then(() => {
				btn.textContent = "Copied!";
				setTimeout(() => {
					btn.textContent = label;
				}, 2000);
			})
			.catch(() => {
				btn.textContent = "Copy failed — select and copy manually";
			});
	});
	return btn;
}

/** Primary-path install steps — Mac-first (easiest, field-tested): open the
 * signed file in Shortcuts on the Mac, answer the two prompts with the copy
 * buttons on this very page, and iCloud sync delivers it to the iPhone.
 * No signing step — the file is already signed. */
function primaryInstallSteps(): HTMLOListElement {
	return el("ol", { class: "install-steps" }, [
		el("li", {}, [
			el("strong", {}, ["On this Mac"]),
			": open the downloaded ",
			el("code", {}, [SIGNED_ASSET_FILENAME]),
			" (double-click) — it opens in the Shortcuts app's import screen. Click ",
			el("strong", {}, ["Add Shortcut"]),
			".",
		]),
		el("li", {}, [
			"You'll be prompted for two values during import — ",
			el("strong", {}, ["your ingest URL"]),
			" and ",
			el("strong", {}, ["your ingest key"]),
			". Copy each from this page (buttons above) and paste — easiest done here on the Mac, side by side.",
		]),
		el("li", {}, [
			"Wait a moment: iCloud syncs the shortcut to your iPhone automatically (Shortcuts app, same Apple ID). ",
			"No Mac? Backup path: get the file to the phone (AirDrop/Safari) and paste the two values into the prompts " +
				"there — opening this page on the phone makes copying easier, though you'll need to re-enter your URL/key fields.",
		]),
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

/** Advanced-path install steps: kept verbatim from the original per-user
 * flow, including the signing step users no longer need for the primary
 * path but which the custom-build path (Advanced section) still requires. */
function advancedInstallSteps(): HTMLOListElement {
	return el("ol", { class: "install-steps" }, [
		el("li", {}, [
			el("strong", {}, ["Sign the file (required — iOS refuses unsigned shortcuts). "]),
			"On a Mac, in Terminal:",
			el("pre", { class: "code-block" }, [
				el("code", {}, ["shortcuts sign -m anyone -i sync-health-data.shortcut -o sync-health-data-signed.shortcut"]),
			]),
			"(No Mac? Signing needs one — borrow a friend's for this single command; the signed file works forever.)",
		]),
		el("li", {}, [
			"Get the ",
			el("code", {}, ["signed"]),
			" file onto your iPhone — AirDrop from the Mac, or upload it somewhere and open the link in Safari on the phone.",
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

/** Final journey nudge shared by both Shortcut render paths: once the daily
 * sync is wired up, the only step left is adding the connector to claude.ai —
 * reminds the reader of their connector URL and flags the one transient
 * claude.ai error worth not panicking over. Mounted panels never remount, so
 * this listens for CONFIG_CHANGED_EVENT the same way the URL/key fields
 * above do — Provision may not have produced a connector URL yet at initial
 * mount (the three panels all mount at page load, before any step runs). */
function connectClaudeNudge(): HTMLParagraphElement {
	const nudge = el("p", { class: "next-step" }, []) as HTMLParagraphElement;

	function render(connectorUrl: string | undefined): void {
		nudge.textContent = "";
		const body: Array<Node | string> = [
			el("strong", {}, ["Finally:"]),
			" connect Claude — claude.ai → Settings → Connectors → Add custom connector",
		];
		body.push(connectorUrl ? ", paste in your connector URL:" : ", paste in the connector URL from step 1.");
		nudge.append(...body);
		if (connectorUrl) nudge.append(el("pre", { class: "wizard-command" }, [connectorUrl]));
		nudge.append(
			el("span", { class: "hint" }, [
				' If it fails with "Couldn\'t register with [name]\'s sign-in service", that\'s a transient claude.ai ' +
					"hiccup — just try adding it again.",
			]),
		);
	}

	render(getConfig().connectorUrl);
	window.addEventListener(CONFIG_CHANGED_EVENT, () => render(getConfig().connectorUrl));
	return nudge;
}

/** URL/key fields shared by the primary and advanced flows — prefilled from
 * state, editable, with copy buttons. `onChange` is called (trimmed values)
 * on every input so each mount point can decide what to persist/enable. */
function credentialFields(
	idPrefix: string,
	onChange: (url: string, key: string) => void,
): { fields: HTMLDivElement; urlInput: HTMLInputElement; keyInput: HTMLInputElement } {
	const config = getConfig();
	const urlInput = el("input", {
		type: "text",
		id: `${idPrefix}-url`,
		placeholder: "https://<ref>.supabase.co/functions/v1/health-ingest",
	}) as HTMLInputElement;
	const keyInput = el("input", {
		type: "password",
		id: `${idPrefix}-key`,
		autocomplete: "off",
		placeholder: "INGEST_KEY",
	}) as HTMLInputElement;
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
		// Deliberately does NOT call onChange here: these values just came FROM
		// config (that's what CONFIG_CHANGED_EVENT means), so re-persisting them
		// would be a no-op write that re-fires the same event — setConfig always
		// calls notifyChange unconditionally (see ../state.ts), so a naive
		// onChange-on-every-sync here is a synchronous infinite loop, not a
		// no-op (verified: it throws "Maximum call stack size exceeded"). Only
		// real user edits (the "input" listeners below) should ever persist.
	});

	const fire = (): void => onChange(urlInput.value.trim(), keyInput.value.trim());
	urlInput.addEventListener("input", fire);
	keyInput.addEventListener("input", fire);

	const fields = el("div", {}, [
		el("div", { class: "field" }, [
			el("label", { for: `${idPrefix}-url` }, ["Ingest URL"]),
			el("div", { class: "btn-row" }, [urlInput, copyButton(() => urlInput.value, "Copy")]),
		]),
		el("div", { class: "field" }, [
			el("label", { for: `${idPrefix}-key` }, ["Ingest key"]),
			el("div", { class: "btn-row" }, [keyInput, copyButton(() => keyInput.value, "Copy")]),
		]),
	]) as HTMLDivElement;

	return { fields, urlInput, keyInput };
}

/** HEAD-checks that the signed canonical asset actually shipped with this
 * build — web/scripts/build.mjs tolerates web/assets/ being empty, so a
 * build made before the maintainer last ran the resigning one-liner (see
 * docs/RESIGNING.md) won't have it. Never throws: any failure (network,
 * non-2xx, method not allowed) is treated as "missing" so the download
 * button degrades to a clear explanation instead of a broken click. */
async function signedAssetAvailable(): Promise<boolean> {
	try {
		const res = await fetch(SIGNED_ASSET_PATH, { method: "HEAD" });
		return res.ok;
	} catch {
		return false;
	}
}

function mountAdvancedSection(container: HTMLElement): void {
	const details = el("details", { class: "advanced-section" }, []) as HTMLDetailsElement;
	details.append(el("summary", {}, ["Advanced: bake values into a custom build"]));

	const body = el("div", { class: "advanced-body" }, [
		el("p", {}, [
			"Prefer a shortcut with your URL/key baked in (no import prompts) instead of the signed canonical file above? " +
				"Build one here — same action graph, byte-identical in structure to the ",
			el("a", { href: SHORTCUT_DOCS_URL, target: "_blank", rel: "noreferrer" }, ["python generator"]),
			" — but ",
			el("strong", {}, ["you'll need to sign it yourself"]),
			" (a Mac + one Terminal command; iOS refuses unsigned shortcuts). If you'd rather skip that, use the " +
				"primary download above instead.",
		]),
	]);

	const { fields, urlInput, keyInput } = credentialFields("adv-sc", () => {});
	const generateBtn = el("button", { type: "button", class: "btn" }, ["Generate Shortcut"]) as HTMLButtonElement;
	const errorText = el("p", { class: "error-text" }, []) as HTMLParagraphElement;
	errorText.style.display = "none";
	const successText = el("p", { class: "hint" }, []) as HTMLParagraphElement;
	successText.style.display = "none";

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
			const link = el("a", { href: objectUrl, download: CUSTOM_SHORTCUT_FILE_NAME });
			document.body.append(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(objectUrl);

			setConfig({ ingestUrl: url, ingestKey: key });
			successText.textContent = `Downloaded ${CUSTOM_SHORTCUT_FILE_NAME} — follow the install steps below (this copy still needs signing).`;
			successText.style.display = "";
		} catch (e) {
			errorText.textContent = e instanceof Error ? e.message : String(e);
			errorText.style.display = "";
		}
	});

	body.append(
		fields,
		el("div", { class: "btn-row" }, [generateBtn]),
		errorText,
		successText,
		el("h3", {}, ["Install it on your iPhone"]),
		advancedInstallSteps(),
	);
	details.append(body);
	container.append(details);
}

export function mountShortcutPanel(container: HTMLElement): void {
	container.textContent = "";

	const { fields } = credentialFields("sc", (url, key) => {
		if (url || key) setConfig({ ...(url ? { ingestUrl: url } : {}), ...(key ? { ingestKey: key } : {}) });
	});

	const downloadBtn = el("a", { href: SIGNED_ASSET_PATH, download: SIGNED_ASSET_FILENAME, class: "btn" }, [
		"Download the shortcut",
	]) as HTMLAnchorElement;
	const assetNotice = el("p", { class: "error-text" }, []) as HTMLParagraphElement;
	assetNotice.style.display = "none";

	container.append(
		el("p", {}, [
			"One shortcut, signed once — download it, then answer two prompts during import (your ingest URL and key). " +
				"No signing step for you: iOS's Import Questions feature fills those two values in without invalidating " +
				"Apple's signature. Reads eight metrics (calories, protein, carbs, fat, water, sodium, weight, body fat %) " +
				"out of Apple Health for the last 3 days and POSTs one JSON body per day to your ingest endpoint.",
		]),
		fields,
		el("p", { class: "hint" }, [
			"iOS will ask for these two values when you import — paste them into the prompts (use the Copy buttons above).",
		]),
		el("div", { class: "btn-row" }, [downloadBtn]),
		assetNotice,
		el("h3", {}, ["1. Install it on your iPhone"]),
		primaryInstallSteps(),
		el("h3", {}, ["2. Turn on the daily automation"]),
		automationSteps(),
		connectClaudeNudge(),
	);

	mountAdvancedSection(container);

	void signedAssetAvailable().then((ok) => {
		if (ok) return;
		downloadBtn.removeAttribute("href");
		downloadBtn.setAttribute("aria-disabled", "true");
		downloadBtn.classList.add("btn-disabled");
		downloadBtn.addEventListener("click", (e) => e.preventDefault());
		assetNotice.textContent = "";
		assetNotice.append(
			"The pre-signed shortcut isn't available on this build yet — use the \"Advanced: bake values into a custom " +
				"build\" section below, or (maintainer) run the resigning steps in ",
			el("a", { href: RESIGNING_DOCS_URL, target: "_blank", rel: "noreferrer" }, ["docs/RESIGNING.md"]),
			".",
		);
		assetNotice.style.display = "";
	});
}
