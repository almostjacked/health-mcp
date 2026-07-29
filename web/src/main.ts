// Wires the three onboarding panels into their mount points. All panel logic
// lives in ./panels/{provision,import,shortcut}.ts (DOM assembly + event
// wiring) on top of the tested modules in ./state.ts, ./provision/, and
// ./import/ — this file just finds each section's `.panel-body` and hands it
// to the matching mount function.
import { mountProvisionPanel } from "./panels/provision.js";
import { mountImportPanel } from "./panels/import.js";
import { mountShortcutPanel } from "./panels/shortcut.js";

function mount(id: string, fn: (el: HTMLElement) => void): void {
	const section = document.getElementById(id);
	const body = section?.querySelector<HTMLDivElement>(".panel-body");
	if (body) fn(body);
}

mount("provision", mountProvisionPanel);
mount("import", mountImportPanel);
mount("shortcut", mountShortcutPanel);
