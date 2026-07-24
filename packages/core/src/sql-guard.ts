const DENY =
	/\b(insert|update|delete|drop|alter|create|replace|pragma\w*|attach|detach|vacuum|reindex|begin|commit|rollback|grant|revoke|truncate|copy|call|do|listen|notify|lock|security|set|reset)\b/i;

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

/** True only when a LIMIT exists at paren-depth 0, outside string literals —
 * a subquery's LIMIT must not suppress the top-level cap. */
function hasTopLevelLimit(sql: string): boolean {
	const re = /'(?:[^']|'')*'|[()]|\blimit\s+\d+/gi;
	let depth = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(sql))) {
		const tok = m[0];
		if (tok === "(") depth++;
		else if (tok === ")") depth = Math.max(0, depth - 1);
		else if (tok.startsWith("'")) continue;
		else if (depth === 0) return true;
	}
	return false;
}

/** SELECT/WITH-only, single statement, no comments, LIMIT enforced.
 * Note: also blocks SQLite's replace() string function — acceptable tradeoff. */
export function guardSql(input: string): GuardResult {
	let sql = input.trim();
	if (sql.endsWith(";")) sql = sql.slice(0, -1).trimEnd();
	if (sql.includes(";")) return { ok: false, reason: "single statement only — no semicolons" };
	if (sql.includes("--") || sql.includes("/*")) return { ok: false, reason: "comments are not allowed" };
	if (!/^(with|select)\b/i.test(sql)) return { ok: false, reason: "only SELECT (or WITH … SELECT) queries are allowed" };
	const m = sql.match(DENY);
	if (m) return { ok: false, reason: `forbidden keyword: ${m[0].toUpperCase()}` };
	if (!hasTopLevelLimit(sql)) sql = `${sql} LIMIT 500`;
	return { ok: true, sql };
}
