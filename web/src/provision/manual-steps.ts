// Pure data + small helpers for the manual (Supabase dashboard) path of the
// instructions-mode Provision panel (panels/provision.ts, rendered while
// BROWSER_PROVISIONING_ENABLED is false). Step order, dashboard deep links,
// and the connector-URL preview math live here so they're unit-testable
// without a DOM — the panel only wires this data to elements and click
// handlers (see its file banner).
//
// Dashboard URL shapes: `/dashboard/project/_/...` is Supabase's own
// "whichever project you have selected" convention — used the same way
// throughout Supabase's docs/quickstarts (e.g. https://supabase.com/dashboard/project/_/sql/new
// resolves to the SQL editor of your currently-selected project, or prompts
// you to pick one if none is selected yet). Verified 2026-07-29.
import type { SetupConfig } from "../state.js";
import { connectorUrl } from "./steps.js";

export const DASHBOARD_NEW_PROJECT_URL = "https://supabase.com/dashboard/new";
export const DASHBOARD_SQL_NEW_URL = "https://supabase.com/dashboard/project/_/sql/new";
export const DASHBOARD_FUNCTIONS_URL = "https://supabase.com/dashboard/project/_/functions";
export const DASHBOARD_FUNCTION_SECRETS_URL = "https://supabase.com/dashboard/project/_/settings/functions";

export interface ManualStep {
	id: string;
	number: number;
	title: string;
	/** Deep link opening the exact dashboard screen this step needs, in a new
	 * tab — absent only for the "connector" step, which has nothing to open
	 * (it's built entirely from the ref/token you already have). */
	href?: string;
	linkLabel?: string;
	note?: string;
	/** Present when this step has a paste-able artifact to copy — a same-origin
	 * path the panel fetches (never bundled into main.js; see loadProvisionInputs). */
	fetchUrl?: string;
	copyLabel?: string;
	/** "secrets" step only: any MCP_TOKEN/INGEST_KEY already minted this session,
	 * so re-opening the panel shows them instead of a blank "Generate values". */
	secretsPrefill?: { mcpToken: string; ingestKey: string };
	/** "connector" step only: initial field values + a live preview computed from `config`. */
	connectorPrefill?: { ref: string; mcpToken: string; preview?: string };
}

/** Builds the connector URL preview for step 6, or `undefined` when either
 * input is still empty. Pulled out so the panel and its tests share exactly
 * one code path with ./steps.js's `connectorUrl` (also reused, unmodified,
 * for the real value once both inputs are filled). */
export function previewConnectorUrl(ref: string, mcpToken: string): string | undefined {
	const trimmedRef = ref.trim();
	const trimmedToken = mcpToken.trim();
	if (!trimmedRef || !trimmedToken) return undefined;
	return connectorUrl(trimmedRef, trimmedToken);
}

/** The six manual-path steps, in order, prefilled from whatever `config`
 * already holds (e.g. a token minted earlier this session). Steps 1-4 are
 * uniform "open a deep link, optionally copy a paste-able artifact" steps;
 * 5 and 6 are interactive (minting secrets, building the connector URL) —
 * their actual logic is `randomToken` (./steps.ts, reused unmodified by the
 * panel) and `previewConnectorUrl`/`connectorUrl` above, not duplicated here.
 */
export function manualSteps(config: SetupConfig = {}): ManualStep[] {
	return [
		{
			id: "create-project",
			number: 1,
			title: "Create a Supabase project",
			href: DASHBOARD_NEW_PROJECT_URL,
			linkLabel: "Open dashboard → New project",
			note: "Free tier allows 2 active projects per organization.",
		},
		{
			id: "sql-editor",
			number: 2,
			title: "Apply the database schema",
			href: DASHBOARD_SQL_NEW_URL,
			linkLabel: "Open SQL editor",
			note: "The /_/ in this link routes to whichever project you currently have selected in the dashboard.",
			fetchUrl: "./setup.sql",
			copyLabel: "Copy setup.sql",
		},
		{
			id: "deploy-health-mcp",
			number: 3,
			title: 'Create edge function "health-mcp"',
			href: DASHBOARD_FUNCTIONS_URL,
			linkLabel: "Open Edge Functions",
			note: 'Name it exactly "health-mcp" and turn off "Enforce JWT verification" before deploying — the function does its own auth.',
			fetchUrl: "./functions/health-mcp.ts",
			copyLabel: "Copy health-mcp.ts",
		},
		{
			id: "deploy-health-ingest",
			number: 4,
			title: 'Create edge function "health-ingest"',
			href: DASHBOARD_FUNCTIONS_URL,
			linkLabel: "Open Edge Functions",
			note: 'Name it exactly "health-ingest" and turn off "Enforce JWT verification" before deploying — the function does its own auth.',
			fetchUrl: "./functions/health-ingest.ts",
			copyLabel: "Copy health-ingest.ts",
		},
		{
			id: "secrets",
			number: 5,
			title: "Add your secrets",
			href: DASHBOARD_FUNCTION_SECRETS_URL,
			linkLabel: "Open Function Secrets",
			note: "Keep both values somewhere safe — the connector URL built in the next step embeds MCP_TOKEN, so you'll need it again if you lose it.",
			secretsPrefill: config.mcpToken && config.ingestKey ? { mcpToken: config.mcpToken, ingestKey: config.ingestKey } : undefined,
		},
		{
			id: "connector",
			number: 6,
			title: "Build your connector URL",
			note: "This is the URL to add as a custom connector in claude.ai / Claude Desktop.",
			connectorPrefill: {
				ref: config.ref ?? "",
				mcpToken: config.mcpToken ?? "",
				preview: previewConnectorUrl(config.ref ?? "", config.mcpToken ?? ""),
			},
		},
	];
}
