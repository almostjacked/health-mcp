import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MgmtClient } from "../src/provision/api.js";
import { provisionAll, isProjectReady, randomToken, connectorUrl, ingestUrl, mergeProvisionResult } from "../src/provision/steps.js";
import type { ProvisionStep, ProvisionOptions } from "../src/provision/steps.js";

const PROVISION_POLL_INTERVAL_MS = 10_000;

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => JSON.stringify(body),
	} as unknown as Response;
}

describe("MgmtClient", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("listOrgs: GETs /v1/organizations with the bearer token and maps id/slug/name", async () => {
		fetchMock.mockResolvedValue(jsonResponse([{ id: "org1", slug: "my-org", name: "My Org" }]));
		const client = new MgmtClient("tok123");
		const orgs = await client.listOrgs();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.supabase.com/v1/organizations");
		expect(init.method).toBe("GET");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
		expect(orgs).toEqual([{ id: "org1", slug: "my-org", name: "My Org" }]);
	});

	it("listProjects: GETs /v1/projects and maps ref/name/status", async () => {
		fetchMock.mockResolvedValue(jsonResponse([{ ref: "abcdefghijklmnopqrst", name: "proj", status: "ACTIVE_HEALTHY" }]));
		const client = new MgmtClient("tok123");
		const projects = await client.listProjects();

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.supabase.com/v1/projects");
		expect(init.method).toBe("GET");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
		expect(projects).toEqual([{ ref: "abcdefghijklmnopqrst", name: "proj", status: "ACTIVE_HEALTHY" }]);
	});

	it("createProject: POSTs /v1/projects with the org slug/region/password and returns the ref", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ref: "newprojectref12345aa" }, 201));
		const client = new MgmtClient("tok123");
		const ref = await client.createProject("health-mcp", "my-org", "us-east-1", "s3cret");

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.supabase.com/v1/projects");
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
		expect(JSON.parse(init.body as string)).toEqual({
			name: "health-mcp",
			organization_slug: "my-org",
			region: "us-east-1",
			db_pass: "s3cret",
		});
		expect(ref).toBe("newprojectref12345aa");
	});

	it("runSql: POSTs /v1/projects/{ref}/database/query with {query: sql}", async () => {
		fetchMock.mockResolvedValue(jsonResponse(null));
		const client = new MgmtClient("tok123");
		await client.runSql("ref123", "select 1;");

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.supabase.com/v1/projects/ref123/database/query");
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
		expect(JSON.parse(init.body as string)).toEqual({ query: "select 1;" });
	});

	it("deployFunction: POSTs multipart form to /v1/projects/{ref}/functions/deploy?slug=<slug>", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ id: "fn1", slug: "health-mcp", name: "health-mcp", status: "ACTIVE", version: 1 }, 201));
		const client = new MgmtClient("tok123");
		await client.deployFunction("ref123", "health-mcp", "export default () => new Response('ok');");

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.supabase.com/v1/projects/ref123/functions/deploy?slug=health-mcp");
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
		// Browser fetch sets the multipart boundary itself — we must not set Content-Type.
		expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
		expect(init.body).toBeInstanceOf(FormData);
		const form = init.body as FormData;
		const metadata = JSON.parse(form.get("metadata") as string);
		expect(metadata).toEqual({ name: "health-mcp", verify_jwt: false, entrypoint_path: "index.ts" });
		expect(form.get("file")).toBeInstanceOf(File);
	});

	it("setSecrets: POSTs /v1/projects/{ref}/secrets with a [{name,value}] array", async () => {
		fetchMock.mockResolvedValue(jsonResponse(null));
		const client = new MgmtClient("tok123");
		await client.setSecrets("ref123", { MCP_TOKEN: "a", INGEST_KEY: "b" });

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.supabase.com/v1/projects/ref123/secrets");
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
		expect(JSON.parse(init.body as string)).toEqual([
			{ name: "MCP_TOKEN", value: "a" },
			{ name: "INGEST_KEY", value: "b" },
		]);
	});

	it("surfaces non-2xx responses as an error with status + body snippet", async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => "bad request: invalid region" });
		const client = new MgmtClient("tok123");
		await expect(client.runSql("ref123", "select 1;")).rejects.toThrow(/400/);
		await expect(client.runSql("ref123", "select 1;")).rejects.toThrow(/bad request: invalid region/);
	});
});

