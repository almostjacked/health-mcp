# health-mcp

[![CI](https://github.com/almostjacked/health-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/almostjacked/health-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40almostjacked%2Fhealth-mcp)](https://www.npmjs.com/package/@almostjacked/health-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.almostjacked%2Fhealth--mcp-blue)](https://registry.modelcontextprotocol.io/v0/servers?search=health-mcp)

Your health data (weight, body composition, calories, macros, water) as an MCP
data layer your AI can query. **Zero custody**: it lives in a Postgres
database in a Supabase project *you* create and own — nobody but you ever
holds your data or your keys. An iOS Shortcut syncs it daily from Apple
Health; Claude (or any MCP client) reads it back through a connector that
runs entirely inside your own project.

```
Apple Health --> "Sync Health Data" Shortcut --> your health-ingest function --> your Postgres
                                                                                      |
Claude  <-- run_readonly (SELECT-only) <-- your health-mcp connector function <------+
```

Nothing above touches infrastructure we operate. The two Edge Functions run
on your Supabase project; the only thing that ever leaves your device is the
Shortcut's HTTP POST straight to your own project's URL.

## Pair it with fitness-tools

health-mcp answers "what happened" (your logged weight and calories);
[fitness-tools](https://github.com/almostjacked/fitness-tools) answers "so
what" (TDEE, macros, body fat, 1RM). The `get_energy_inputs` tool returns
`{date, weight, kcal}` entries shaped exactly for fitness-tools'
`adaptive-tdee` — no reformatting needed. Ask Claude:

> Get my energy inputs for the last 90 days, then compute my adaptive TDEE

> `adaptive-tdee` needs at least 10 days that have BOTH a weigh-in and a calorie total — expect ~2 weeks of syncing before the pairing works.

> with fitness-tools.

If you also train with Hevy, pair with
[hevy-mcp](https://github.com/almostjacked/hevy-mcp) for the training side of
the picture (routines, logged sets, 1RM trend).

## Install

Three ways to get a working connector. All three end with the same thing: a
Supabase project holding your two tables (`daily_totals`, `measurements`),
two Edge Functions (`health-mcp`, `health-ingest`), and a connector URL you
add to Claude.

### 1. Wizard (fastest — one command)

```bash
npx @almostjacked/health-mcp setup
```

Interactive: walks you through logging in to Supabase, picking or creating a
project, applying the schema, deploying both functions, and minting your
secrets — then prints the connector URL and Shortcut config.

Non-interactive (scripting / CI):

```bash
npx @almostjacked/health-mcp setup --new --name my-health --region us-east-1 [--org-index N]
# or, against a project you already have:
npx @almostjacked/health-mcp setup --existing <project-ref>
```

`--region` is required when running non-interactively (there's no TTY to
prompt for it — the interactive wizard defaults the prompt to `us-east-1`).
`--org-index` picks an organization by number when your account belongs to
more than one; omit it if you only have one.

Requires Node >= 18 and a free [Supabase](https://supabase.com) account. Any
step the wizard can't automate prints the exact manual fallback for that
step (see path 2 below) and keeps going.

### 2. Manual dashboard (~15 min, no terminal)

Point-and-click through the Supabase dashboard yourself — no CLI, no Node.
Full click-by-click instructions: **[docs/setup-manual.md](docs/setup-manual.md)**.

Short version: create a project → SQL Editor, paste
[`packages/core/setup.sql`](packages/core/setup.sql) → Edge Functions, create
`health-mcp` and `health-ingest`, pasting in the
[release bundles](https://github.com/almostjacked/health-mcp/releases/tag/v0.1.0)
→ Project Settings → Edge Functions, add `MCP_TOKEN` / `INGEST_KEY` secrets
(any long random strings) → your connector URL is
`https://<project-ref>.supabase.co/functions/v1/health-mcp/<MCP_TOKEN>`.

> Supabase's free tier allows 2 active projects, so this fits alongside one
> other free project you may already have.

### 3. Claude Desktop

Download [`health-mcp.mcpb`](https://github.com/almostjacked/health-mcp/releases/tag/v0.1.0),
double-click it, and paste in your Supabase project URL and secret key when
prompted (from either install path above).

Prefer running it yourself instead of the `.mcpb`? It's a plain stdio
server:

```bash
claude mcp add health-mcp -e SUPABASE_URL=<url> -e SUPABASE_SECRET_KEY=<key> -- npx -y @almostjacked/health-mcp
```

## Sync your data: the Shortcut

An iOS Shortcut reads eight metrics out of Apple Health for the last 3 days
and POSTs them to your `health-ingest` function daily. Generate, install,
and automate it: **[docs/shortcut.md](docs/shortcut.md)**.

Don't use Shortcuts, or want to backfill older history? The ingest function
accepts the same `{"entries": [...]}` payload from any HTTP client — script
your own export against it. A dedicated browser-based `export.zip`
importer/backfill tool is **coming in 3c**.

## Tools

| Tool | Description |
|------|-------------|
| get_schema | The Postgres schema (two tables) and the metric registry (names, units, classes). Call before writing SQL for the query tool. |
| get_sync_status | Latest date, row count, and days-since-last-entry per metric. Use to detect a stalled daily sync before trusting an analysis. |
| get_recent | Rows for the last N days (default 30), optionally one metric. Daily totals and individual measurements in one date-sorted list. |
| get_daily_summary | All metrics for one day (default: the most recent day with any data): totals plus every weigh-in/measurement. |
| get_stats | Min/max/avg plus a rolling-average series for one metric over a date range (daily/weekly/monthly rollup). |
| query | Escape hatch: run one read-only SQL statement (SELECT or WITH…SELECT) against the schema from get_schema. Writes/DDL rejected; LIMIT 500 enforced. |
| get_energy_inputs | Daily (date, weight, kcal) entries for days with both a calorie total and a weigh-in — shaped exactly for fitness-tools' `adaptive-tdee`. |

## Privacy Policy

**Zero custody.** health-mcp is software you run against infrastructure you
own — we (the maintainers) never operate a server that sees your health
data or your keys, and there is nothing to disconnect from us because
nothing was ever connected to us.

- **Your data** lives only in the Supabase Postgres project you created. We
  have no access to it, no copy of it, and no way to see it.
- **Your keys** (`MCP_TOKEN`, `INGEST_KEY`, your Supabase secret key) are
  generated by you or the wizard running on your machine, stored as secrets
  in your own Supabase project, and — for the stdio/`.mcpb` install path —
  held locally by your MCP client (Claude Desktop / Claude Code) and sent
  only to your own project's URL.
- **The Shortcut** sends data straight from your phone to your Edge
  Function URL; it never passes through any server of ours.
- The `query` tool is SQL-guarded to read-only statements, and the database
  role it runs as (`health_reader`) is granted `SELECT` only — enforced at
  the Postgres level, not just in application code.

## Repo layout

```
packages/core   @almostjacked/health-mcp-core — tools, ingest/normalization, setup.sql
apps/mcp        @almostjacked/health-mcp       — stdio server, .mcpb, setup wizard
supabase/functions/health-mcp     the read connector (deployed to your project)
supabase/functions/health-ingest  the write endpoint the Shortcut posts to
```

## Develop

```bash
corepack enable
pnpm install
pnpm -r test
pnpm -r typecheck
```

## License

MIT — see [LICENSE](LICENSE).
