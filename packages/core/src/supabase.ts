/** Literal-SQL transport to Supabase: POST to the run_readonly RPC.
 * All read-only enforcement lives in the database (SELECT-only role,
 * statement timeout) — see supabase/setup.sql. */

export interface SupabaseEnv {
	SUPABASE_URL: string;
	SUPABASE_SECRET_KEY: string;
}

/** SQL literal for zod/registry-validated values only. */
export function lit(value: string | number): string {
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`non-finite number in SQL literal: ${value}`);
		return String(value);
	}
	return `'${value.replaceAll("'", "''")}'`;
}

export async function writeRows(
	env: SupabaseEnv,
	table: string,
	onConflict: string,
	resolution: "merge-duplicates" | "ignore-duplicates",
	rows: object[],
): Promise<number> {
	let written = 0;
	for (let i = 0; i < rows.length; i += 500) {
		const batch = rows.slice(i, i + 500);
		const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
			method: "POST",
			headers: {
				apikey: env.SUPABASE_SECRET_KEY,
				Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
				"Content-Type": "application/json",
				Prefer: `resolution=${resolution},return=representation`,
			},
			body: JSON.stringify(batch),
		});
		const text = await res.text();
		if (!res.ok) throw new Error(`supabase write ${table} ${res.status}: ${text.slice(0, 300)}`);
		written += (JSON.parse(text) as unknown[]).length;
	}
	return written;
}

export async function runSql(env: SupabaseEnv, sql: string): Promise<Record<string, unknown>[]> {
	const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/run_readonly`, {
		method: "POST",
		headers: {
			apikey: env.SUPABASE_SECRET_KEY,
			Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ q: sql }),
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`supabase rpc ${res.status}: ${text.slice(0, 300)}`);
	const data = JSON.parse(text);
	return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}
