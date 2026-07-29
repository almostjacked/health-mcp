// Orchestrates the in-browser provisioning wizard against a `MgmtClient` — the browser
// equivalent of apps/mcp/src/setup.ts's `main()`, minus any terminal I/O: every step reports
// its outcome via `onStep` instead of `console.log`/`console.error`, and a step failing never
// throws past `provisionAll` — later steps still run wherever that's safe (mirrors setup.ts's
// "continue and print the dashboard fallback" discipline), except when a step blocks every
// step after it (no org, no project ref — there is nothing left to provision against).
import type { MgmtClient, ProjectSummary } from "./api.js";

export type ProvisionMode = "new" | "existing";

export interface ProvisionOptions {
	mode: ProvisionMode;
	/** Required when mode === "existing". */
	ref?: string;
	/** Used when mode === "new". Defaults to "health-mcp". */
	name?: string;
	/** Used when mode === "new". Required unless the caller already resolved a single org. */
	orgId?: string;
	/** Used when mode === "new". Defaults to "us-east-1". */
	region?: string;
	/** Contents of packages/core/setup.sql — applied via `runSql`. */
	setupSql: string;
	functionSources: {
		"health-mcp": string;
		"health-ingest": string;
	};
	/** When true, the secrets step is skipped entirely (existing MCP_TOKEN/INGEST_KEY are kept). */
	keepSecrets: boolean;
}

export interface ProvisionStep {
	id: string;
	label: string;
	ok: boolean;
	detail?: string;
	/** Present on failure — the exact manual dashboard fallback for this step. */
	fallbackText?: string;
}

export interface ProvisionResult {
	ref?: string;
	/** Present only when a new MCP_TOKEN was minted this run (i.e. !keepSecrets and it succeeded). */
	mcpToken?: string;
	/** Present only when a new INGEST_KEY was minted this run (i.e. !keepSecrets and it succeeded). */
	ingestKey?: string;
}

const PROVISION_POLL_INTERVAL_MS = 10_000;
const PROVISION_TIMEOUT_MS = 5 * 60_000;
const FUNCTION_SLUGS = ["health-mcp", "health-ingest"] as const;
const BASE64URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 48 url-safe chars — the browser-safe equivalent of setup.ts's `randomToken()` (which uses
 * node:crypto's `randomBytes`). Used for MCP_TOKEN, INGEST_KEY, and the generated db password.
 * Encodes by hand (rather than via `btoa`/`Buffer`) so it behaves identically in a browser and
 * in Node test runs. */
export function randomToken(): string {
	const bytes = new Uint8Array(36);
	crypto.getRandomValues(bytes);
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i];
		const b1 = bytes[i + 1];
		const b2 = bytes[i + 2];
		out += BASE64URL_CHARS[b0 >> 2];
		out += BASE64URL_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
		out += BASE64URL_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)];
		out += BASE64URL_CHARS[b2 & 0x3f];
	}
	return out;
}

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True iff `ref`'s entry in a `listProjects()` result reports a healthy/active status —
 * browser-side twin of setup.ts's `isProjectReady`. */
export function isProjectReady(projects: ProjectSummary[], ref: string): boolean {
	const entry = projects.find((p) => p.ref === ref);
	return entry !== undefined && entry.status.toUpperCase() === "ACTIVE_HEALTHY";
}

/** Polls `listProjects()` every 10s (up to 5 minutes) until `ref` reports ACTIVE_HEALTHY.
 * Fresh Supabase projects take 1-3 minutes to provision — without this wait, the
 * immediately-following schema/deploy calls would reliably fail into their manual fallbacks
 * on the happy path. Returns `false` on timeout; never throws (a transient `listProjects`
 * failure is treated as "not ready yet" and retried). */
async function waitForProjectReady(client: MgmtClient, ref: string): Promise<boolean> {
	const start = Date.now();
	for (;;) {
		let projects: ProjectSummary[] = [];
		try {
			projects = await client.listProjects();
		} catch {
			// transient — keep polling until the timeout
		}
		if (isProjectReady(projects, ref)) return true;
		if (Date.now() - start >= PROVISION_TIMEOUT_MS) return false;
		await sleep(PROVISION_POLL_INTERVAL_MS);
	}
}

const DASHBOARD = "https://supabase.com/dashboard";

/** Resolves (or creates) the project to provision into. Returns `null` — after reporting the
 * blocking step — when nothing downstream can proceed (no org, no ref, creation failed). */
