// Interactive setup wizard: `npx @almostjacked/health-mcp setup`.
//
// Provisions a user's own Supabase project end-to-end by shelling out to the
// `supabase` CLI (via `npx -y supabase@latest ...` — no new dependency): picks
// or creates a project, applies packages/core/setup.sql, mints MCP_TOKEN /
// INGEST_KEY secrets, deploys the two bundled edge functions, then prints the
// connector URL + Shortcut config.
//
// Every automated step that can fail prints the exact manual dashboard
// fallback and (where safe) continues to the next step rather than dying —
// see the CLI verification table in the task report for what was checked
// against the real CLI (`npx supabase@latest --help` + subcommand helps)
// before this flow was designed.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in setup.test.ts)
// ---------------------------------------------------------------------------

/** 48 url-safe chars — used for MCP_TOKEN, INGEST_KEY, and the generated db password. */
export function randomToken(): string {
  return randomBytes(36).toString("base64url");
}

/** Where a bundled function's `index.ts` lands in the CLI-expected deploy layout. */
export function functionSlugDir(name: string, root: string = os.tmpdir()): string {
  return path.join(root, "supabase", "functions", name);
}

/** Where a bundle ships relative to this module's own installed directory. */
export function resolveBundlePath(moduleDir: string, name: string): string {
  return path.join(moduleDir, "functions", `${name}.ts`);
}

/** The per-user connector URL: the MCP token lives in the path by design. */
export function connectorUrl(ref: string, mcpToken: string): string {
  return `https://${ref}.supabase.co/functions/v1/health-mcp/${mcpToken}`;
}

/** The ingest endpoint (the key is sent separately, as the `X-Api-Key` header). */
export function ingestUrl(ref: string): string {
  return `https://${ref}.supabase.co/functions/v1/health-ingest`;
}

/** Reads a project ref out of `supabase projects create --output-format json` output. */
export function parseProjectRef(raw: string): string | null {
  try {
    const data: unknown = JSON.parse(raw);
    const obj = Array.isArray(data) ? data[0] : data;
    const ref = (obj as { ref?: unknown; id?: unknown } | undefined)?.ref ?? (obj as { id?: unknown } | undefined)?.id;
    return typeof ref === "string" && ref.length > 0 ? ref : null;
  } catch {
    return null;
  }
}

export interface ProjectSummary {
  ref: string;
  name: string;
  region?: string;
}

/** Reads `supabase projects list --output-format json` output; tolerant of malformed input. */
/** The CLI wraps list output as {projects: [...]} (observed v2.109+); older docs show a bare
 * array. Accept both. */
export function coerceProjectArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const inner = (data as { projects?: unknown } | null | undefined)?.projects;
  return Array.isArray(inner) ? inner : [];
}

export function parseProjectList(raw: string): ProjectSummary[] {
  try {
    const data = coerceProjectArray(JSON.parse(raw));
    if (data.length === 0) return [];
    return data
      .map((p): ProjectSummary | null => {
        const ref = (p as { ref?: unknown; id?: unknown }).ref ?? (p as { id?: unknown }).id;
        const name = (p as { name?: unknown }).name;
        const region = (p as { region?: unknown }).region;
        if (typeof ref !== "string" || ref.length === 0) return null;
        return {
          ref,
          name: typeof name === "string" && name.length > 0 ? name : ref,
          region: typeof region === "string" ? region : undefined,
        };
      })
      .filter((p): p is ProjectSummary => p !== null);
  } catch {
    return [];
  }
}

/**
 * True iff `ref`'s entry in `supabase projects list --output-format json` output reports a
 * healthy/active status (`ACTIVE_HEALTHY`). Accepts either the raw JSON string (as returned by
 * `runSupabase(...).stdout`) or an already-parsed value; tolerant of malformed/unexpected input —
 * a missing ref, a non-ready status (e.g. `COMING_UP`), or invalid JSON all resolve to `false`.
 */
