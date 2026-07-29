import { describe, it, expect } from "vitest";
import {
	manualSteps,
	previewConnectorUrl,
	DASHBOARD_NEW_PROJECT_URL,
	DASHBOARD_SQL_NEW_URL,
	DASHBOARD_FUNCTIONS_URL,
	DASHBOARD_FUNCTION_SECRETS_URL,
} from "../src/provision/manual-steps.js";
import { connectorUrl } from "../src/provision/steps.js";

describe("manualSteps", () => {
	it("returns all six steps, numbered 1-6 in order", () => {
		const steps = manualSteps();
		expect(steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(steps.map((s) => s.id)).toEqual([
			"create-project",
			"sql-editor",
			"deploy-health-mcp",
			"deploy-health-ingest",
			"secrets",
			"connector",
		]);
	});

	it("step 1 deep-links to dashboard/new with a free-tier note", () => {
		const [step] = manualSteps();
		expect(step.href).toBe("https://supabase.com/dashboard/new");
		expect(step.href).toBe(DASHBOARD_NEW_PROJECT_URL);
		expect(step.note).toMatch(/2 active projects/);
		expect(step.fetchUrl).toBeUndefined();
	});

	it("step 2 deep-links to the project's SQL editor and copies ./setup.sql", () => {
		const step = manualSteps()[1];
		expect(step.href).toBe("https://supabase.com/dashboard/project/_/sql/new");
		expect(step.href).toBe(DASHBOARD_SQL_NEW_URL);
		expect(step.fetchUrl).toBe("./setup.sql");
		expect(step.note).toMatch(/\/_\//);
	});

	it("steps 3 and 4 both deep-link to Edge Functions and copy the matching function source", () => {
		const [, , mcp, ingest] = manualSteps();
		expect(mcp.href).toBe("https://supabase.com/dashboard/project/_/functions");
		expect(mcp.href).toBe(DASHBOARD_FUNCTIONS_URL);
		expect(mcp.fetchUrl).toBe("./functions/health-mcp.ts");
		expect(mcp.title).toContain("health-mcp");

		expect(ingest.href).toBe(DASHBOARD_FUNCTIONS_URL);
		expect(ingest.fetchUrl).toBe("./functions/health-ingest.ts");
		expect(ingest.title).toContain("health-ingest");
	});

	it("step 5 deep-links to Function Secrets and has no prefill when config is empty", () => {
		const step = manualSteps({})[4];
		expect(step.href).toBe("https://supabase.com/dashboard/project/_/settings/functions");
		expect(step.href).toBe(DASHBOARD_FUNCTION_SECRETS_URL);
		expect(step.note).toMatch(/MCP_TOKEN/);
		expect(step.secretsPrefill).toBeUndefined();
	});

	it("step 5 prefills from config only when both secrets are already present", () => {
		expect(manualSteps({ mcpToken: "tok" })[4].secretsPrefill).toBeUndefined();
		expect(manualSteps({ ingestKey: "key" })[4].secretsPrefill).toBeUndefined();
		expect(manualSteps({ mcpToken: "tok", ingestKey: "key" })[4].secretsPrefill).toEqual({
			mcpToken: "tok",
			ingestKey: "key",
		});
	});

	it("step 6 has no deep link (nothing to open) and carries empty prefill + no preview when config is empty", () => {
		const step = manualSteps()[5];
		expect(step.href).toBeUndefined();
		expect(step.linkLabel).toBeUndefined();
		expect(step.connectorPrefill).toEqual({ ref: "", mcpToken: "", preview: undefined });
	});

	it("step 6 prefill's preview matches steps.ts's connectorUrl once both ref and mcpToken are known", () => {
		const step = manualSteps({ ref: "abcxyz", mcpToken: "tok123" })[5];
		expect(step.connectorPrefill).toEqual({
			ref: "abcxyz",
			mcpToken: "tok123",
			preview: connectorUrl("abcxyz", "tok123"),
		});
		expect(step.connectorPrefill?.preview).toBe("https://abcxyz.supabase.co/functions/v1/health-mcp/tok123");
	});

	it("step 6 has no preview with only one of ref/mcpToken set", () => {
		expect(manualSteps({ ref: "abcxyz" })[5].connectorPrefill?.preview).toBeUndefined();
		expect(manualSteps({ mcpToken: "tok123" })[5].connectorPrefill?.preview).toBeUndefined();
	});
});

describe("previewConnectorUrl", () => {
	it("undefined when either side is empty or whitespace-only", () => {
		expect(previewConnectorUrl("", "tok")).toBeUndefined();
		expect(previewConnectorUrl("ref", "")).toBeUndefined();
		expect(previewConnectorUrl("  ", "tok")).toBeUndefined();
		expect(previewConnectorUrl("ref", "   ")).toBeUndefined();
	});

	it("trims both inputs and matches connectorUrl's output exactly", () => {
		expect(previewConnectorUrl("  abcxyz  ", "  tok123  ")).toBe(connectorUrl("abcxyz", "tok123"));
	});
});
