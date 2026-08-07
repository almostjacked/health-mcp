# Manual dashboard setup (~5 minutes, no terminal)

This is step 1 of the [four-step setup](../README.md#get-set-up-four-steps-20-minutes) —
creating your database and connector — done by hand. It uses only the
Supabase web dashboard and your browser: no Node, no CLI, nothing installed
locally. If you'd rather run one command instead, see
[`npx @almostjacked/health-mcp setup`](../README.md#1-create-your-database--connector).

The [onboarding page](https://almostjacked.github.io/health-mcp/) walks
through these same six steps with deep links that open the exact dashboard
screen you need, plus copy buttons for everything you'll paste — this page
is the plain-text mirror of that for anyone who'd rather read it here first.

## 1. Create a Supabase project

1. Open [supabase.com/dashboard/new](https://supabase.com/dashboard/new) and
   sign up / sign in (free tier is enough).
2. Pick an organization, give the project a name (e.g. `health-mcp`), choose
   a region close to you, and set a database password (you won't need it
   again for this setup — Supabase stores it).
3. Click **Create new project** and wait for it to finish provisioning
   (usually 1-3 minutes).

> Supabase's free tier allows **2 active projects** per organization. If
> you're already using both slots, either free one up or create a new
> organization first.

## 2. Apply the schema

1. Open [supabase.com/dashboard/project/\_/sql/new](https://supabase.com/dashboard/project/_/sql/new)
   — the `/_/` routes to whichever project you currently have selected in
   the dashboard (or prompts you to pick one).
2. Open [`packages/core/setup.sql`](../packages/core/setup.sql) in this
   repo, copy its entire contents, and paste them into the editor.
3. Click **Run**. It should finish with no errors — the script is
   idempotent, so re-running it later is safe.

This creates the two tables (`daily_totals`, `measurements`), a read-only
`health_reader` role, and the `run_readonly` function the connector calls.

## 3. Deploy the two Edge Functions

You'll create two functions, pasting in the release build for each — no
build step, no CLI.

For **each** of the two functions below:

1. Open [supabase.com/dashboard/project/\_/functions](https://supabase.com/dashboard/project/_/functions)
   (same `/_/` convention — routes to your selected project).
2. Click **Deploy a new function**, then **Via editor** (not "via CLI").
3. Name it exactly as shown (this name becomes part of the function's URL).
4. Delete the placeholder code the editor starts with, then paste in the
   full contents of the matching release bundle.
5. Before deploying, turn **off** "Enforce JWT verification" — the
   functions do their own auth (an MCP token in the URL path / an API-key
   header), not Supabase's built-in JWT check.
6. Click **Deploy**.

| Function name | Paste the contents of |
|---|---|
| `health-mcp` | [health-mcp.ts](https://almostjacked.github.io/health-mcp/functions/health-mcp.ts) |
| `health-ingest` | [health-ingest.ts](https://almostjacked.github.io/health-mcp/functions/health-ingest.ts) |

(Both files are single-file bundles built from this repo's
[`supabase/functions/`](../supabase/functions) sources — no imports to
resolve, just paste and deploy.)

## 4. Add your secrets

1. Open [supabase.com/dashboard/project/\_/settings/functions](https://supabase.com/dashboard/project/_/settings/functions)
   (again, `/_/` routes to your selected project).
2. Add two secrets:
   - `MCP_TOKEN` — any long random string (this becomes part of your
     connector URL, so treat it like a password — e.g. generate one with
     `openssl rand -hex 32`, a password manager, or the "Generate values"
     button on the [onboarding page](https://almostjacked.github.io/health-mcp/),
     which mints both values for you locally in your browser).
   - `INGEST_KEY` — another long random string (sent as the `X-Api-Key`
     header by the Shortcut).
3. Save. Both Edge Functions read these at request time, so no redeploy is
   needed after adding them.

Keep both values somewhere safe — the connector URL below embeds
`MCP_TOKEN`, so you'll need it again if you lose it.

## 5. Your connector URL

Your project's ref is the subdomain in its dashboard URL
(`https://supabase.com/dashboard/project/<ref>`). Your connector URL is:

```
https://<ref>.supabase.co/functions/v1/health-mcp/<MCP_TOKEN>
```

Add this as a custom connector in claude.ai / Claude Desktop
(**Settings → Connectors → Add custom connector**), or point any MCP HTTP
client at it.

Your ingest URL (for the [Shortcut](shortcut.md) or your own scripts) is:

```
https://<ref>.supabase.co/functions/v1/health-ingest
```

sent as a POST with header `X-Api-Key: <INGEST_KEY>` and a JSON body of
`{"entries": [...]}`.

## Done

That's the whole manual path — same end state as the wizard or the
[setup page](https://almostjacked.github.io/health-mcp/): a project with the
schema applied, both functions deployed, secrets set, and a connector URL
ready to add to Claude.

**You've finished step 1 — go load your history next.** Export your Apple
Health data (Health app → your profile → Export All Health Data) and drop
`export.zip` on the setup page's
[Import panel](https://almostjacked.github.io/health-mcp/#import) — dry-run
first. Skip this and adaptive-TDEE needs ~2 weeks of daily syncs before it
works; do it and everything works immediately. After that:
[set up the Shortcut](shortcut.md) for the daily sync, then connect Claude.
