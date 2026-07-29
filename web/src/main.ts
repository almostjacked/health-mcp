// Placeholder wiring for the onboarding page. Real panel content (provision,
// import, shortcut flows) lands in a later task — this just confirms the
// bundle loads and the three panel mounts are present.
const panelIds = ["provision", "import", "shortcut"] as const;

for (const id of panelIds) {
  const section = document.getElementById(id);
  const body = section?.querySelector<HTMLDivElement>(".panel-body");
  if (body) {
    body.textContent = "Coming soon.";
  }
}
