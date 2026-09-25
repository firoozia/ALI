// Desktop file-save adapter: shows a native Tauri save dialog, then writes
// the chosen path via the fs plugin. This is what src/lib/download.ts uses
// instead of a browser Blob download when running inside the Tauri shell —
// a bare WebView has no download manager, so an anchor-click download
// writes silently into the app's working directory with no user feedback.
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";

function filtersFor(fileName: string): { name: string; extensions: string[] }[] | undefined {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined;
}

/** Returns false if the user cancelled the save dialog, true once written. */
export async function saveBlob(fileName: string, blob: Blob): Promise<boolean> {
  const path = await save({ defaultPath: fileName, filters: filtersFor(fileName) });
  if (!path) return false;

  const isText = blob.type.startsWith("text/") || blob.type.includes("json");
  if (isText) {
    await writeTextFile(path, await blob.text());
  } else {
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  }
  return true;
}
