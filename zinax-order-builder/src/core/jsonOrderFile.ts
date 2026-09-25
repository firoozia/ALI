// Order project file — save/open an in-progress order as a portable
// ".zinax_order.json" file. Both editions must agree on this shape so a
// file saved on Windows can be opened on the Web edition and vice versa.
import type { OrderHeader, OrderRow } from "./orderSchema";
import type { Invoice } from "./invoiceSchema";

export const ORDER_FILE_SCHEMA_VERSION = "1.0";
export const ORDER_FILE_APP_ID = "ZINAX_ORDER_BUILDER";

export interface OrderFile {
  schema_version: string;
  app: string;
  header: OrderHeader;
  rows: OrderRow[];
  invoiceMode: boolean;
  invoice: Invoice;
}

export function buildOrderFile(
  header: OrderHeader,
  rows: OrderRow[],
  invoiceMode: boolean,
  invoice: Invoice
): OrderFile {
  return {
    schema_version: ORDER_FILE_SCHEMA_VERSION,
    app: ORDER_FILE_APP_ID,
    header,
    rows,
    invoiceMode,
    invoice,
  };
}

export function serializeOrderFile(file: OrderFile): string {
  return JSON.stringify(file, null, 2);
}

export function orderFileName(orderNo: string): string {
  return `${orderNo}.zinax_order.json`;
}

export type ParseOrderFileResult =
  | { ok: true; file: OrderFile }
  | { ok: false; error: string };

/**
 * Validates and parses an uploaded ".zinax_order.json" file's text content.
 * Rejects files from a different app or an unsupported schema version
 * rather than silently loading malformed data into the builder.
 */
export function parseOrderFile(jsonText: string): ParseOrderFileResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "File does not contain an order object." };
  }

  const candidate = parsed as Partial<OrderFile>;

  if (candidate.app !== ORDER_FILE_APP_ID) {
    return { ok: false, error: `File is not a ${ORDER_FILE_APP_ID} order file.` };
  }
  if (candidate.schema_version !== ORDER_FILE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported order file version "${String(candidate.schema_version)}" (expected ${ORDER_FILE_SCHEMA_VERSION}).`,
    };
  }
  if (!candidate.header || !Array.isArray(candidate.rows) || !candidate.invoice) {
    return { ok: false, error: "File is missing header, rows, or invoice data." };
  }

  return {
    ok: true,
    file: {
      schema_version: candidate.schema_version,
      app: candidate.app,
      header: candidate.header,
      rows: candidate.rows,
      invoiceMode: Boolean(candidate.invoiceMode),
      invoice: candidate.invoice,
    },
  };
}
