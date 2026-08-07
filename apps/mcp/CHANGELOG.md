# @almostjacked/health-mcp

## 0.1.3

### Patch Changes

- 4783108: Shortcut panel and docs/shortcut.md now point to one canonical "Sync Health Data" shortcut, signed once per release, instead of generating and signing a per-user file — iOS's Import Questions prompt for your ingest URL/key during import without invalidating the signature, so there's no signing step for users. The per-user generator (and manual signing instructions) is still available in a collapsed "Advanced: bake values into a custom build" section for anyone who prefers values baked in.

## 0.1.2

### Patch Changes

- 3f71d66: Setup wizard and page advise storing the connector URL and keys in a password manager (values are not recoverable later — rotation only).

## 0.1.1

### Patch Changes

- 0082a04: CORS support on the ingest edge function; provision panel pivots to wizard instructions (Management API blocks browsers).
- d8ad99f: Wizard results now point to the setup page for history import + Shortcut; journey docs.
- Updated dependencies [0082a04]
  - @almostjacked/health-mcp-core@0.1.1
