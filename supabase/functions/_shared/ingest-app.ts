import { Hono } from "hono";
import { planWrites, executeIngest } from "../../../packages/core/src/index.js";
import type { FnEnv } from "./mcp-app.js";

export function buildIngestApp(env: FnEnv): Hono {
	const app = new Hono();
	app.post("/health-ingest", async (c) => {
		if (c.req.header("X-Api-Key") !== env.INGEST_KEY || !env.INGEST_KEY) {
			return c.json({ error: "unauthorized" }, 401);
		}
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "invalid JSON body" }, 400);
		}
		try {
			const result = await executeIngest(
				{ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: env.SUPABASE_SERVICE_ROLE_KEY },
				planWrites(body),
			);
			return c.json(result);
		} catch (e) {
			return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
		}
	});
	return app;
}
