import { Hono } from "hono";
import { cors } from "hono/cors";
import { planWrites, executeIngest } from "../../../packages/core/src/index.js";
import type { FnEnv } from "./mcp-app.js";

export function buildIngestApp(env: FnEnv): Hono {
	const app = new Hono();
	// The web importer (health-mcp.pages.dev or wherever it's hosted) posts here
	// directly from the browser, so this route needs CORS — unlike health-mcp/
	// (see mcp-app.ts), which claude.ai only ever calls server-side.
	//
	// origin: "*" is safe here even though it's wide open: this endpoint is
	// already key-gated by X-Api-Key, checked below on every request regardless
	// of origin. A page on an *different* origin can still trigger a CORS-simple
	// preflight and get a response, but without the correct key it gets a 401 —
	// there is no cookie/session to ride along with (this is a bearer-key API,
	// not cookie-authenticated), so there's no CSRF-style abuse available to an
	// attacker who doesn't already have the key. Loosening this to "*" only
	// saves legitimate callers a maintenance burden (no origin allowlist to
	// keep in sync); it does not weaken the actual authorization check.
	app.use(
		"/health-ingest",
		cors({
			origin: "*",
			allowMethods: ["POST", "OPTIONS"],
			allowHeaders: ["x-api-key", "content-type"],
			maxAge: 86400,
		}),
	);
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
