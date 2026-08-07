// Provision panel: DOM assembly + event wiring only. Every decision (what a
// step means, how a result maps into persisted config, what the connector/
// ingest URLs are) lives in ../provision/{api,steps}.ts and ../state.ts,
// which carry their own tests — this file just renders form state, hands
// values to those modules, and renders what comes back.
import { MgmtClient } from "../provision/api.js";
import { provisionAll, mergeProvisionResult, randomToken, ingestUrl } from "../provision/steps.js";
import type { ProvisionMode, ProvisionOptions, ProvisionStep } from "../provision/steps.js";
import { manualSteps, previewConnectorUrl } from "../provision/manual-steps.js";
import type { ManualStep } from "../provision/manual-steps.js";
import { getConfig, setConfig, setAccessToken, getAccessToken, clearAccessToken, forgetAll } from "../state.js";
import type { SetupConfig } from "../state.js";

// api.supabase.com sends no Access-Control-Allow-Origin (verified 2026-07-29)
// — browser calls are blocked and a proxy would violate zero-custody. Flip if
// Supabase ever opens CORS.
const BROWSER_PROVISIONING_ENABLED = false;

const SETUP_MANUAL_URL = "https://github.com/almostjacked/health-mcp/blob/main/docs/setup-manual.md";
const WIZARD_COMMAND = "npx @almostjacked/health-mcp setup";

const TOKEN_DASHBOARD_URL = "https://supabase.com/dashboard/account/tokens";
const REGIONS: Array<{ value: string; label: string }> = [
	{ value: "us-east-1", label: "US East (N. Virginia)" },
	{ value: "us-west-2", label: "US West (Oregon)" },
	{ value: "eu-central-1", label: "EU Central (Frankfurt)" },
	{ value: "eu-west-2", label: "EU West (London)" },
	{ value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
];
const DEFAULT_REGION = "us-east-1";
const DEFAULT_NAME = "health-mcp";

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

/** Fetches the three same-origin provisioning inputs (bundled edge functions
 * + the schema SQL) that `web/scripts/build.mjs` copies into dist/ next to
 * index.html — never bundled into main.js itself, since the function sources
 * are large, dependency-free single files meant to be pasted verbatim into
 * the Supabase dashboard as a manual fallback too. */
async function loadProvisionInputs(): Promise<{
	setupSql: string;
	functionSources: { "health-mcp": string; "health-ingest": string };
}> {
	const [setupSql, healthMcp, healthIngest] = await Promise.all([
		fetch("./setup.sql").then((r) => {
			if (!r.ok) throw new Error(`could not load ./setup.sql (HTTP ${r.status})`);
			return r.text();
		}),
		fetch("./functions/health-mcp.ts").then((r) => {
			if (!r.ok) throw new Error(`could not load ./functions/health-mcp.ts (HTTP ${r.status})`);
			return r.text();
		}),
		fetch("./functions/health-ingest.ts").then((r) => {
			if (!r.ok) throw new Error(`could not load ./functions/health-ingest.ts (HTTP ${r.status})`);
			return r.text();
		}),
	]);
	return { setupSql, functionSources: { "health-mcp": healthMcp, "health-ingest": healthIngest } };
}

/** Copy-to-clipboard button: writes `getText()` on click (read lazily, since
 * the wizard command is static but this same helper is reused for the ingest
 * key which the caller re-reads on every click in case it changed). Falls
 * back to a visible error rather than throwing if the Clipboard API is
 * unavailable (e.g. non-secure context) or the write is rejected. */
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

/** Copy-to-clipboard button for the manual-path artifacts (setup.sql, the two
 * function sources): fetches `url` same-origin on click — same files
 * `loadProvisionInputs` above pulls for the in-browser wizard — and writes
 * the response body to the clipboard. Never bundled into main.js; see that
 * function's banner for why these are fetched rather than inlined. */
function copyFetchButton(url: string, label: string): HTMLButtonElement {
	const btn = el("button", { type: "button", class: "btn secondary" }, [label]) as HTMLButtonElement;
	btn.addEventListener("click", () => {
		if (!navigator.clipboard?.writeText) {
			btn.textContent = "Copy failed — open the link above and copy manually";
			return;
		}
		btn.disabled = true;
		btn.textContent = "Copying…";
		fetch(url)
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.text();
			})
			.then((text) => navigator.clipboard.writeText(text))
			.then(() => {
				btn.textContent = "Copied!";
				setTimeout(() => {
					btn.textContent = label;
				}, 2000);
			})
			.catch(() => {
				btn.textContent = "Copy failed — open the link above and copy manually";
			})
			.finally(() => {
				btn.disabled = false;
			});
	});
	return btn;
}

