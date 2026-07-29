// Thin client for the Supabase Management API (https://api.supabase.com), used by the
// in-browser provisioning wizard (steps.ts) as the browser-side equivalent of shelling out
// to the `supabase` CLI (apps/mcp/src/setup.ts does that for the npx wizard).
//
// Every method throws a plain Error with the HTTP status + a body snippet on a non-2xx
// response — steps.ts is responsible for catching per-step and turning that into a
// `{ok:false, fallbackText}` step result; nothing here talks to the DOM or prints anything.
//
// Endpoint contracts (verified against the Supabase CLI's generated OpenAPI operations —
// packages/api/src/generated/contracts.ts in supabase/cli — see the task report for the
// full verification trail):
//   GET    /v1/organizations                        -> [{id, name, ...}]
//   GET    /v1/projects                              -> [{ref, name, status, ...}]
//   POST   /v1/projects                               body {name, organization_id, region, db_pass} -> {ref, ...}
//   POST   /v1/projects/{ref}/database/query          body {query} -> (void/rows)
//   POST   /v1/projects/{ref}/functions/deploy?slug=  multipart: `metadata` JSON part
//                                                      {name, verify_jwt, entrypoint_path} + `file` part(s)
//   POST   /v1/projects/{ref}/secrets                  body [{name, value}] -> void

const API_BASE = "https://api.supabase.com";

export interface OrgSummary {
	id: string;
	name: string;
}

export interface ProjectSummary {
	ref: string;
	name: string;
	status: string;
}

function errorMessage(method: string, path: string, status: number, bodySnippet: string): string {
	return `Supabase API error: ${method} ${path} -> HTTP ${status}: ${bodySnippet}`;
}

export class MgmtClient {
	constructor(private readonly accessToken: string) {}

	private async request(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<unknown> {
		const url = new URL(path, API_BASE);
		if (query) {
			for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
		}

		const headers: Record<string, string> = { Authorization: `Bearer ${this.accessToken}` };
		let requestBody: BodyInit | undefined;
		if (body instanceof FormData) {
			requestBody = body;
		} else if (body !== undefined) {
			headers["Content-Type"] = "application/json";
			requestBody = JSON.stringify(body);
		}

		const res = await fetch(url.toString(), { method, headers, body: requestBody });
		if (!res.ok) {
			const bodySnippet = (await res.text().catch(() => "")).slice(0, 200);
			throw new Error(errorMessage(method, path, res.status, bodySnippet));
		}
		const text = await res.text();
		if (!text) return undefined;
		try {
			return JSON.parse(text);
		} catch {
			return undefined;
		}
	}

	async listOrgs(): Promise<OrgSummary[]> {
		const data = (await this.request("GET", "/v1/organizations")) as unknown[] | undefined;
		if (!Array.isArray(data)) return [];
		return data
			.map((o) => {
				const id = (o as { id?: unknown } | undefined)?.id;
				const name = (o as { name?: unknown } | undefined)?.name;
				if (typeof id !== "string" || id.length === 0) return null;
				return { id, name: typeof name === "string" && name.length > 0 ? name : id };
			})
			.filter((o): o is OrgSummary => o !== null);
	}

	async listProjects(): Promise<ProjectSummary[]> {
		const data = (await this.request("GET", "/v1/projects")) as unknown[] | undefined;
		if (!Array.isArray(data)) return [];
		return data
			.map((p) => {
				const ref = (p as { ref?: unknown; id?: unknown } | undefined)?.ref ?? (p as { id?: unknown } | undefined)?.id;
				if (typeof ref !== "string" || ref.length === 0) return null;
				const name = (p as { name?: unknown } | undefined)?.name;
				const status = (p as { status?: unknown } | undefined)?.status;
				return {
					ref,
					name: typeof name === "string" && name.length > 0 ? name : ref,
					status: typeof status === "string" && status.length > 0 ? status : "UNKNOWN",
				};
			})
			.filter((p): p is ProjectSummary => p !== null);
	}

	/** Returns the newly created project's ref. */
	async createProject(name: string, orgId: string, region: string, dbPass: string): Promise<string> {
		const data = (await this.request("POST", "/v1/projects", {
			name,
			organization_id: orgId,
			region,
			db_pass: dbPass,
		})) as { ref?: unknown; id?: unknown } | undefined;
		const ref = data?.ref ?? data?.id;
		if (typeof ref !== "string" || ref.length === 0) {
			throw new Error("createProject: response did not include a project ref");
		}
		return ref;
	}

	async runSql(ref: string, sql: string): Promise<void> {
		await this.request("POST", `/v1/projects/${ref}/database/query`, { query: sql });
	}

	/**
	 * Deploys a single-file edge function via the Management API's multipart deploy endpoint
	 * (`POST /v1/projects/{ref}/functions/deploy?slug=<slug>`) — the same endpoint
	 * `supabase functions deploy --use-api` uses under the hood. `source` becomes the
	 * function's `index.ts` entrypoint; JWT verification is always off (matches the CLI
	 * wizard's `--no-verify-jwt`, since these functions do their own auth).
	 */
	async deployFunction(ref: string, slug: string, source: string): Promise<void> {
		const metadata = { name: slug, verify_jwt: false, entrypoint_path: "index.ts" };
		const form = new FormData();
		form.append("metadata", JSON.stringify(metadata));
		form.append("file", new File([source], "index.ts", { type: "application/typescript" }));
		await this.request("POST", `/v1/projects/${ref}/functions/deploy`, form, { slug });
	}

	async setSecrets(ref: string, secrets: Record<string, string>): Promise<void> {
		const body = Object.entries(secrets).map(([name, value]) => ({ name, value }));
		await this.request("POST", `/v1/projects/${ref}/secrets`, body);
	}
}
