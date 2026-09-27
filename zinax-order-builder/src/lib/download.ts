// High-level file-save entry points the UI calls. These are shell-layer
// concerns (DOM/Blob on web, native dialogs on desktop) — none of this
// belongs in src/core/. The actual save mechanism is picked at runtime:
// browser Blob download (src/web/) or a Tauri save dialog + fs write
// (src/desktop/) when running inside the desktop shell.
import { isDesktopRuntime } from "../desktop/desktopEnvironment";
import { saveBlob as saveBlobWeb } from "../web/webFileAdapter";
import { saveBlob as saveBlobDesktop } from "../desktop/desktopFileAdapter";

/** Returns false only when the desktop save dialog was cancelled by the user. */
async function saveBlob(fileName: string, blob: Blob): Promise<boolean> {
  if (isDesktopRuntime()) {
    return saveBlobDesktop(fileName, blob);
  }
  saveBlobWeb(fileName, blob);
  return true;
}

export function downloadBlob(fileName: string, blob: Blob): Promise<boolean> {
  return saveBlob(fileName, blob);
}

/** Saves CSV text as a file. Prefixes a UTF-8 BOM so Excel opens it correctly. */
export function downloadCsvFile(fileName: string, csvContent: string): Promise<boolean> {
  const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
  return saveBlob(fileName, blob);
}

export function downloadJsonFile(fileName: string, jsonContent: string): Promise<boolean> {
  const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" });
  return saveBlob(fileName, blob);
}

/**
 * Reads a File (e.g. from an <input type="file"> change event) as text.
 * Native file inputs already open the OS file picker on both the browser
 * and inside the Tauri WebView — verified — so unlike the save/download
 * direction, the open/import side needs no desktop-specific adapter.
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsText(file);
  });
}