export function isProjectReady(listJson: unknown, ref: string): boolean {
  try {
    const parsed: unknown = typeof listJson === "string" ? JSON.parse(listJson) : listJson;
    const data = coerceProjectArray(parsed);
    for (const entry of data) {
      const r =
        (entry as { ref?: unknown; id?: unknown } | undefined)?.ref ??
        (entry as { id?: unknown } | undefined)?.id;
      if (r !== ref) continue;
      const status = (entry as { status?: unknown } | undefined)?.status;
      return typeof status === "string" && status.toUpperCase() === "ACTIVE_HEALTHY";
    }
    return false;
  } catch {
    return false;
  }
}

export interface OrgSummary {
  id: string;
  name: string;
}

/** Reads `supabase orgs list --output-format json` output; tolerant of malformed input. */
export function parseOrgList(raw: string): OrgSummary[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    // Same wrapper pattern as projects list: {organizations: [...]} (observed v2.110).
    const data = Array.isArray(parsed)
      ? parsed
      : ((parsed as { organizations?: unknown } | null | undefined)?.organizations as unknown[] | undefined) ?? [];
    if (!Array.isArray(data)) return [];
    return data
      .map((o) => {
        const id = (o as { id?: unknown }).id;
        const name = (o as { name?: unknown }).name;
        if (typeof id !== "string" || id.length === 0) return null;
        return { id, name: typeof name === "string" && name.length > 0 ? name : id };
      })
      .filter((o): o is OrgSummary => o !== null);
  } catch {
    return [];
  }
}

/** Resolves the installed `@almostjacked/health-mcp-core` package's bundled setup.sql. */
export function resolveCoreSetupSql(): string {
  const require = createRequire(import.meta.url);
  // The core package's `exports` map only publishes ".", so we can't resolve
  // ".../package.json" or ".../setup.sql" directly — resolve the main entry
  // (dist/index.js) and walk up to the package root, where setup.sql ships
  // alongside dist/ (see packages/core/package.json's `files`).
  const mainEntry = require.resolve("@almostjacked/health-mcp-core");
  return path.join(path.dirname(mainEntry), "..", "setup.sql");
}

// ---------------------------------------------------------------------------
// Thin orchestration — not unit-tested; shells out to the real `supabase` CLI.
// ---------------------------------------------------------------------------

interface CliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

function runSupabase(args: string[]): CliResult {
  const res = spawnSync("npx", ["-y", "supabase@latest", ...args], { encoding: "utf8" });
  return { ok: res.status === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status };
}

/** Same call, but with stdio inherited — for `login`, which needs a real TTY/browser. */
function runSupabaseInteractive(args: string[]): number {
  const res = spawnSync("npx", ["-y", "supabase@latest", ...args], { stdio: "inherit" });
  return res.status ?? 1;
}

/** Compact one-line failure reason from a CliResult, for narration (never logs secrets). */
function summarize(result: CliResult): string {
  const raw = (result.stdout || result.stderr || "").trim();
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    const msg = parsed?.error?.message ?? parsed?.message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  } catch {
    // not JSON — fall through to the raw text
  }
  return raw || `exit code ${result.status ?? "unknown"}`;
}

export interface SetupFlags {
  mode?: "new" | "existing";
  name?: string;
  ref?: string;
  orgIndex?: number;
  region?: string;
}

/** Parse non-interactive flags: --new | --existing <ref> | --name <n> | --org-index <i>. */
export function parseSetupFlags(argv: string[]): SetupFlags {
  const f: SetupFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--new") f.mode = "new";
    else if (a === "--existing") { f.mode = "existing"; f.ref = argv[++i]; }
    else if (a === "--name") f.name = argv[++i];
    else if (a === "--org-index") f.orgIndex = Number(argv[++i]);
    else if (a === "--region") f.region = argv[++i];
  }
  return f;
}

