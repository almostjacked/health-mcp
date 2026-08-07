# Re-signing the canonical Shortcut

The setup page ships ONE pre-signed "Sync Health Data" shortcut for
everyone — `web/assets/sync-health-data-signed.shortcut` — instead of
generating and signing a fresh file per user. It carries no personal data:
your ingest URL and key are placeholders that iOS prompts you to fill in at
import time (`WFWorkflowImportQuestions`), so the same signed file works for
every user without breaking Apple's signature.

## When this needs to happen

Whenever `web/src/shortcut/plist.ts`'s action graph changes (a new metric,
a different request shape, etc.), the signed asset in `web/assets/` needs
to be regenerated and re-signed, or the setup page keeps serving the old
version forever.

## CI signing: verified NOT working — do the manual path below

[`.github/workflows/sign-shortcut.yml`](../.github/workflows/sign-shortcut.yml)
runs on `macos-latest`, builds the canonical file, and attempts
`shortcuts sign -m anyone`. Dispatched once by hand to check
(2026-08-07, run
[31193950707](https://github.com/almostjacked/health-mcp/actions/runs/31193950707)):
it fails every time, at the sign step, with

```
Error: In order to do this, you must be signed into iCloud.
```

GitHub-hosted macOS runners have no Apple ID session, and there's no
supported way to provision one non-interactively (no headless
`iCloud sign in` command exists, and stashing real Apple credentials in
repo secrets to feed an interactive login isn't something this project is
going to do). So this workflow is `workflow_dispatch`-only — kept as a
ready-to-go escape hatch in case that ever changes (self-hosted macOS
runner with an iCloud session already signed in, a future runner image,
etc.) — but **the day-to-day path is the manual one-liner below**, and
that's genuinely fine: it's a single command on a Mac you already own,
takes a few seconds, and only needs to happen when
`web/src/shortcut/plist.ts`'s action graph changes (rare).

## Manual one-liner (any Mac already signed into iCloud)

You need a Mac (any recent macOS with the Shortcuts app, **signed into
iCloud** — that's the actual requirement CI is missing; no paid Apple
Developer account needed, `-m anyone` produces an "anyone can run this"
trust level, not an identity-backed signature) and Node ≥ 18.

```bash
git clone https://github.com/almostjacked/health-mcp.git
cd health-mcp
corepack enable
pnpm install
pnpm build:shortcut
shortcuts sign -m anyone -i build/sync-health-data.shortcut -o web/assets/sync-health-data-signed.shortcut
git add web/assets/sync-health-data-signed.shortcut
git commit -m "chore: sign canonical shortcut [sign-bot]"
git push
```

Pushing to `main` triggers the Pages workflow, which rebuilds `web/dist`
(copying whatever's in `web/assets/` alongside it) and redeploys the setup
page — usually live within a couple of minutes.

## If the signed asset is missing entirely

`web/scripts/build.mjs` tolerates `web/assets/` being empty or absent — the
site still builds, just without a shortcut file to serve. The Shortcut
panel (`web/src/panels/shortcut.ts`) detects this (its download button
fetches `./sync-health-data-signed.shortcut` and checks the response) and
falls back to the manual/advanced instructions: the "Advanced: bake values
into a custom build" section, which reuses the original per-user generator
(`buildShortcut` in `web/src/shortcut/plist.ts`, or
`scripts/generate_shortcut.py`) and walks through signing that file by
hand — the same one-liner as above, just with a per-user file instead of
the canonical one.

After signing, refresh the drift marker (CI enforces it):

```bash
shasum -a 256 build/sync-health-data.shortcut | cut -d' ' -f1 > web/assets/canonical.sha256
```
