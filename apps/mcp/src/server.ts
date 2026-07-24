import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, runSql, type SupabaseEnv } from "@almostjacked/health-mcp-core";
import { VERSION } from "./version.js";

/** Build a fully-registered server for one Supabase project (no transport attached). */
export function buildServer(env: SupabaseEnv): McpServer {
  const server = new McpServer({ name: "health-mcp", version: VERSION });
  registerTools(server, (sql) => runSql(env, sql));
  return server;
}
