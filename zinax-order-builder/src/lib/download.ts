// Browser-only file download helpers. These are UI-layer concerns (DOM,
// Blob, URL.createObjectURL) — the Windows edition will write files to
// disk directly instead, so none of this belongs in src/core/.

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  downloadBlob(fileName, blob);
}

/** Downloads CSV text as a file. Prefixes a UTF-8 BOM so Excel opens it correctly. */
export function downloadCsvFile(fileName: string, csvContent: string): void {
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  triggerBlobDownload(blob, fileName);
}

export function downloadJsonFile(fileName: string, jsonContent: string): void {
  const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" });
  triggerBlobDownload(blob, fileName);
}

/** Reads a File (e.g. from an <input type="file"> change event) as text. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsText(file);
  });
}
