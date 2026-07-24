import { describe, it, expect } from "vitest";
import { guardSql } from "../src/sql-guard";

describe("guardSql", () => {
	it("allows plain SELECT and appends LIMIT 500", () => {
		expect(guardSql("SELECT * FROM daily_totals")).toEqual({ ok: true, sql: "SELECT * FROM daily_totals LIMIT 500" });
	});

	it("allows WITH … SELECT (CTEs are required for real analysis)", () => {
		const r = guardSql("WITH d AS (SELECT date, value FROM daily_totals) SELECT * FROM d LIMIT 10");
		expect(r).toEqual({ ok: true, sql: "WITH d AS (SELECT date, value FROM daily_totals) SELECT * FROM d LIMIT 10" });
	});

	it("tolerates one trailing semicolon but rejects statement chaining", () => {
		expect(guardSql("SELECT 1;").ok).toBe(true);
		expect(guardSql("SELECT 1; DROP TABLE daily_totals").ok).toBe(false);
	});

	it("rejects every write/DDL keyword", () => {
		for (const bad of [
			"INSERT INTO daily_totals VALUES ('x','y',1,'z',null)",
			"UPDATE daily_totals SET value = 0",
			"DELETE FROM measurements",
			"DROP TABLE measurements",
			"ALTER TABLE measurements ADD c TEXT",
			"CREATE TABLE t (x)",
			"PRAGMA table_info(measurements)",
			"ATTACH DATABASE 'x' AS y",
			"VACUUM",
			"SELECT * FROM measurements WHERE 1=1 UNION SELECT 1 WHERE (SELECT 1) IN (SELECT 1); DELETE FROM measurements",
		]) {
			expect(guardSql(bad).ok).toBe(false);
		}
	});

	it("does not false-positive on column names containing keywords", () => {
		expect(guardSql("SELECT created_at, updated_at FROM measurements").ok).toBe(true);
	});

	it("rejects comments and non-SELECT starts", () => {
		expect(guardSql("SELECT 1 -- sneaky").ok).toBe(false);
		expect(guardSql("/* hi */ SELECT 1").ok).toBe(false);
		expect(guardSql("EXPLAIN SELECT 1").ok).toBe(false);
	});

	it("preserves an existing LIMIT", () => {
		const r = guardSql("SELECT date FROM measurements LIMIT 5");
		expect(r.ok && r.sql.endsWith("LIMIT 5")).toBe(true);
	});

	it("appends a top-level LIMIT even when a subquery has its own LIMIT", () => {
		const r = guardSql("SELECT * FROM measurements WHERE id IN (SELECT id FROM measurements LIMIT 1)");
		expect(r.ok && r.sql.endsWith("LIMIT 500")).toBe(true);
	});

	it("a quoted string containing 'limit 5' does not count as a LIMIT", () => {
		const r = guardSql("SELECT * FROM measurements WHERE source = 'limit 5'");
		expect(r.ok && r.sql.endsWith("LIMIT 500")).toBe(true);
	});

	it("rejects pragma table-valued functions", () => {
		expect(guardSql("SELECT * FROM pragma_table_info('measurements')").ok).toBe(false);
	});

	it("rejects postgres write/admin keywords", () => {
		for (const bad of ["GRANT SELECT ON x TO y", "TRUNCATE daily_totals", "COPY t FROM '/x'", "DO $$ BEGIN END $$", "SET role postgres"]) {
			expect(guardSql(bad).ok).toBe(false);
		}
	});
});
