import { describe, it, expect } from "vitest";
import {
  randomToken,
  functionSlugDir,
  resolveBundlePath,
  connectorUrl,
  ingestUrl,
  parseProjectRef,
  parseProjectList,
  parseOrgList,
} from "./setup.js";

describe("setup helpers", () => {
  it("randomToken: 48 url-safe chars, unique", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(a).not.toBe(b);
  });

  it("functionSlugDir maps bundle names", () => {
    expect(functionSlugDir("health-mcp")).toContain("functions/health-mcp");
    expect(functionSlugDir("health-ingest", "/tmp/root")).toBe("/tmp/root/supabase/functions/health-ingest");
  });

  it("resolveBundlePath joins the module dir with the bundle filename", () => {
    expect(resolveBundlePath("/a/b/dist", "health-mcp")).toBe("/a/b/dist/functions/health-mcp.ts");
  });

  it("connectorUrl embeds the ref and token in the health-mcp function path", () => {
    expect(connectorUrl("abcref", "tok123")).toBe("https://abcref.supabase.co/functions/v1/health-mcp/tok123");
  });

  it("ingestUrl embeds the ref in the health-ingest function path", () => {
    expect(ingestUrl("abcref")).toBe("https://abcref.supabase.co/functions/v1/health-ingest");
  });

  it("parseProjectRef reads `ref` or `id` from CLI JSON output, single object or array", () => {
    expect(parseProjectRef('{"ref":"abcdefghijklmnopqrst"}')).toBe("abcdefghijklmnopqrst");
    expect(parseProjectRef('{"id":"abcdefghijklmnopqrst"}')).toBe("abcdefghijklmnopqrst");
    expect(parseProjectRef('[{"id":"abcdefghijklmnopqrst"}]')).toBe("abcdefghijklmnopqrst");
    expect(parseProjectRef("not json")).toBeNull();
    expect(parseProjectRef("{}")).toBeNull();
  });

  it("parseProjectList tolerates malformed input and maps known fields", () => {
    expect(parseProjectList("not json")).toEqual([]);
    expect(parseProjectList("{}")).toEqual([]);
    expect(
      parseProjectList('[{"id":"ref1","name":"one","region":"us-east-1"},{"id":"ref2","name":"two"}]'),
    ).toEqual([
      { ref: "ref1", name: "one", region: "us-east-1" },
      { ref: "ref2", name: "two", region: undefined },
    ]);
  });

  it("parseOrgList tolerates malformed input and maps known fields", () => {
    expect(parseOrgList("not json")).toEqual([]);
    expect(parseOrgList('[{"id":"org1","name":"Acme"}]')).toEqual([{ id: "org1", name: "Acme" }]);
  });
});