async function ask(rl: ReturnType<typeof createInterface>, question: string, def?: string): Promise<string> {
  const suffix = def ? ` [${def}]` : "";
  const closed = new Promise<never>((_, reject) =>
    rl.once("close", () => reject(new Error("stdin closed before all answers were provided — for non-interactive use pass --new --name <name> [--org-index N] or --existing <ref>"))),
  );
  const answer = (await Promise.race([rl.question(`${question}${suffix}: `), closed])).trim();
  return answer.length > 0 ? answer : (def ?? "");
}

interface ChosenProject {
  ref: string;
  dbPassword?: string;
  /** True only when this project was just created by this run (vs. an existing one the user picked). */
  isNew: boolean;
}

async function chooseProject(
  rl: ReturnType<typeof createInterface>,
  initialList: CliResult,
  flags: SetupFlags = {},
): Promise<ChosenProject | null> {
  console.log("\nStep 3/6: choose a Supabase project");
  if (flags.mode === "existing" && flags.ref) return { ref: flags.ref, isNew: false };
  const mode = flags.mode === "new"
    ? "n"
    : (await ask(rl, "Create a [n]ew project or use an [e]xisting one? (n/e)", "n")).toLowerCase();

  if (mode.startsWith("e")) {
    const projects = parseProjectList(initialList.stdout);
    if (projects.length === 0) {
      console.log("  (could not list existing projects)");
      const ref = await ask(rl, "  Paste the project ref (from your dashboard project URL)");
      return ref ? { ref, isNew: false } : null;
    }
    console.log("  Your projects:");
    for (const [i, p] of projects.entries()) {
      console.log(`    ${i + 1}. ${p.name}  (${p.ref})${p.region ? `  ${p.region}` : ""}`);
    }
    const picked = await ask(rl, `  Pick a number (1-${projects.length}), or paste a ref directly`, "1");
    const idx = Number(picked);
    const ref = Number.isInteger(idx) && idx >= 1 && idx <= projects.length ? projects[idx - 1].ref : picked;
    return ref ? { ref, isNew: false } : null;
  }

  const name = flags.name ?? (await ask(rl, "  Project name", "health-mcp"));

  const orgsResult = runSupabase(["orgs", "list", "--output-format", "json"]);
  const orgs = parseOrgList(orgsResult.stdout);
  let orgId: string;
  if (orgs.length === 1) {
    orgId = orgs[0].id;
    console.log(`  Using organization "${orgs[0].name}" (${orgId}).`);
  } else if (orgs.length > 1) {
    console.log("  Your organizations:");
    for (const [i, o] of orgs.entries()) console.log(`    ${i + 1}. ${o.name}  (${o.id})`);
    const picked = flags.orgIndex != null ? String(flags.orgIndex) : await ask(rl, `  Pick a number (1-${orgs.length})`, "1");
    const idx = Number(picked);
    orgId = orgs[Number.isInteger(idx) && idx >= 1 && idx <= orgs.length ? idx - 1 : 0].id;
  } else {
    orgId = await ask(rl, "  Could not list organizations — paste your org ID (visible in the dashboard URL)");
  }
  if (!orgId) return null;

  const region = flags.region ??
    (await ask(rl, "  Region (e.g. us-east-1, us-west-2, eu-central-1)", "us-east-1"));
  const dbPassword = randomToken();
  console.log(`  Creating project "${name}" in ${region} ...`);
  const created = runSupabase([
    "projects",
    "create",
    name,
    "--org-id",
    orgId,
    "--region",
    region,
    "--db-password",
    dbPassword,
    "--output-format",
    "json",
  ]);
  if (!created.ok) {
    console.error(
      `  Could not create the project automatically (${summarize(created)}).\n` +
        "  Manual fallback: create it at https://supabase.com/dashboard/new, then re-run this wizard\n" +
        '  and choose "existing".',
    );
    return null;
  }
  const ref = parseProjectRef(created.stdout);
  if (!ref) {
    console.error(
      "  Project created, but its ref could not be read from the CLI output. Check the dashboard,\n" +
        '  then re-run this wizard and choose "existing" with that ref.',
    );
    return null;
  }
  console.log(`  Project created: ${ref}`);
  return { ref, dbPassword, isNew: true };
}

