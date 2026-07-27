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
  isProjectReady,
  parseSetupFlags,
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

  describe("isProjectReady", () => {
    it("returns true when the ref's status is ACTIVE_HEALTHY", () => {
      expect(isProjectReady('[{"ref":"abcref","status":"ACTIVE_HEALTHY"}]', "abcref")).toBe(true);
    });

    it("returns false when the ref's status is still COMING_UP", () => {
      expect(isProjectReady('[{"ref":"abcref","status":"COMING_UP"}]', "abcref")).toBe(false);
    });

    it("returns false when the ref is missing from the list", () => {
      expect(isProjectReady('[{"ref":"other","status":"ACTIVE_HEALTHY"}]', "abcref")).toBe(false);
      expect(isProjectReady("[]", "abcref")).toBe(false);
    });

    it("returns false on malformed JSON", () => {
      expect(isProjectReady("not json", "abcref")).toBe(false);
      expect(isProjectReady("{}", "abcref")).toBe(false);
    });

    it("also accepts an already-parsed value (not just a raw string)", () => {
      expect(isProjectReady([{ ref: "abcref", status: "ACTIVE_HEALTHY" }], "abcref")).toBe(true);
      expect(isProjectReady([{ id: "abcref", status: "ACTIVE_HEALTHY" }], "abcref")).toBe(true);
    });
  });
});

describe("real CLI output shape (wrapped object)", () => {
	const wrapped = JSON.stringify({
		projects: [
			{ id: "abc123", ref: "abc123", name: "health-mcp-e2e", region: "us-west-2", status: "ACTIVE_HEALTHY" },
			{ id: "zzz999", ref: "zzz999", name: "other", region: "us-east-1", status: "COMING_UP" },
		],
		message: "",
	});
	it("parseProjectList handles the {projects: []} wrapper", () => {
		const list = parseProjectList(wrapped);
		expect(list.map((p) => p.ref)).toEqual(["abc123", "zzz999"]);
	});
	it("isProjectReady handles the wrapper", () => {
		expect(isProjectReady(wrapped, "abc123")).toBe(true);
		expect(isProjectReady(wrapped, "zzz999")).toBe(false);
	});
});

describe("parseSetupFlags", () => {
	it("parses new-project flags", () => {
		expect(parseSetupFlags(["--new", "--name", "e2e", "--org-index", "2"]))
			.toEqual({ mode: "new", name: "e2e", orgIndex: 2 });
	});
	it("parses existing-ref flags", () => {
		expect(parseSetupFlags(["--existing", "abc123"])).toEqual({ mode: "existing", ref: "abc123" });
	});
	it("empty argv -> empty flags", () => {
		expect(parseSetupFlags([])).toEqual({});
	});
});

describe("parseOrgList real CLI shape", () => {
	it("handles the {organizations: []} wrapper", () => {
		const raw = JSON.stringify({ organizations: [{ id: "o1", slug: "o1", name: "acme" }], message: "" });
		expect(parseOrgList(raw)).toEqual([{ id: "o1", name: "acme" }]);
	});
});
