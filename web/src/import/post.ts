import type { IngestEntry } from "./aggregate.js";

const BATCH_SIZE = 500;

interface IngestResponse {
	inserted?: number;
	updated?: number;
	skipped?: number;
	rejected?: Array<{ reason?: string }>;
}

/** Posts entries to the worker's /ingest endpoint in batches, mirroring
 * backfill.py's `post_batches` (backfill/backfill.py lines 114-143): same
 * batch size, same X-Api-Key auth, same running totals across
 * inserted/updated/skipped/rejected, same "batch N failed" error context on
 * a non-2xx response. */
export async function postEntries(
	entries: IngestEntry[],
	ingestUrl: string,
	key: string,
	onProgress: (sent: number, total: number, written: number) => void,
): Promise<{ inserted: number; updated: number; skipped: number; rejected: number }> {
	const totals = { inserted: 0, updated: 0, skipped: 0, rejected: 0 };
	const url = ingestUrl.replace(/\/+$/, "") + "/ingest";
	const total = entries.length;
	let sent = 0;
	let written = 0;

	for (let i = 0; i < entries.length; i += BATCH_SIZE) {
		const batch = entries.slice(i, i + BATCH_SIZE);
		const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
		sent += batch.length;

		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Api-Key": key,
			},
			body: JSON.stringify({ entries: batch }),
		});

		if (!res.ok) {
			const bodySnippet = (await res.text().catch(() => "")).slice(0, 200);
			throw new Error(
				`batch ${batchNumber} failed: HTTP ${res.status} ${JSON.stringify(bodySnippet)} — progress so far: ${JSON.stringify(totals)}`,
			);
		}

		const result = (await res.json()) as IngestResponse;
		totals.inserted += result.inserted ?? 0;
		totals.updated += result.updated ?? 0;
		totals.skipped += result.skipped ?? 0;
		totals.rejected += result.rejected?.length ?? 0;

		written += batch.length;
		onProgress(sent, total, written);
	}

	return totals;
}