/** Wiring shared between the manual path's step 5 (mint MCP_TOKEN/INGEST_KEY)
 * and step 6 (build + persist the connector URL) — step 6 owns the single
 * `setConfig` write, but needs the ingest key step 5 minted, and step 5 needs
 * to push its freshly-minted MCP_TOKEN into step 6's input. */
interface ConnectorWiring {
	refInput: HTMLInputElement;
	mcpTokenInput: HTMLInputElement;
	onMint: (mcpToken: string, ingestKey: string) => void;
}

/** Renders one manual-path step. Steps 1-4 are uniform — a deep link plus,
 * where applicable, a button that fetches and copies a paste-able artifact.
 * Steps 5 and 6 are interactive and rendered specially, but their actual
 * logic (minting tokens, building the connector URL) is `randomToken`/
 * `previewConnectorUrl` from ../provision/manual-steps.js, not anything
 * defined here. */
function renderManualStep(step: ManualStep, wiring: ConnectorWiring): HTMLLIElement {
	const body: Array<Node | string> = [el("strong", {}, [step.title])];
	if (step.note) body.push(el("p", { class: "hint" }, [step.note]));

	if (step.id === "secrets") {
		const mcpOut = el("code", { class: "generated-value" }, [step.secretsPrefill?.mcpToken ?? "—"]);
		const ingestOut = el("code", { class: "generated-value" }, [step.secretsPrefill?.ingestKey ?? "—"]);
		const mcpCopy = copyButton(() => mcpOut.textContent ?? "", "Copy MCP_TOKEN");
		const ingestCopy = copyButton(() => ingestOut.textContent ?? "", "Copy INGEST_KEY");
		mcpCopy.disabled = !step.secretsPrefill;
		ingestCopy.disabled = !step.secretsPrefill;
		const generateBtn = el("button", { type: "button", class: "btn" }, [
			step.secretsPrefill ? "Regenerate values" : "Generate values",
		]) as HTMLButtonElement;
		generateBtn.addEventListener("click", () => {
			const mcpToken = randomToken();
			const ingestKey = randomToken();
			mcpOut.textContent = mcpToken;
			ingestOut.textContent = ingestKey;
			mcpCopy.disabled = false;
			ingestCopy.disabled = false;
			generateBtn.textContent = "Regenerate values";
			wiring.onMint(mcpToken, ingestKey);
		});
		body.push(
			// Every step but "connector" carries href/linkLabel — see ManualStep's banner.
			el("div", { class: "btn-row" }, [
				el("a", { href: step.href!, target: "_blank", rel: "noreferrer", class: "btn secondary" }, [step.linkLabel!]),
				generateBtn,
			]),
			el("div", { class: "secret-row" }, [el("span", { class: "secret-label" }, ["MCP_TOKEN"]), mcpOut, mcpCopy]),
			el("div", { class: "secret-row" }, [el("span", { class: "secret-label" }, ["INGEST_KEY"]), ingestOut, ingestCopy]),
			el("p", { class: "note" }, [
				el("strong", {}, ["Store these in a password manager."]),
				" The connector URL embeds your MCP token (treat the whole URL as a secret), and secret values cannot be read back from Supabase later — losing them means rotating them.",
			]),
		);
		return el("li", { class: "manual-step" }, body);
	}

	if (step.id === "connector") {
		const preview = step.connectorPrefill?.preview;
		const connectorPreview = el("pre", { class: "wizard-command" }, [
			preview ?? "Fill in both fields above to build your connector URL.",
		]) as HTMLPreElement;
		const copyConnectorBtn = copyButton(() => connectorPreview.textContent ?? "", "Copy connector URL");
		copyConnectorBtn.disabled = !preview;

		function refresh(): void {
			const ref = wiring.refInput.value.trim();
			const mcpToken = wiring.mcpTokenInput.value.trim();
			const next = previewConnectorUrl(ref, mcpToken);
			connectorPreview.textContent = next ?? "Fill in both fields above to build your connector URL.";
			copyConnectorBtn.disabled = !next;
		}
		wiring.refInput.addEventListener("input", refresh);
		wiring.mcpTokenInput.addEventListener("input", refresh);

		body.push(
			el("div", { class: "field" }, [el("label", { for: "manual-ref" }, ["Project ref"]), wiring.refInput]),
			el("div", { class: "field" }, [el("label", { for: "manual-mcp-token" }, ["MCP_TOKEN"]), wiring.mcpTokenInput]),
			el("div", { class: "btn-row" }, [connectorPreview, copyConnectorBtn]),
		);
		return el("li", { class: "manual-step" }, body);
	}

	// Only reached for steps 1-4, which always carry href/linkLabel — see ManualStep's banner.
	const linkRow: Array<Node | string> = [
		el("a", { href: step.href!, target: "_blank", rel: "noreferrer", class: "btn secondary" }, [step.linkLabel!]),
	];
	if (step.fetchUrl && step.copyLabel) linkRow.push(copyFetchButton(step.fetchUrl, step.copyLabel));
	body.push(el("div", { class: "btn-row" }, linkRow));
	return el("li", { class: "manual-step" }, body);
}

