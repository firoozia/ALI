// Portable file version of a customer portal submission — for a factory
// running "Continue offline" (no live connection to read
// customer_submissions from Supabase) whose customer sent the file some
// other way (WhatsApp, email, USB), instead of it landing in the database.
import type { CustomerSubmission } from "./publicCatalogSchema";

export const CUSTOMER_SUBMISSION_FILE_SCHEMA_VERSION = "1.0";
export const CUSTOMER_SUBMISSION_FILE_APP_ID = "ZINAX_CUSTOMER_PORTAL";

export interface CustomerSubmissionFile {
  schema_version: string;
  app: string;
  submittedAt: string;
  submission: CustomerSubmission;
}

export function buildCustomerSubmissionFile(submission: CustomerSubmission): CustomerSubmissionFile {
  return {
    schema_version: CUSTOMER_SUBMISSION_FILE_SCHEMA_VERSION,
    app: CUSTOMER_SUBMISSION_FILE_APP_ID,
    submittedAt: new Date().toISOString(),
    submission,
  };
}

export function serializeCustomerSubmissionFile(file: CustomerSubmissionFile): string {
  return JSON.stringify(file, null, 2);
}

export function customerSubmissionFileName(customerName: string): string {
  const safe = customerName.trim().replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "order";
  return `${safe}.zinax_customer_order.json`;
}

export type ParseCustomerSubmissionFileResult =
  | { ok: true; file: CustomerSubmissionFile }
  | { ok: false; error: string };

export function parseCustomerSubmissionFile(jsonText: string): ParseCustomerSubmissionFileResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "File does not contain a customer order." };
  }

  const candidate = parsed as Partial<CustomerSubmissionFile>;

  if (candidate.app !== CUSTOMER_SUBMISSION_FILE_APP_ID) {
    return { ok: false, error: `File is not a ${CUSTOMER_SUBMISSION_FILE_APP_ID} file.` };
  }
  if (candidate.schema_version !== CUSTOMER_SUBMISSION_FILE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported file version "${String(candidate.schema_version)}" (expected ${CUSTOMER_SUBMISSION_FILE_SCHEMA_VERSION}).`,
    };
  }
  if (!candidate.submission || !Array.isArray(candidate.submission.items)) {
    return { ok: false, error: "File is missing the customer's order items." };
  }

  return {
    ok: true,
    file: {
      schema_version: candidate.schema_version,
      app: candidate.app,
      submittedAt: candidate.submittedAt ?? new Date().toISOString(),
      submission: candidate.submission,
    },
  };
}