// ---------------------------------------------------------------------------
// Post-create provisioning wait (create-new-project path only)
// ---------------------------------------------------------------------------

const PROVISION_POLL_INTERVAL_MS = 10_000;
const PROVISION_TIMEOUT_MS = 5 * 60_000;

/** `await`-able sleep used by the provisioning poll loop. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `supabase projects list --output-format json` every 10s (up to 5 minutes) until the
 * newly-created project's ref reports a healthy/active status. Fresh Supabase projects take
 * 1-3 minutes to provision — without this wait, the immediately-following `link` / `db query` /
 * `functions deploy` calls would reliably fail into their manual fallbacks on the happy path.
 * Returns `false` on timeout (caller decides what to do — never throws).
 */
async function waitForProjectProvisioning(ref: string): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    const elapsedS = Math.round((Date.now() - start) / 1000);
    console.log(`  waiting for project provisioning... (${elapsedS}s)`);
    const list = runSupabase(["projects", "list", "--output-format", "json"]);
    if (list.ok && isProjectReady(list.stdout, ref)) return true;
    if (Date.now() - start >= PROVISION_TIMEOUT_MS) return false;
    await sleep(PROVISION_POLL_INTERVAL_MS);
  }
}

function printSchemaFallback(ref: string, sqlPath: string, reason: string): void {
  console.error(
    `  Could not apply the schema automatically (${reason}).\n` +
      `  Manual fallback: open https://supabase.com/dashboard/project/${ref}/sql/new, paste the\n` +
      `  contents of\n` +
      `    ${sqlPath}\n` +
      "  and run it (idempotent — safe to re-run).",
  );
}

function applySchema(tmpRoot: string, ref: string, dbPassword: string | undefined, sqlPath: string): void {
  console.log("\nStep 4/6: applying the database schema");
  const linkArgs = ["link", "--project-ref", ref, "--workdir", tmpRoot];
  if (dbPassword) linkArgs.push("--password", dbPassword);
  const linked = runSupabase(linkArgs);
  if (!linked.ok) {
    printSchemaFallback(ref, sqlPath, summarize(linked));
    return;
  }
  const applied = runSupabase(["db", "query", "--linked", "--file", sqlPath, "--workdir", tmpRoot]);
  if (!applied.ok) {
    printSchemaFallback(ref, sqlPath, summarize(applied));
    return;
  }
  console.log("  schema applied.");
}

const FUNCTION_NAMES = ["health-mcp", "health-ingest"] as const;

function deployFunctions(tmpRoot: string, moduleDir: string, ref: string): void {
  console.log("\nStep 5/6: deploying edge functions");
  for (const name of FUNCTION_NAMES) {
    const source = resolveBundlePath(moduleDir, name);
    if (!existsSync(source)) {
      console.error(
        `  Bundle for "${name}" was not found at ${source}.\n` +
          "  Manual fallback: reinstall the package (`npm install -g @almostjacked/health-mcp@latest`),\n" +
          `  or copy dist/functions/${name}.ts from the repo into the dashboard's Edge Functions ->\n` +
          `  "${name}" code editor and deploy from there (turn off JWT verification).`,
      );
      continue;
    }
    const destDir = functionSlugDir(name, tmpRoot);
    mkdirSync(destDir, { recursive: true });
    copyFileSync(source, path.join(destDir, "index.ts"));
    const deployed = runSupabase([
      "functions",
      "deploy",
      name,
      "--project-ref",
      ref,
      "--use-api",
      "--no-verify-jwt",
      "--workdir",
      tmpRoot,
    ]);
    if (!deployed.ok) {
      console.error(
        `  Could not deploy "${name}" automatically (${summarize(deployed)}).\n` +
          `  Manual fallback: in the dashboard's Edge Functions tab, create a function named "${name}"\n` +
          "  with JWT verification off, and paste in the contents of\n" +
          `    ${source}`,
      );
      continue;
    }
    console.log(`  deployed "${name}".`);
  }
}