/** Builds the manual path's full numbered step list (1-6), wiring step 5's
 * minted secrets into step 6's connector-URL builder and persisting the
 * result to shared state via `setConfig` on every change to either of step
 * 6's inputs — so Import/Shortcut below pre-fill without a separate "Save"
 * step. All step data/URLs/token-minting logic lives in
 * ../provision/manual-steps.js; this only wires DOM to it. */
function renderManualSteps(): HTMLOListElement {
	const steps = manualSteps(getConfig());
	const connectorStep = steps[5];

	const refInput = el("input", {
		type: "text",
		id: "manual-ref",
		placeholder: "e.g. abcdefghijklmnopqrst",
		value: connectorStep.connectorPrefill?.ref ?? "",
	}) as HTMLInputElement;
	const mcpTokenInput = el("input", {
		type: "text",
		id: "manual-mcp-token",
		placeholder: "MCP_TOKEN",
		value: connectorStep.connectorPrefill?.mcpToken ?? "",
	}) as HTMLInputElement;

	let mintedIngestKey: string | undefined = getConfig().ingestKey;

	function persist(): void {
		const ref = refInput.value.trim();
		const mcpToken = mcpTokenInput.value.trim();
		const partial: Partial<SetupConfig> = {};
		if (ref) {
			partial.ref = ref;
			partial.ingestUrl = ingestUrl(ref);
		}
		if (mcpToken) partial.mcpToken = mcpToken;
		if (mintedIngestKey) partial.ingestKey = mintedIngestKey;
		const preview = previewConnectorUrl(ref, mcpToken);
		if (preview) partial.connectorUrl = preview;
		if (Object.keys(partial).length > 0) setConfig(partial);
	}
	refInput.addEventListener("input", persist);
	mcpTokenInput.addEventListener("input", persist);

	const wiring: ConnectorWiring = {
		refInput,
		mcpTokenInput,
		onMint: (mcpToken, ingestKey) => {
			mintedIngestKey = ingestKey;
			mcpTokenInput.value = mcpToken;
			// Fires both this function's own `persist` listener and the connector
			// step's preview-refresh listener — same path a manual keystroke takes.
			mcpTokenInput.dispatchEvent(new Event("input"));
		},
	};

	const list = el(
		"ol",
		{ class: "manual-steps" },
		steps.map((step) => renderManualStep(step, wiring)),
	) as HTMLOListElement;

	// A prior session already had both values — persist immediately so the
	// derived ingestUrl/connectorUrl are in state without waiting on input.
	if (connectorStep.connectorPrefill?.preview) persist();

	return list;
}

