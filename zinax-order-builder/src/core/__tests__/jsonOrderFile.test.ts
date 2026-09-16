import { describe, it, expect } from "vitest";
import { buildOrderFile, serializeOrderFile, parseOrderFile, ORDER_FILE_SCHEMA_VERSION, ORDER_FILE_APP_ID } from "../jsonOrderFile";
import { makeInitialHeader, makeInitialInvoice, makeInitialRows } from "../mockData";

describe("jsonOrderFile", () => {
  it("save shape includes schema_version, app, header, rows, invoiceMode, invoice", () => {
    const file = buildOrderFile(makeInitialHeader(), makeInitialRows(), true, makeInitialInvoice());
    expect(file.schema_version).toBe(ORDER_FILE_SCHEMA_VERSION);
    expect(file.app).toBe(ORDER_FILE_APP_ID);
    expect(file.header).toBeTruthy();
    expect(Array.isArray(file.rows)).toBe(true);
    expect(file.invoiceMode).toBe(true);
    expect(file.invoice).toBeTruthy();
  });

  it("round-trips through serialize + parse", () => {
    const file = buildOrderFile(makeInitialHeader(), makeInitialRows(), false, makeInitialInvoice());
    const text = serializeOrderFile(file);
    const result = parseOrderFile(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.header.orderNo).toBe(file.header.orderNo);
      expect(result.file.rows).toHaveLength(file.rows.length);
    }
  });

  it("rejects a file from a different app", () => {
    const result = parseOrderFile(JSON.stringify({ schema_version: ORDER_FILE_SCHEMA_VERSION, app: "SOME_OTHER_APP", header: {}, rows: [], invoice: {} }));
    expect(result.ok).toBe(false);
  });

  it("rejects an unsupported schema version", () => {
    const result = parseOrderFile(
      JSON.stringify({ schema_version: "99.0", app: ORDER_FILE_APP_ID, header: {}, rows: [], invoice: {} })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects malformed JSON", () => {
    const result = parseOrderFile("{not valid json");
    expect(result.ok).toBe(false);
  });

  it("rejects a file missing header/rows/invoice", () => {
    const result = parseOrderFile(JSON.stringify({ schema_version: ORDER_FILE_SCHEMA_VERSION, app: ORDER_FILE_APP_ID }));
    expect(result.ok).toBe(false);
  });
});
