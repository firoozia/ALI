// Desktop-shell detection. Only files under src/desktop/ may import Tauri
// APIs directly — src/core/ and page components must go through
// src/lib/ instead, which picks this or the web/ adapter at runtime.
import { isTauri } from "@tauri-apps/api/core";

export function isDesktopRuntime(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}
