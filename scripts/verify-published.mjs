// Fallback for `changeset publish` failing on an already-published version.
//
// `changeset publish` decides what to publish from `npm info`, which can serve
// stale registry data; its built-in grace path for the resulting "cannot publish
// over the previously published versions" error is broken against npm >= 11
// (npm omits error.code, changesets requires E403). When publish fails, this
// script re-checks the registry directly: if every publishable workspace
// package's local version already exists on npm there was nothing to publish
// and the failure is a no-op — exit 0. Any genuinely unpublished version means
// a real failure — exit 1.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packages = ["packages/core/package.json", "apps/mcp/package.json"];

let ok = true;
for (const path of packages) {
  const { name, version, private: isPrivate } = JSON.parse(readFileSync(path, "utf8"));
  if (isPrivate) continue;
  let versions = [];
  try {
    versions = JSON.parse(
      execFileSync("npm", ["view", name, "versions", "--json"], { encoding: "utf8" }),
    );
  } catch {
    // package never published at all
  }
  if (Array.isArray(versions) ? versions.includes(version) : versions === version) {
    console.log(`ok: ${name}@${version} is on the registry`);
  } else {
    console.error(`MISSING: ${name}@${version} is not on the registry`);
    ok = false;
  }
}

process.exit(ok ? 0 : 1);
