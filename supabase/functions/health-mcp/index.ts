import { buildMcpApp } from "../_shared/mcp-app.ts";
const env = {
	SUPABASE_URL: Deno.env.get("SUPABASE_URL")!,
	SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
	MCP_TOKEN: Deno.env.get("MCP_TOKEN") ?? "",
	INGEST_KEY: Deno.env.get("INGEST_KEY") ?? "",
};
Deno.serve(buildMcpApp(env).fetch);
