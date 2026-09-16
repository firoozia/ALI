// Shared UI-only types (navigation, etc.) — not business logic, so this
// stays out of src/core/.
export type ScreenKey =
  | "dashboard"
  | "new-order"
  | "order-preview"
  | "invoice-preview"
  | "customers"
  | "products"
  | "templates"
  | "export-schema"
  | "settings";
