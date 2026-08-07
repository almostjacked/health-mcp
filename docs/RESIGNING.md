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

## Automatic path

[`.github/workflows/sign-shortcut.yml`](../.github/workflows/sign-shortcut.yml)
runs on `macos-latest` (needs Apple's `shortcuts` CLI, which only exists on
macOS), builds the canonical file, signs it with `shortcuts sign -m anyone`,
and commits `web/assets/sync-health-data-signed.shortcut` back to `main`.
It's triggered automatically by pushes touching `web/src/shortcut/**`, and
can also be run manually: **Actions → Sign Canonical Shortcut → Run
workflow**.

If that workflow is green, you don't need anything below — this doc is the
fallback for when it isn't (e.g. `macos-latest` runners stop shipping the
`shortcuts` CLI, or some future macOS Gatekeeper/signing-identity change
breaks unattended signing in CI).

## Manual fallback (one-liner on any Mac)

You need a Mac (any recent macOS with the Shortcuts app; no Apple Developer
account or signed-in state is required — `-m anyone` produces an
"anyone can run this" trust level, not an identity-backed signature) and
Node ≥ 18.

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