describe("randomToken", () => {
	it("produces a 48-char url-safe base64 string", () => {
		const token = randomToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]{48}$/);
	});

	it("is not constant across calls", () => {
		expect(randomToken()).not.toBe(randomToken());
	});
});

describe("connectorUrl / ingestUrl", () => {
	it("connectorUrl embeds the ref as the subdomain and the mcpToken as the trailing path segment", () => {
		expect(connectorUrl("abcxyz", "tok123")).toBe("https://abcxyz.supabase.co/functions/v1/health-mcp/tok123");
	});

	it("ingestUrl embeds only the ref (the key travels as a header, not in the URL)", () => {
		expect(ingestUrl("abcxyz")).toBe("https://abcxyz.supabase.co/functions/v1/health-ingest");
	});
});

describe("mergeProvisionResult", () => {
	it("a fresh provision (new secrets minted) derives connectorUrl/ingestUrl from the new ref+mcpToken", () => {
		const merged = mergeProvisionResult({}, { ref: "abcxyz", mcpToken: "tok1", ingestKey: "key1" });
		expect(merged).toEqual({
			ref: "abcxyz",
			mcpToken: "tok1",
			ingestKey: "key1",
			connectorUrl: "https://abcxyz.supabase.co/functions/v1/health-mcp/tok1",
			ingestUrl: "https://abcxyz.supabase.co/functions/v1/health-ingest",
		});
	});

	it("keepSecrets re-run (no minted secrets in the result) falls back to the previously-stored secrets", () => {
		const previous = { ref: "old-ref", mcpToken: "old-tok", ingestKey: "old-key" };
		const merged = mergeProvisionResult(previous, { ref: "abcxyz" });
		expect(merged.mcpToken).toBe("old-tok");
		expect(merged.ingestKey).toBe("old-key");
		expect(merged.connectorUrl).toBe("https://abcxyz.supabase.co/functions/v1/health-mcp/old-tok");
		expect(merged.ingestUrl).toBe("https://abcxyz.supabase.co/functions/v1/health-ingest");
	});

	it("no ref in the result (provisioning stopped early) returns the previous config unchanged", () => {
		const previous = { ref: "old-ref", mcpToken: "old-tok" };
		expect(mergeProvisionResult(previous, {})).toBe(previous);
	});

	it("no previous secrets and none minted this run: connectorUrl stays unset, ingestUrl is still derived", () => {
		const merged = mergeProvisionResult({}, { ref: "abcxyz" });
		expect(merged.connectorUrl).toBeUndefined();
		expect(merged.mcpToken).toBeUndefined();
		expect(merged.ingestUrl).toBe("https://abcxyz.supabase.co/functions/v1/health-ingest");
	});
});

describe("isProjectReady", () => {
	it("true only for the matching ref reporting ACTIVE_HEALTHY", () => {
		const projects = [
			{ ref: "a", name: "a", status: "COMING_UP" },
			{ ref: "b", name: "b", status: "ACTIVE_HEALTHY" },
		];
		expect(isProjectReady(projects, "b")).toBe(true);
		expect(isProjectReady(projects, "a")).toBe(false);
		expect(isProjectReady(projects, "missing")).toBe(false);
	});
});