async function resolveProject(client: MgmtClient, opts: ProvisionOptions, onStep: (step: ProvisionStep) => void): Promise<string | null> {
	if (opts.mode === "existing") {
		if (!opts.ref) {
			onStep({
				id: "project",
				label: "Use existing project",
				ok: false,
				detail: "No project ref provided",
				fallbackText: "Paste the project ref from your dashboard project URL and retry.",
			});
			return null;
		}
		onStep({ id: "project", label: "Use existing project", ok: true, detail: `Using project ${opts.ref}` });
		return opts.ref;
	}

	let orgId = opts.orgId;
	if (!orgId) {
		try {
			const orgs = await client.listOrgs();
			if (orgs.length === 1) {
				orgId = orgs[0].id;
				onStep({ id: "orgs", label: "Select organization", ok: true, detail: `Using organization "${orgs[0].name}"` });
			} else if (orgs.length === 0) {
				onStep({
					id: "orgs",
					label: "Select organization",
					ok: false,
					detail: "No organizations found",
					fallbackText: `Create an organization at ${DASHBOARD}/org/new, then retry.`,
				});
			} else {
				onStep({
					id: "orgs",
					label: "Select organization",
					ok: false,
					detail: `${orgs.length} organizations found`,
					fallbackText: `Multiple organizations found in the dashboard (${DASHBOARD}) — pick one and retry with it selected.`,
				});
			}
		} catch (e) {
			onStep({
				id: "orgs",
				label: "Select organization",
				ok: false,
				detail: message(e),
				fallbackText: `Could not list organizations automatically. Pick one at ${DASHBOARD} and retry.`,
			});
		}
	}
	if (!orgId) return null;

	const name = opts.name ?? "health-mcp";
	const region = opts.region ?? "us-east-1";
	try {
		const ref = await client.createProject(name, orgId, region, randomToken());
		onStep({ id: "project", label: "Create project", ok: true, detail: `Created project ${ref}` });
		return ref;
	} catch (e) {
		onStep({
			id: "project",
			label: "Create project",
			ok: false,
			detail: message(e),
			fallbackText: `Could not create the project automatically. Manual fallback: create one at ${DASHBOARD}/new, then re-run and choose "existing".`,
		});
		return null;
	}
}

/**
 * Runs the full provisioning flow against `client`, reporting each step via `onStep` as it
 * completes. Never throws — a failed step is reported with `ok:false` + `fallbackText` and,
 * except where nothing downstream could possibly succeed (no resolvable project), later steps
 * still run.
 */
export async function provisionAll(client: MgmtClient, opts: ProvisionOptions, onStep: (step: ProvisionStep) => void): Promise<ProvisionResult> {
	const ref = await resolveProject(client, opts, onStep);
	if (!ref) return {};

	if (opts.mode === "new") {
		const ready = await waitForProjectReady(client, ref);
		onStep({
			id: "wait-ready",
			label: "Wait for project to finish provisioning",
			ok: ready,
			detail: ready ? "Project is active" : "Timed out after 5 minutes",
			fallbackText: ready
				? undefined
				: `Wait for the project to finish provisioning in the dashboard (${DASHBOARD}/project/${ref}), then retry the remaining steps.`,
		});
	}

	try {
		await client.runSql(ref, opts.setupSql);
		onStep({ id: "schema", label: "Apply database schema", ok: true });
	} catch (e) {
		onStep({
			id: "schema",
			label: "Apply database schema",
			ok: false,
			detail: message(e),
			fallbackText: `Could not apply the schema automatically. Manual fallback: open the dashboard SQL editor (${DASHBOARD}/project/${ref}/sql/new), paste in the setup SQL, and run it (idempotent — safe to re-run).`,
		});
	}

	for (const slug of FUNCTION_SLUGS) {
		try {
			await client.deployFunction(ref, slug, opts.functionSources[slug]);
			onStep({ id: `deploy-${slug}`, label: `Deploy ${slug} function`, ok: true });
		} catch (e) {
			onStep({
				id: `deploy-${slug}`,
				label: `Deploy ${slug} function`,
				ok: false,
				detail: message(e),
				fallbackText: `Could not deploy "${slug}" automatically. Manual fallback: in the dashboard's Edge Functions tab (${DASHBOARD}/project/${ref}/functions), create a function named "${slug}" with JWT verification off and paste in its source.`,
			});
		}
	}

	if (opts.keepSecrets) {
		onStep({ id: "secrets", label: "Set MCP_TOKEN / INGEST_KEY secrets", ok: true, detail: "Kept existing secrets" });
		return { ref };
	}

	const mcpToken = randomToken();
	const ingestKey = randomToken();
	try {
		await client.setSecrets(ref, { MCP_TOKEN: mcpToken, INGEST_KEY: ingestKey });
		onStep({ id: "secrets", label: "Set MCP_TOKEN / INGEST_KEY secrets", ok: true });
		return { ref, mcpToken, ingestKey };
	} catch (e) {
		onStep({
			id: "secrets",
			label: "Set MCP_TOKEN / INGEST_KEY secrets",
			ok: false,
			detail: message(e),
			fallbackText: `Could not set secrets automatically. Manual fallback: in the dashboard's Edge Functions -> Secrets tab (${DASHBOARD}/project/${ref}/settings/functions), add MCP_TOKEN and INGEST_KEY using the values below.`,
		});
		return { ref, mcpToken, ingestKey };
	}
}
