# QuickBooks Online: plan only (nothing is built, nothing will be built until the owner says so)

Order of work, set by the owner: (1) customer availability flow with the manager loop, (2) supervising orders, invoices
and delivery with the invoice checks, (3) price list intake, (4) the other supervising ideas, (5) **QuickBooks last**.

## Which QuickBooks
The owner uses **QuickBooks Online**. QuickBooks Desktop is a different thing (Windows only, no web API: it talks
qbXML through the Web Connector installed beside the program) and is not planned. To confirm with the owner: the
country edition of the company (the tax set-up, here VAT, differs by edition) and the company id (realm id).

## How it would connect (Intuit developer platform, OAuth 2.0 + REST)
- A developer app registered at developer.intuit.com, **sandbox company first**; production keys only after Intuit's app
  review and the owner's go-ahead.
- Authorization code flow, one-time consent by the owner (or the company admin) in the browser. Scope: the accounting
  scope only (`com.intuit.quickbooks.accounting`), nothing for payments or payroll.
- Access tokens last about an hour; refresh tokens are valid for about 100 days **and a new one is issued at every
  refresh**, so the newest must be stored at once or the link is lost. Tokens and keys live only on the VM
  (file with mode 600 beside the WhatsApp login, or the VM's secret store), never in the repository, never in logs.
- Calls: `POST /v3/company/{realmId}/invoice` (customer reference, lines with item reference, quantity, unit price, tax
  code), reading customers and items with the query endpoint. Every create call carries a `requestid`, which makes a
  retry safe (the same id returns the same result instead of a second invoice).

## Phase 1: prepare, never create (weeks of clean checks first)
QuickBooks Online has **no draft state for an invoice**: an invoice that is created exists. So the first phase writes
nothing to QuickBooks:
1. From the order lines (photo, text or purchase-order PDF), the owner's price list and the customer's special prices,
   the assistant prepares the invoice **as a preview** in the Invoices group: customer, every line (code, quantity,
   unit, price), VAT, total, and the points where it differs from the customer's order.
2. A person approves the preview ("yes #<id>") or corrects it; the human still enters it in QuickBooks, as today. The
   assistant's own invoice check (already built) then compares what the office really issued with the preview.
3. After weeks with no differences, phase 2 is considered: creation after a person's explicit approval of each
   preview (one button-like reply), still never automatic. Fully automatic creation is a separate decision later.

## What the owner must provide
- The app registration (client id and secret), the company id, and the consent click.
- A **mapping of product codes to QuickBooks items** (code, item id or name, tax code) and of **customers** (the names
  used in the groups to QuickBooks customers). The assistant never guesses a mapping: an unmapped code or customer stops
  the preview with "map this first".
- The tax set-up: the VAT rate and tax code to use, whether prices are before or after VAT, the rounding rule.

## Safety
- **One invoice per order id**: the order id is the idempotency key (`requestid`) and is also stored with the QuickBooks
  document number; a second create for the same order is refused.
- **Audit log**: every preview, approval and call (time, who approved, order id, QuickBooks id, totals; no message text)
  in an append-only file on the VM, readable by the owner with a command.
- **Kill switch**: a setting in the VM metadata and an owner-only command that stop all QuickBooks calls at once;
  default off; paused state survives restarts.
- **Approval gate**: phases above; nothing is created without a named person's approval.
- **Reconciliation**: a daily comparison of the invoices created by the assistant with QuickBooks, reported to the
  Information group.

## Risks and how they are met
| Risk | Meet it with |
|---|---|
| Wrong price | prices only from the owner's confirmed list and exceptions; below-list stops the preview |
| Duplicate invoice | order id as the single key + `requestid` + refusal of a second create |
| Wrong customer mapping | explicit mapping table, never fuzzy; the preview shows the QuickBooks customer name |
| Wrong VAT or rounding | the same plain arithmetic already used by the invoice audit, compared with QuickBooks' own totals |
| Lost link (refresh token not saved) | save the new token before using it; a daily harmless call to prove the link; an alert when it fails |
| A bug creating many invoices | rate limit (a few per hour), a daily cap, the kill switch |
| Customer data in the repository | none: mapping and tokens stay on the VM |

## Cost and time
Registration and sandbox work first; the preview (phase 1) reuses the audit and price list already built, so it is the
small part. Creation (phase 2) is mostly mapping, testing in the sandbox and the review by Intuit.
