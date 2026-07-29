import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, runSql } from "../../../packages/core/src/index.js";

export interface FnEnv {
	SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
	MCP_TOKEN: string;
	INGEST_KEY: string;
}

export function buildMcpApp(env: FnEnv): Hono {
	// No CORS here, intentionally: claude.ai calls this connector server-side (it's
	// the MCP transport, not a page fetch), so the browser's CORS check never applies.
	const app = new Hono();
	const exec = (sql: string) =>
		runSql({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: env.SUPABASE_SERVICE_ROLE_KEY }, sql);

	app.post("/health-mcp/:token", async (c) => {
		if (!env.MCP_TOKEN || c.req.param("token") !== env.MCP_TOKEN) return c.text("not found", 404);
		const server = new McpServer({ name: "health-mcp", version: "0.1.0" });
		registerTools(server, exec);
		const transport = new StreamableHTTPTransport();
		await server.connect(transport);
		return transport.handleRequest(c);
	});
	app.on(["GET", "DELETE"], "/health-mcp/:token", (c) => {
		c.header("Allow", "POST");
		return c.json({ error: "method not allowed: stateless server, POST only" }, 405);
	});
	app.get("/health-mcp", (c) => c.json({ ok: true, hint: "POST /health-mcp/<token>" }));
	return app;
}
