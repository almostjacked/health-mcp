import { describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./server.js";

describe("stdio server", () => {
  test("buildServer registers the 7 data tools (get_energy_inputs present, get_energy_model absent)", async () => {
    const server = buildServer({ SUPABASE_URL: "https://p.supabase.co", SUPABASE_SECRET_KEY: "k" });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(clientT);
    const { tools } = await client.listTools();
    expect(tools.length).toBe(7);
    expect(tools.some((t) => t.name === "get_energy_inputs")).toBe(true);
    expect(tools.some((t) => t.name === "get_energy_model")).toBe(false);
  });
});
