# Manual dashboard setup (~15 minutes, no terminal)

This path uses only the Supabase web dashboard and your browser — no Node,
no CLI, nothing installed locally. If you'd rather run one command, see the
[wizard](../README.md#1-wizard-fastest--one-command) instead.

## 1. Create a Supabase project

1. Go to [supabase.com/dashboard/new](https://supabase.com/dashboard/new) and
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

1. In your project's left sidebar, open **SQL Editor**.
2. Click **New query**.
3. Open [`packages/core/setup.sql`](../packages/core/setup.sql) in this
   repo, copy its entire contents, and paste them into the editor.
4. Click **Run**. It should finish with no errors — the script is
   idempotent, so re-running it later is safe.

This creates the two tables (`daily_totals`, `measurements`), a read-only
`health_reader` role, and the `run_readonly` function the connector calls.

## 3. Deploy the two Edge Functions

You'll create two functions, pasting in the release build for each — no
build step, no CLI.

For **each** of the two functions below:

1. In the left sidebar, open **Edge Functions**.
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
| `health-mcp` | [health-mcp.ts](https://github.com/almostjacked/health-mcp/releases/download/v0.1.0/health-mcp.ts) |
| `health-ingest` | [health-ingest.ts](https://github.com/almostjacked/health-mcp/releases/download/v0.1.0/health-ingest.ts) |

(Both files are single-file bundles built from this repo's
[`supabase/functions/`](../supabase/functions) sources — no imports to
resolve, just paste and deploy.)

## 4. Add your secrets

1. Go to **Project Settings → Edge Functions**.
2. Add two secrets:
   - `MCP_TOKEN` — any long random string (this becomes part of your
     connector URL, so treat it like a password — e.g. generate one with
     `openssl rand -base64 32` or a password manager).
   - `INGEST_KEY` — another long random string (sent as the `X-Api-Key`
     header by the Shortcut).
3. Save. Both Edge Functions read these at request time, so no redeploy is
   needed after adding them.

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

That's the whole manual path — same end state as the wizard: a project with
the schema applied, both functions deployed, secrets set, and a connector
URL ready to add to Claude. Next: [set up the Shortcut](shortcut.md) to
start syncing data.
