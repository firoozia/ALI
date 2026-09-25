// Web-edition counterpart to src/desktop/desktopEnvironment.ts. The web
// build is never the desktop shell, so this is always false — kept as an
// explicit module (rather than a literal at the call site) so the two
// editions stay symmetrical and swappable.
export function isDesktopRuntime(): boolean {
  return false;
}
