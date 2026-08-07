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

## Get set up (four steps, ~20 minutes)

### 1. Create your database + connector

Three ways, pick one — all three end with the same thing: your connector
URL, plus your ingest URL and ingest key.

- **[The setup page](https://almostjacked.github.io/health-mcp/)** — no
  terminal, guided clicks through your Supabase dashboard.
- **`npx @almostjacked/health-mcp setup`** — fastest, needs Node ≥ 18. Walks
  you through logging in to Supabase, picking or creating a project,
  applying the schema, deploying both functions, and minting your secrets,
  then prints the connector URL and Shortcut config.
- **[Manual dashboard walkthrough](docs/setup-manual.md)** — the same steps
  as the setup page, written out for anyone who'd rather read them first or
  do them by hand.

> Supabase's free tier allows 2 active projects, so this fits alongside one
> other free project you may already have.

### 2. Load your history

Without this, [adaptive-TDEE](#pair-it-with-fitness-tools) needs about two
weeks of daily syncs before it has enough data to work. With it, everything
works immediately.

1. On your iPhone: **Health app → your profile picture → Export All Health
   Data**. This produces an `export.zip` (can take a few minutes for a long
   history).
2. Get that file to whatever device you're setting up from, then drop it on
   the setup page's **[Import panel](https://almostjacked.github.io/health-mcp/#import)**.
   Leave **Dry run** checked first to preview what would be sent before you
   commit to it.

### 3. Set up the daily sync

The **[Shortcut panel](https://almostjacked.github.io/health-mcp/#shortcut)**
has one download button — no signing step, no Terminal. Download the
shortcut, install it on your iPhone (iOS asks you to paste in your ingest
URL and key during import), then turn on the 9 AM daily automation. Full
click-by-click detail (including what to do if a step doesn't survive the
iOS import): **[docs/shortcut.md](docs/shortcut.md)**.


**Easiest install (Mac-first):** download the signed shortcut on your Mac and double-click it — the two import prompts appear right next to the page's copy buttons, and iCloud syncs the shortcut to your iPhone automatically. (No Mac? Send the file to your phone and answer the prompts there.)

### 4. Connect Claude

1. Open **claude.ai → Settings → Connectors → Add custom connector**.
2. Paste in your connector URL from step 1.
3. Save. Claude can now use your health-mcp tools.

> If adding the connector fails with *"Couldn't register with [name]'s
> sign-in service"*, that's a transient claude.ai hiccup, not a problem with
> your connector — just try adding it again.

## Use it

Ask Claude things like:

> What's my average calorie intake this week vs last?

> Show me my weight trend over the last 90 days.

> Has my daily sync stalled? Check get_sync_status.

### Pair it with fitness-tools

health-mcp answers "what happened" (your logged weight and calories);
[fitness-tools](https://github.com/almostjacked/fitness-tools) answers "so
what" (TDEE, macros, body fat, 1RM). The `get_energy_inputs` tool returns
`{date, weight, kcal}` entries shaped exactly for fitness-tools'
`adaptive-tdee` — no reformatting needed. Ask Claude:

> Get my energy inputs for the last 90 days, then compute my adaptive TDEE
> with fitness-tools.

> `adaptive-tdee` needs at least 10 days that have BOTH a weigh-in and a
> calorie total — if you skipped [step 2](#2-load-your-history), expect ~2
> weeks of syncing before the pairing works.

If you also train with Hevy, pair with
[hevy-mcp](https://github.com/almostjacked/hevy-mcp) for the training side of
the picture (routines, logged sets, 1RM trend).

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

## Architecture

```
Apple Health --> "Sync Health Data" Shortcut --> your health-ingest function --> your Postgres
                                                                                      |
Claude  <-- run_readonly (SELECT-only) <-- your health-mcp connector function <------+
```

Nothing above touches infrastructure we operate. The two Edge Functions run
on your Supabase project; the only thing that ever leaves your device is the
Shortcut's HTTP POST straight to your own project's URL.

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

## Other clients

Prefer Claude Desktop, or running the server yourself instead of the hosted
connector? Both use the same Supabase project from step 1 — just a
different way of talking to it.

**Claude Desktop:** download
[`health-mcp.mcpb`](https://github.com/almostjacked/health-mcp/releases/tag/v0.1.0),
double-click it, and paste in your Supabase project URL and secret key when
prompted.

**Any stdio MCP client** (Claude Code, etc.):

```bash
claude mcp add health-mcp -e SUPABASE_URL=<url> -e SUPABASE_SECRET_KEY=<key> -- npx -y @almostjacked/health-mcp
```

## Repo layout

```
packages/core   @almostjacked/health-mcp-core — tools, ingest/normalization, setup.sql
apps/mcp        @almostjacked/health-mcp       — stdio server, .mcpb, setup wizard
web             the setup page (provision + import + Shortcut panels)
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
