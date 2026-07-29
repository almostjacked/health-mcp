import { Unzip, UnzipInflate } from "fflate";
import type { UnzipFile } from "fflate";

const EXPORT_XML_RE = /(^|\/)export\.xml$/;

/** Streams the `export.xml` entry out of an Apple Health `export.zip` Blob
 * without loading the whole archive (or the whole XML) into memory at once.
 * Picks the entry named `export.xml` or nested `.../export.xml` (Apple nests
 * it under `apple_health_export/`); every other entry in the zip is skipped. */
export function streamExportXml(
	file: Blob,
	onChunk: (text: string) => void,
	onDone: () => void,
	onError: (e: Error) => void,
): void {
	let found = false;
	let settled = false;

	const fail = (e: Error) => {
		if (settled) return;
		settled = true;
		onError(e);
	};
	const succeed = () => {
		if (settled) return;
		settled = true;
		onDone();
	};

	const decoder = new TextDecoder("utf-8");
	const unzip = new Unzip((entry: UnzipFile) => {
		if (!EXPORT_XML_RE.test(entry.name)) return; // leave ondata unset: fflate skips unread entries
		found = true;
		entry.ondata = (err, chunk, final) => {
			if (err) {
				fail(err instanceof Error ? err : new Error(String(err)));
				return;
			}
			if (chunk.length) onChunk(decoder.decode(chunk, { stream: !final }));
			if (final) succeed();
		};
		entry.start();
	});
	unzip.register(UnzipInflate);

	// Pump the Blob's own stream through fflate chunk by chunk (never buffering
	// the whole archive in memory) — a multi-GB export.zip stays off-heap.
	// Reads are buffered one chunk ahead so the final `push(..., true)` call
	// can carry real trailing bytes: a reader only learns a chunk was the last
	// one chunk *after* it, when the following read comes back `done`.
	const reader = file.stream().getReader();
	let pending: Uint8Array | null = null;

	const pump = (): void => {
		reader
			.read()
			.then(({ done, value }) => {
				if (settled) return;
				try {
					if (done) {
						unzip.push(pending ?? new Uint8Array(0), true);
					} else {
						if (pending) unzip.push(pending, false);
						pending = value;
						pump();
						return;
					}
				} catch (e) {
					fail(e instanceof Error ? e : new Error(String(e)));
					return;
				}
				if (!found) {
					fail(new Error("no export.xml found in this zip — is this an Apple Health export?"));
				}
			})
			.catch((e) => fail(e instanceof Error ? e : new Error(String(e))));
	};
	pump();
}