describe("provisionAll", () => {
	function baseOpts(overrides: Partial<ProvisionOptions> = {}): ProvisionOptions {
		return {
			mode: "existing",
			ref: "ref123",
			setupSql: "create table t();",
			functionSources: { "health-mcp": "mcp source", "health-ingest": "ingest source" },
			keepSecrets: false,
			...overrides,
		};
	}

	function makeClient(overrides: Partial<Record<keyof MgmtClient, ReturnType<typeof vi.fn>>> = {}): MgmtClient {
		return {
			listOrgs: vi.fn().mockResolvedValue([]),
			listProjects: vi.fn().mockResolvedValue([]),
			createProject: vi.fn(),
			runSql: vi.fn().mockResolvedValue(undefined),
			deployFunction: vi.fn().mockResolvedValue(undefined),
			setSecrets: vi.fn().mockResolvedValue(undefined),
			...overrides,
		} as unknown as MgmtClient;
	}

	it("existing-project mode runs schema -> deploy x2 -> secrets in order, skipping orgs/wait-ready", async () => {
		const client = makeClient();
		const steps: ProvisionStep[] = [];
		const result = await provisionAll(client, baseOpts(), (s) => steps.push(s));

		expect(steps.map((s) => s.id)).toEqual(["project", "schema", "deploy-health-mcp", "deploy-health-ingest", "secrets"]);
		expect(steps.every((s) => s.ok)).toBe(true);
		expect(client.runSql).toHaveBeenCalledWith("ref123", "create table t();");
		expect(client.deployFunction).toHaveBeenNthCalledWith(1, "ref123", "health-mcp", "mcp source");
		expect(client.deployFunction).toHaveBeenNthCalledWith(2, "ref123", "health-ingest", "ingest source");
		expect(client.setSecrets).toHaveBeenCalledTimes(1);
		expect(result.ref).toBe("ref123");
		expect(result.mcpToken).toMatch(/^[A-Za-z0-9_-]{48}$/);
		expect(result.ingestKey).toMatch(/^[A-Za-z0-9_-]{48}$/);
	});

	it("new-project mode runs orgs -> project -> wait-ready -> schema -> deploy x2 -> secrets", async () => {
		const client = makeClient({
			listOrgs: vi.fn().mockResolvedValue([{ id: "org1", slug: "solo-org", name: "Solo Org" }]),
			createProject: vi.fn().mockResolvedValue("newref123456789012ab"),
			listProjects: vi.fn().mockResolvedValue([{ ref: "newref123456789012ab", name: "n", status: "ACTIVE_HEALTHY" }]),
		});
		const steps: ProvisionStep[] = [];
		const result = await provisionAll(client, baseOpts({ mode: "new", ref: undefined, name: "health-mcp" }), (s) => steps.push(s));

		expect(steps.map((s) => s.id)).toEqual(["orgs", "project", "wait-ready", "schema", "deploy-health-mcp", "deploy-health-ingest", "secrets"]);
		expect(steps.every((s) => s.ok)).toBe(true);
		expect(client.createProject).toHaveBeenCalledWith("health-mcp", "solo-org", "us-east-1", expect.any(String));
		expect(result.ref).toBe("newref123456789012ab");
	});

	it("wait-ready polls listProjects every 10s (fake timers) until ACTIVE_HEALTHY, up to 5 min", async () => {
		vi.useFakeTimers();
		try {
			const listProjects = vi
				.fn()
				.mockResolvedValueOnce([{ ref: "r", name: "n", status: "COMING_UP" }])
				.mockResolvedValueOnce([{ ref: "r", name: "n", status: "COMING_UP" }])
				.mockResolvedValueOnce([{ ref: "r", name: "n", status: "ACTIVE_HEALTHY" }]);
			const client = makeClient({
				listOrgs: vi.fn().mockResolvedValue([{ id: "org1", slug: "solo", name: "Solo" }]),
				createProject: vi.fn().mockResolvedValue("r"),
				listProjects,
			});
			const steps: ProvisionStep[] = [];
			const donePromise = provisionAll(client, baseOpts({ mode: "new", ref: undefined }), (s) => steps.push(s));

			// Let the microtask queue drain between each simulated 10s tick so listProjects
			// actually gets called before the next timer advance.
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(PROVISION_POLL_INTERVAL_MS);
			await vi.advanceTimersByTimeAsync(PROVISION_POLL_INTERVAL_MS);

			const result = await donePromise;
			expect(listProjects).toHaveBeenCalledTimes(3);
			expect(steps.find((s) => s.id === "wait-ready")).toMatchObject({ ok: true });
			expect(result.ref).toBe("r");
		} finally {
			vi.useRealTimers();
		}
	});

	it("wait-ready reports ok:false with a fallbackText after a 5-minute timeout", async () => {
		vi.useFakeTimers();
		try {
			const client = makeClient({
				listOrgs: vi.fn().mockResolvedValue([{ id: "org1", slug: "solo", name: "Solo" }]),
				createProject: vi.fn().mockResolvedValue("r"),
				listProjects: vi.fn().mockResolvedValue([{ ref: "r", name: "n", status: "COMING_UP" }]),
			});
			const steps: ProvisionStep[] = [];
			const donePromise = provisionAll(client, baseOpts({ mode: "new", ref: undefined }), (s) => steps.push(s));

			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(5 * 60_000 + PROVISION_POLL_INTERVAL_MS);

			await donePromise;
			const waitStep = steps.find((s) => s.id === "wait-ready");
			expect(waitStep?.ok).toBe(false);
			expect(waitStep?.fallbackText).toContain("dashboard");
		} finally {
			vi.useRealTimers();
		}
	});

	it("continues past a failed deploy step, reporting ok:false with a dashboard fallbackText", async () => {
		const client = makeClient({
			deployFunction: vi.fn().mockRejectedValueOnce(new Error("HTTP 500")).mockResolvedValueOnce(undefined),
		});
		const steps: ProvisionStep[] = [];
		const result = await provisionAll(client, baseOpts(), (s) => steps.push(s));

		const failed = steps.find((s) => s.id === "deploy-health-mcp");
		expect(failed?.ok).toBe(false);
		expect(failed?.fallbackText).toContain("dashboard");

		const following = steps.find((s) => s.id === "deploy-health-ingest");
		expect(following?.ok).toBe(true);

		// later steps still ran, including secrets
		expect(steps.map((s) => s.id)).toContain("secrets");
		expect(result.ref).toBe("ref123");
	});

	it("continues past a failed schema step", async () => {
		const client = makeClient({ runSql: vi.fn().mockRejectedValue(new Error("db offline")) });
		const steps: ProvisionStep[] = [];
		await provisionAll(client, baseOpts(), (s) => steps.push(s));

		const schemaStep = steps.find((s) => s.id === "schema");
		expect(schemaStep?.ok).toBe(false);
		expect(schemaStep?.fallbackText).toContain("dashboard");
		expect(steps.map((s) => s.id)).toEqual(["project", "schema", "deploy-health-mcp", "deploy-health-ingest", "secrets"]);
	});

	it("keepSecrets: true skips the secrets API call entirely, with an ok step noting it", async () => {
		const client = makeClient();
		const steps: ProvisionStep[] = [];
		const result = await provisionAll(client, baseOpts({ keepSecrets: true }), (s) => steps.push(s));

		expect(client.setSecrets).not.toHaveBeenCalled();
		const secretsStep = steps.find((s) => s.id === "secrets");
		expect(secretsStep?.ok).toBe(true);
		expect(result.mcpToken).toBeUndefined();
		expect(result.ingestKey).toBeUndefined();
	});

	it("existing mode with no ref reports a failed project step and stops (no further steps)", async () => {
		const client = makeClient();
		const steps: ProvisionStep[] = [];
		const result = await provisionAll(client, baseOpts({ ref: undefined }), (s) => steps.push(s));

		expect(steps).toHaveLength(1);
		expect(steps[0]).toMatchObject({ id: "project", ok: false });
		expect(steps[0].fallbackText).toBeTruthy();
		expect(result.ref).toBeUndefined();
		expect(client.runSql).not.toHaveBeenCalled();
	});

	it("new mode with multiple orgs and no orgSlug stops before creating a project", async () => {
		const client = makeClient({
			listOrgs: vi.fn().mockResolvedValue([
				{ id: "org1", slug: "org-one", name: "One" },
				{ id: "org2", slug: "org-two", name: "Two" },
			]),
		});
		const steps: ProvisionStep[] = [];
		const result = await provisionAll(client, baseOpts({ mode: "new", ref: undefined }), (s) => steps.push(s));

		expect(steps).toHaveLength(1);
		expect(steps[0]).toMatchObject({ id: "orgs", ok: false });
		expect(client.createProject).not.toHaveBeenCalled();
		expect(result.ref).toBeUndefined();
	});
});
