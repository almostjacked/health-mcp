// Shortcut panel: placeholder only. Task 5 replaces this with the actual
// in-browser Shortcut builder; for now it just points at the manual docs.
import { getConfig } from "../state.js";

const SHORTCUT_DOCS_URL = "https://github.com/almostjacked/health-mcp/blob/main/docs/shortcut.md";

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs: Record<string, string> = {},
	children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === "class") node.className = v;
		else node.setAttribute(k, v);
	}
	for (const child of children) node.append(child);
	return node;
}

export function mountShortcutPanel(container: HTMLElement): void {
	container.textContent = "";

	container.append(
		el("p", {}, [
			"Shortcut builder lands in the next update — for now follow ",
			el("a", { href: SHORTCUT_DOCS_URL, target: "_blank", rel: "noreferrer" }, ["docs/shortcut.md"]),
			".",
		]),
	);

	const config = getConfig();
	if (config.ingestUrl) {
		container.append(
			el("p", { class: "hint" }, [
				"Once you're following the doc: your ingest URL is ",
				el("code", {}, [config.ingestUrl]),
				" — use the ingest key from the Import panel above as the Shortcut's header value.",
			]),
		);
	}
}