function printResults(ref: string, mcpToken: string, ingestKey: string): void {
  const connector = connectorUrl(ref, mcpToken);
  const ingest = ingestUrl(ref);
  console.log(
    "\n" +
      `${"=".repeat(64)}\n` +
      " health-mcp setup complete\n" +
      `${"=".repeat(64)}\n\n` +
      "Connector URL (claude.ai -> Settings -> Connectors -> Add custom connector):\n" +
      `  ${connector}\n\n` +
      "Ingest endpoint (for the Apple Shortcut, or any HTTP client writing data):\n" +
      `  URL: ${ingest}\n` +
      `  Key: ${ingestKey}\n` +
      '  (send the key as the "X-Api-Key" header — it will not be printed again)\n\n' +
      'Store the connector URL and both keys in a password manager: the URL embeds your\n' +
      'MCP token, and secret values cannot be read back from Supabase later.\n\n' +
      "If any step above printed a manual fallback, finish it in the Supabase dashboard\n" +
      `(https://supabase.com/dashboard/project/${ref}) before continuing.\n\n` +
      "Next steps:\n" +
      "  1. Load your history: Health app -> your profile -> Export All Health Data,\n" +
      "     then drop the export.zip on the setup page's Import panel (dry-run first).\n" +
      "     Skip this and adaptive-TDEE needs ~2 weeks of daily syncs before it works;\n" +
      "     do it and everything works immediately.\n" +
      "  2. Build your Shortcut: https://almostjacked.github.io/health-mcp/#shortcut\n" +
      "     generates your personal iOS Shortcut for the daily sync -- install it and\n" +
      "     turn on the 9 AM automation.\n" +
      "  3. Connect Claude: claude.ai -> Settings -> Connectors -> Add custom connector,\n" +
      "     paste in the Connector URL above, and save.\n" +
      '     (If it fails with "Couldn\'t register with [name]\'s sign-in service", that\'s a\n' +
      "     transient claude.ai hiccup -- just try adding it again.)\n",
  );
}

