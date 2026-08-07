---
"@almostjacked/health-mcp": patch
---

Shortcut panel and docs/shortcut.md now point to one canonical "Sync Health Data" shortcut, signed once per release, instead of generating and signing a per-user file — iOS's Import Questions prompt for your ingest URL/key during import without invalidating the signature, so there's no signing step for users. The per-user generator (and manual signing instructions) is still available in a collapsed "Advanced: bake values into a custom build" section for anyone who prefers values baked in.
