// Browser file-save adapter: triggers a Blob download via a hidden <a>.
// This is what src/lib/download.ts falls back to when not running inside
// the Tauri desktop shell.

export function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