export async function main(): Promise<void> {
  console.log("health-mcp setup wizard\n");

  console.log("Step 1/6: checking for the Supabase CLI (via `npx supabase`)");
  const version = runSupabase(["--version"]);
  if (!version.ok) {
    let sqlPath = "packages/core/setup.sql";
    try {
      sqlPath = resolveCoreSetupSql();
    } catch {
      // best-effort — fall back to the repo-relative path in the message
    }
    console.error(
      `  Could not run the Supabase CLI (${summarize(version)}).\n` +
        "  This wizard shells out to `npx -y supabase@latest`, which needs a working `npx` and network\n" +
        "  access the first time it runs. Install Node >= 18, confirm `npx --version` works, then re-run:\n" +
        "    npx -y @almostjacked/health-mcp setup\n\n" +
        "  Manual fallback: create a project at https://supabase.com/dashboard, run the SQL in\n" +
        `    ${sqlPath}\n` +
        "  in the SQL Editor, then add MCP_TOKEN / INGEST_KEY as Edge Function secrets and paste the\n" +
        "  two bundled functions (dist/functions/health-mcp.ts, dist/functions/health-ingest.ts) into\n" +
        "  the dashboard's Edge Functions tab, with JWT verification off.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  found supabase CLI ${version.stdout.trim()}`);

  console.log("\nStep 2/6: checking Supabase login");
  let probe = runSupabase(["projects", "list", "--output-format", "json"]);
  if (!probe.ok) {
    if (!process.stdin.isTTY) {
      console.error(
        "  Not logged in to Supabase, and this session is non-interactive so the wizard can't launch\n" +
          "  the browser login flow. Run:\n" +
          "    npx -y supabase@latest login\n" +
          "  (or set SUPABASE_ACCESS_TOKEN), then re-run:\n" +
          "    npx -y @almostjacked/health-mcp setup",
      );
      process.exitCode = 1;
      return;
    }
    console.log("  not logged in — launching `supabase login` (opens your browser) ...");
    const loginStatus = runSupabaseInteractive(["login"]);
    if (loginStatus === 0) probe = runSupabase(["projects", "list", "--output-format", "json"]);
    if (loginStatus !== 0 || !probe.ok) {
      console.error(
        "  Login did not complete. Manual fallback: run `npx -y supabase@latest login` yourself,\n" +
          "  then re-run this wizard.",
      );
      process.exitCode = 1;
      return;
    }
  }
  console.log("  logged in.");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "health-mcp-setup-"));
  try {
    let project: ChosenProject | null;
    try {
      project = await chooseProject(rl, probe, parseSetupFlags(process.argv.slice(3)));
    } catch (e) {
      console.error(`\n  ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
      return;
    }
    if (!project) {
      console.error(
        "  No project selected — aborting. Manual fallback: create a project at\n" +
          '  https://supabase.com/dashboard/new, then re-run this wizard and choose "existing".',
      );
      process.exitCode = 1;
      return;
    }
    const { ref, dbPassword, isNew } = project;

    if (isNew) {
      console.log("\nNew project created — waiting for it to finish provisioning (can take 1-3 minutes)...");
      const ready = await waitForProjectProvisioning(ref);
      if (!ready) {
        console.error(
          "\n  Timed out after 5 minutes waiting for the new project to finish provisioning.\n" +
            "  Manual fallback: wait for the project to finish provisioning in the dashboard, then re-run\n" +
            '  `npx @almostjacked/health-mcp setup` and choose "use existing".',
        );
			process.exitCode = 1;
        return;
      }
      console.log("  project is ready.");
    }

    let sqlPath: string;
    try {
      sqlPath = resolveCoreSetupSql();
    } catch {
      sqlPath = "packages/core/setup.sql";
    }

    const scaffold = runSupabase(["init", "--workdir", tmpRoot]);
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    if (!scaffold.ok) {
      console.error(
        `\n  Could not prepare a local working directory for the Supabase CLI (${summarize(scaffold)}).\n` +
          "  Falling back to manual instructions for the schema and function deploy steps.",
      );
      printSchemaFallback(ref, sqlPath, "no local CLI working directory");
      deployFunctionsFallbackOnly(moduleDir, ref);
    } else {
      applySchema(tmpRoot, ref, dbPassword, sqlPath);
      deployFunctions(tmpRoot, moduleDir, ref);
    }

    const mcpToken = randomToken();
    const ingestKey = randomToken();
    console.log("\nStep 6/6: setting MCP_TOKEN / INGEST_KEY secrets");
    const secrets = runSupabase(["secrets", "set", `MCP_TOKEN=${mcpToken}`, `INGEST_KEY=${ingestKey}`, "--project-ref", ref]);
    if (!secrets.ok) {
      console.error(
        `  Could not set secrets automatically (${summarize(secrets)}).\n` +
          "  Manual fallback: in the dashboard, go to Edge Functions -> Secrets and add MCP_TOKEN and\n" +
          "  INGEST_KEY using the values embedded in the connector URL below.",
      );
    } else {
      console.log("  secrets set.");
    }

    printResults(ref, mcpToken, ingestKey);
  } finally {
    rl.close();
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup only
    }
  }
}

/** Used when we couldn't even scaffold a working directory — prints both functions' fallbacks. */
function deployFunctionsFallbackOnly(moduleDir: string, ref: string): void {
  for (const name of FUNCTION_NAMES) {
    const source = resolveBundlePath(moduleDir, name);
    console.error(
      `  Manual fallback for "${name}": in the dashboard's Edge Functions tab, create a function\n` +
        `  named "${name}" with JWT verification off, and paste in the contents of\n` +
        `    ${source}\n` +
        `  (function URL will be https://${ref}.supabase.co/functions/v1/${name}).`,
    );
  }
}