/** Instructions-mode Provision panel, rendered while
 * `BROWSER_PROVISIONING_ENABLED` is false: api.supabase.com sends no
 * Access-Control-Allow-Origin, so the Management API calls the token-flow
 * code below relies on simply cannot succeed from a browser tab, and a
 * server-side proxy would put us in custody of the user's Supabase access
 * token — the one thing this project promises never to hold. Instead this
 * renders two ways to get the same end state (a provisioned project +
 * connector/ingest URLs + secrets): the one-command wizard, or a numbered
 * manual-dashboard path whose every step deep-links straight to the dashboard
 * screen it needs and, where there's an artifact to paste, copies it for you —
 * writing straight into shared state as you go, so Import/Shortcut below
 * pre-fill exactly as they would have after a successful in-browser run. */
function mountInstructionsPanel(container: HTMLElement): void {
	const wizardBlock = el("div", { class: "field" }, [
		el("p", { class: "hint" }, ["Run this in a terminal (Node ≥ 18, free Supabase account):"]),
		el("div", { class: "btn-row" }, [el("pre", { class: "wizard-command" }, [el("code", {}, [WIZARD_COMMAND])]), copyButton(() => WIZARD_COMMAND)]),
		el("p", { class: "hint" }, [
			"Interactive by default. For scripting/CI, add flags: ",
			el("code", {}, ["--new --name <name> --region <region> [--org-index N]"]),
			" to create a project, or ",
			el("code", {}, ["--existing <project-ref>"]),
			" to reuse one.",
		]),
	]);

	const writtenGuideLink = el("p", { class: "hint" }, [
		"Prefer a plain written walkthrough? See ",
		el("a", { href: SETUP_MANUAL_URL, target: "_blank", rel: "noreferrer" }, ["docs/setup-manual.md"]),
		".",
	]);

	container.append(
		el("p", { class: "notice" }, [
			"Supabase's Management API (api.supabase.com) doesn't send CORS headers, so this page can't provision a " +
				"project for you directly — and proxying your access token through a server would mean trusting us with " +
				"it, which this project is built to avoid. Use one of the two options below.",
		]),
		el("h3", {}, ["Option 1: one-command wizard (recommended, fastest)"]),
		wizardBlock,
		el("h3", {}, ["Option 2: manual dashboard (~5 minutes, point-and-click)"]),
		renderManualSteps(),
		writtenGuideLink,
		el("p", { class: "next-step" }, [
			el("strong", {}, ["Next:"]),
			" load your history below.",
		]),
	);
}

