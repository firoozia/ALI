import { describe, it, expect } from "vitest";
import { makeDefaultCustomer, searchCustomers, mergeCustomers, replaceCustomers, parseCustomersFile, serializeCustomersFile, buildCustomersFile } from "../customerSchema";

describe("customerSchema", () => {
  it("search matches by name, company, phone, whatsapp, email, or tax number (case-insensitive)", () => {
    const customers = [
      makeDefaultCustomer({ customerId: "C1", customerName: "Khalid Al Farsi", companyName: "Al Farsi Interiors", phone: "+97150", email: "khalid@example.com" }),
      makeDefaultCustomer({ customerId: "C2", customerName: "Sara Khalid", companyName: "Sara Designs", phone: "+97199", email: "sara@example.com" }),
    ];

    expect(searchCustomers(customers, "khalid").map((c) => c.customerId).sort()).toEqual(["C1", "C2"]);
    expect(searchCustomers(customers, "FARSI").map((c) => c.customerId)).toEqual(["C1"]);
    expect(searchCustomers(customers, "sara@example.com").map((c) => c.customerId)).toEqual(["C2"]);
    expect(searchCustomers(customers, "")).toHaveLength(2);
    expect(searchCustomers(customers, "nonexistent")).toHaveLength(0);
  });

  it("merge upserts by customerId and keeps everyone else", () => {
    const current = [
      makeDefaultCustomer({ customerId: "C1", customerName: "Old Name" }),
      makeDefaultCustomer({ customerId: "C2", customerName: "Untouched" }),
    ];
    const incoming = [makeDefaultCustomer({ customerId: "C1", customerName: "New Name" })];

    const merged = mergeCustomers(current, incoming);
    expect(merged.find((c) => c.customerId === "C1")?.customerName).toBe("New Name");
    expect(merged.find((c) => c.customerId === "C2")?.customerName).toBe("Untouched");
  });

  it("replace discards everyone not in the incoming list", () => {
    const current = [makeDefaultCustomer({ customerId: "C1" })];
    const incoming = [makeDefaultCustomer({ customerId: "C2" })];
    expect(replaceCustomers(current, incoming)).toEqual(incoming);
  });

  it("round-trips through serialize + parse", () => {
    const customers = [makeDefaultCustomer({ customerId: "C1", customerName: "Test" })];
    const result = parseCustomersFile(serializeCustomersFile(buildCustomersFile(customers)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.customers[0].customerName).toBe("Test");
  });

  it("rejects a file from a different app", () => {
    const result = parseCustomersFile(JSON.stringify({ schema_version: "1.0", app: "WRONG", customers: [] }));
    expect(result.ok).toBe(false);
  });
});
