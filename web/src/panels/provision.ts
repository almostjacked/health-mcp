// Provision panel: DOM assembly + event wiring only. Every decision (what a
// step means, how a result maps into persisted config, what the connector/
// ingest URLs are) lives in ../provision/{api,steps}.ts and ../state.ts,
// which carry their own tests — this file just renders form state, hands
// values to those modules, and renders what comes back.
import { MgmtClient } from "../provision/api.js";
import { provisionAll, mergeProvisionResult } from "../provision/steps.js";
import type { ProvisionMode, ProvisionOptions, ProvisionStep } from "../provision/steps.js";
import { getConfig, setConfig, setAccessToken, getAccessToken, clearAccessToken, forgetAll } from "../state.js";

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

export function mountProvisionPanel(container: HTMLElement): void {
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
