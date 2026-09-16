// Customer directory — a dedicated store (separate from AppSettings)
// since it churns far more often than company/catalog settings and a
// company may have hundreds of records. The load/save adapter at the
// bottom is the Web edition's persistence (localStorage); the Windows
// edition will implement the same four function signatures against a
// local file or database instead.

export interface Customer {
  customerId: string;
  customerName: string;
  companyName: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  taxNumber: string;
  notes: string;
}

let customerIdCounter = 1;
export function nextCustomerId(): string {
  return `CUST-${String(customerIdCounter++).padStart(4, "0")}`;
}

export function makeDefaultCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    customerId: nextCustomerId(),
    customerName: "",
    companyName: "",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    taxNumber: "",
    notes: "",
    ...overrides,
  };
}

/** Simple case-insensitive substring match across the fields a salesperson would search by. */
export function searchCustomers(customers: Customer[], query: string): Customer[] {
  const q = query.trim().toLowerCase();
  if (!q) return customers;
  return customers.filter((c) =>
    [c.customerName, c.companyName, c.phone, c.whatsapp, c.email, c.taxNumber].some((field) =>
      field.toLowerCase().includes(q)
    )
  );
}

export const CUSTOMERS_SCHEMA_VERSION = "1.0";
export const CUSTOMERS_APP_ID = "ZINAX_CUSTOMERS";

export interface CustomersFile {
  schema_version: string;
  app: string;
  customers: Customer[];
}

export function buildCustomersFile(customers: Customer[]): CustomersFile {
  return { schema_version: CUSTOMERS_SCHEMA_VERSION, app: CUSTOMERS_APP_ID, customers };
}

export function serializeCustomersFile(file: CustomersFile): string {
  return JSON.stringify(file, null, 2);
}

export function customersFileName(): string {
  return "zinax_customers.json";
}

export type ParseCustomersFileResult = { ok: true; customers: Customer[] } | { ok: false; error: string };

export function parseCustomersFile(jsonText: string): ParseCustomersFileResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "File does not contain a customers object." };
  }
  const candidate = parsed as Partial<CustomersFile>;
  if (candidate.app !== CUSTOMERS_APP_ID) {
    return { ok: false, error: `File is not a ${CUSTOMERS_APP_ID} file.` };
  }
  if (candidate.schema_version !== CUSTOMERS_SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported customers file version "${String(candidate.schema_version)}".` };
  }
  if (!Array.isArray(candidate.customers)) {
    return { ok: false, error: "File is missing a customers array." };
  }
  return { ok: true, customers: candidate.customers };
}

/** Upserts by customerId, keeping existing customers not present in `incoming`. */
export function mergeCustomers(current: Customer[], incoming: Customer[]): Customer[] {
  const map = new Map(current.map((c) => [c.customerId, c]));
  for (const c of incoming) map.set(c.customerId, c);
  return Array.from(map.values());
}

export function replaceCustomers(_current: Customer[], incoming: Customer[]): Customer[] {
  return incoming;
}

// --- Web persistence adapter (localStorage) -----------------------------

const LOCAL_STORAGE_KEY = "zinax_customers_v1";

export function loadCustomersFromStorage(): Customer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const result = parseCustomersFile(raw);
    return result.ok ? result.customers : [];
  } catch {
    return [];
  }
}

export function saveCustomersToStorage(customers: Customer[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, serializeCustomersFile(buildCustomersFile(customers)));
  } catch {
    // Storage unavailable (private mode, quota exceeded) — customers just won't persist.
  }
}