function mountTokenFlowPanel(container: HTMLElement): void {
	container.textContent = "";

	// ---- token field ----
	const tokenInput = el("input", { type: "password", id: "sb-token", autocomplete: "off", placeholder: "sbp_…" }) as HTMLInputElement;
	const forgetBtn = el("button", { type: "button", class: "btn secondary" }, ["Forget"]) as HTMLButtonElement;
	const tokenField = el("div", { class: "field" }, [
		el("label", { for: "sb-token" }, ["Supabase access token"]),
		tokenInput,
		el("p", { class: "hint" }, [
			"Get one from your ",
			el("a", { href: TOKEN_DASHBOARD_URL, target: "_blank", rel: "noreferrer" }, ["Supabase dashboard"]),
			" (Account → Access Tokens).",
		]),
		el("div", { class: "notice" }, [
			"Kept in memory for this browser tab only — never written to disk or sent anywhere but api.supabase.com. " +
				"Gone on refresh, or click Forget to clear it (and everything below) right now.",
		]),
		el("div", { class: "btn-row" }, [forgetBtn]),
	]);

	// ---- mode ----
	let mode: ProvisionMode = "new";
	const modeNew = el("input", { type: "radio", name: "mode", value: "new", id: "mode-new", checked: "checked" }) as HTMLInputElement;
	const modeExisting = el("input", { type: "radio", name: "mode", value: "existing", id: "mode-existing" }) as HTMLInputElement;
	const modeRow = el("div", { class: "radio-group" }, [
		el("label", { class: "radio-row" }, [modeNew, "Create a new project"]),
		el("label", { class: "radio-row" }, [modeExisting, "Use an existing project"]),
	]);

	// ---- new-project fields ----
	const nameInput = el("input", { type: "text", id: "sb-name", value: DEFAULT_NAME }) as HTMLInputElement;
	const regionSelect = el(
		"select",
		{ id: "sb-region" },
		REGIONS.map((r) => el("option", { value: r.value, ...(r.value === DEFAULT_REGION ? { selected: "selected" } : {}) }, [r.label])),
	) as HTMLSelectElement;
	const orgSelect = el("select", { id: "sb-org", disabled: "disabled" }, [
		el("option", { value: "" }, ["Enter your access token above first"]),
	]) as HTMLSelectElement;
	const newFields = el("div", {}, [
		el("div", { class: "field" }, [el("label", { for: "sb-name" }, ["Project name"]), nameInput]),
		el("div", { class: "field" }, [el("label", { for: "sb-region" }, ["Region"]), regionSelect]),
		el("div", { class: "field" }, [
			el("label", { for: "sb-org" }, ["Organization"]),
			orgSelect,
			el("p", { class: "hint" }, ["Only needed if your account belongs to more than one organization."]),
		]),
	]);

	// ---- existing-project fields ----
	const refInput = el("input", { type: "text", id: "sb-ref", placeholder: "e.g. abcdefghijklmnopqrst" }) as HTMLInputElement;
	const keepSecretsInput = el("input", { type: "checkbox", id: "sb-keep-secrets", checked: "checked" }) as HTMLInputElement;
	const existingFields = el("div", {}, [
		el("div", { class: "field" }, [el("label", { for: "sb-ref" }, ["Project ref"]), refInput]),
		el("label", { class: "checkbox-row" }, [
			keepSecretsInput,
			"Keep existing secrets (don't rotate MCP_TOKEN / INGEST_KEY)",
		]),
		el("p", { class: "hint" }, [
			"Safe to leave checked when re-running this against a project you already set up — your existing connector " +
				"URL and Shortcut keep working. Uncheck only if you want to rotate both secrets.",
		]),
	]);
	existingFields.style.display = "none";

	// ---- action + log + results ----
	const provisionBtn = el("button", { type: "button", class: "btn" }, ["Provision"]) as HTMLButtonElement;
	const errorText = el("p", { class: "error-text" }, []) as HTMLParagraphElement;
	errorText.style.display = "none";
	const stepLog = el("ul", { class: "step-log" }, []) as HTMLUListElement;
	const results = el("div", { class: "results" }, []) as HTMLDivElement;
	results.style.display = "none";

	container.append(
		tokenField,
		modeRow,
		newFields,
		existingFields,
		el("div", { class: "btn-row" }, [provisionBtn]),
		errorText,
		stepLog,
		results,
	);

	// ---- behavior ----

	function setMode(next: ProvisionMode): void {
		mode = next;
		newFields.style.display = next === "new" ? "" : "none";
		existingFields.style.display = next === "existing" ? "" : "none";
		if (next === "new" && getAccessToken()) void refreshOrgs();
	}
	modeNew.addEventListener("change", () => setMode("new"));
	modeExisting.addEventListener("change", () => setMode("existing"));

	tokenInput.addEventListener("input", () => {
		const value = tokenInput.value.trim();
		if (value) setAccessToken(value);
		else clearAccessToken();
	});
	tokenInput.addEventListener("blur", () => {
		if (mode === "new" && getAccessToken()) void refreshOrgs();
	});

	let orgsRequestId = 0;
	async function refreshOrgs(): Promise<void> {
		const token = getAccessToken();
		const requestId = ++orgsRequestId;
		orgSelect.textContent = "";
		orgSelect.disabled = true;
		if (!token) {
			orgSelect.append(el("option", { value: "" }, ["Enter your access token above first"]));
			return;
		}
		orgSelect.append(el("option", { value: "" }, ["Loading organizations…"]));
		try {
			const orgs = await new MgmtClient(token).listOrgs();
			if (requestId !== orgsRequestId) return; // a newer request superseded this one
			orgSelect.textContent = "";
			if (orgs.length === 0) {
				orgSelect.append(el("option", { value: "" }, ["No organizations found — create one in the dashboard"]));
				return;
			}
			for (const org of orgs) {
				orgSelect.append(el("option", { value: org.slug }, [`${org.name} (${org.slug})`]));
			}
			orgSelect.disabled = false;
		} catch {
			if (requestId !== orgsRequestId) return;
			orgSelect.textContent = "";
			orgSelect.append(el("option", { value: "" }, ["Could not load organizations — check your token and try again"]));
		}
	}

	forgetBtn.addEventListener("click", () => {
		forgetAll();
		tokenInput.value = "";
		refInput.value = "";
		orgSelect.textContent = "";
		orgSelect.disabled = true;
		orgSelect.append(el("option", { value: "" }, ["Enter your access token above first"]));
		results.style.display = "none";
		results.textContent = "";
		stepLog.textContent = "";
		errorText.style.display = "none";
	});

	function renderStep(step: ProvisionStep): void {
		const item = el("li", { class: `step ${step.ok ? "ok" : "fail"}` }, [
			el("span", { class: "icon" }, [step.ok ? "✓" : "✗"]),
			el("strong", {}, [step.label]),
		]);
		if (step.detail) item.append(document.createTextNode(` — ${step.detail}`));
		if (step.fallbackText) item.append(el("span", { class: "fallback" }, [step.fallbackText]));
		stepLog.append(item);
	}

	function renderResults(): void {
		const config = getConfig();
		results.textContent = "";
		const rows: Array<[string, string]> = [];
		if (config.ref) rows.push(["Project ref", config.ref]);
		if (config.connectorUrl) rows.push(["Connector URL", config.connectorUrl]);
		if (config.ingestUrl) rows.push(["Ingest URL", config.ingestUrl]);
		if (config.ingestKey) rows.push(["Ingest key", config.ingestKey]);
		if (rows.length === 0) return;
		const dl = el(
			"dl",
			{ class: "kv" },
			rows.flatMap(([k, v]) => [el("dt", {}, [k]), el("dd", {}, [v])]),
		);
		results.append(dl);
		if (config.ref && !config.connectorUrl) {
			results.append(
				el("p", { class: "hint" }, [
					"No connector URL to show — this run kept your existing MCP_TOKEN secret. Check your notes from when " +
						"you first provisioned, or open the dashboard's Edge Functions → Secrets tab to view it.",
				]),
			);
		}
		results.append(el("p", { class: "next-step" }, [el("strong", {}, ["Next:"]), " load your history below."]));
		results.style.display = "";
	}

	provisionBtn.addEventListener("click", () => {
		void runProvision();
	});

	async function runProvision(): Promise<void> {
		errorText.style.display = "none";
		stepLog.textContent = "";
		results.style.display = "none";

		const token = getAccessToken();
		if (!token) {
			errorText.textContent = "Enter your Supabase access token above first.";
			errorText.style.display = "";
			return;
		}
		if (mode === "existing" && !refInput.value.trim()) {
			errorText.textContent = "Enter the project ref you want to use.";
			errorText.style.display = "";
			return;
		}

		provisionBtn.disabled = true;
		provisionBtn.textContent = "Provisioning…";
		try {
			const { setupSql, functionSources } = await loadProvisionInputs();

			const opts: ProvisionOptions = {
				mode,
				setupSql,
				functionSources,
				...(mode === "existing"
					? { ref: refInput.value.trim(), keepSecrets: keepSecretsInput.checked }
					: {
							name: nameInput.value.trim() || DEFAULT_NAME,
							region: regionSelect.value || DEFAULT_REGION,
							orgSlug: orgSelect.value || undefined,
							keepSecrets: false,
						}),
			};

			const client = new MgmtClient(token);
			const result = await provisionAll(client, opts, renderStep);
			const merged = mergeProvisionResult(getConfig(), result);
			setConfig(merged);
			renderResults();
		} catch (e) {
			errorText.textContent = e instanceof Error ? e.message : String(e);
			errorText.style.display = "";
		} finally {
			provisionBtn.disabled = false;
			provisionBtn.textContent = "Provision";
		}
	}

	// Initial render: fields for the default mode, and any prior results
	// (e.g. from earlier this session) already in state.
	setMode(mode);
	renderResults();
}

export function mountProvisionPanel(container: HTMLElement): void {
	container.textContent = "";
	if (BROWSER_PROVISIONING_ENABLED) mountTokenFlowPanel(container);
	else mountInstructionsPanel(container);
}
