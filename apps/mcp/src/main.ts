#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

if (process.argv[2] === "setup") {
  const { main } = await import("./setup.js");
  await main();
} else {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error(
      "health-mcp: missing SUPABASE_URL and/or SUPABASE_SECRET_KEY environment variable.\n" +
        "See the README for setup instructions, or run the setup wizard:\n" +
        "  npx -y @almostjacked/health-mcp setup",
    );
    process.exit(1);
  }
  const server = buildServer({ SUPABASE_URL, SUPABASE_SECRET_KEY });
  await server.connect(new StdioServerTransport());
}
