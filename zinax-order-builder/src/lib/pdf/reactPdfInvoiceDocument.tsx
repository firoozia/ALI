// Text-based Proforma Invoice PDF, built entirely from core/pdfSchema's
// InvoicePdfModel. All totals (subtotal, discount, VAT, grand total,
// balance due) are read from model.totals / model.balanceDue — computed
// exclusively by core/calculations.ts, never recalculated here.
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { InvoicePdfModel } from "../../core/pdfSchema";
import { discountAmount, vatAmount, lineTotal, formatCurrency, formatNumber } from "../../core/calculations";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: "#c8952a", paddingBottom: 10, marginBottom: 10 },
  logo: { width: 36, height: 36, marginRight: 8, borderRadius: 4 },
  brandRow: { flexDirection: "row", alignItems: "center" },
  brandName: { fontSize: 13, fontWeight: 700, color: "#0a1a33" },
  brandSubtitle: { fontSize: 7, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 },
  titleBlock: { alignItems: "flex-end" },
  title: { fontSize: 16, fontWeight: 700 },
  metaLine: { fontSize: 9, color: "#475569", marginTop: 2 },
  infoGrid: { flexDirection: "row", marginBottom: 10 },
  infoCell: { flex: 1, paddingRight: 8 },
  infoLabel: { fontSize: 7, color: "#94a3b8", textTransform: "uppercase", marginBottom: 2 },
  infoValue: { fontSize: 9.5, fontWeight: 600 },
  billTo: { backgroundColor: "#f8fafc", borderRadius: 4, padding: 8, marginBottom: 10 },
  billToLabel: { fontSize: 7, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#0a1a33", paddingVertical: 5, paddingHorizontal: 2 },
  tableHeaderCell: { fontSize: 7, color: "#ffffff", textTransform: "uppercase", fontWeight: 700, paddingHorizontal: 2 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 4, paddingHorizontal: 2 },
  tableRowAlt: { backgroundColor: "#f8fafc" },
  tableCell: { fontSize: 8, paddingHorizontal: 2 },
  tableCellRight: { fontSize: 8, paddingHorizontal: 2, textAlign: "right" },
  totalsBlock: { alignSelf: "flex-end", width: 220, marginTop: 10, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4, padding: 8 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalsLabel: { fontSize: 8.5, color: "#64748b" },
  totalsValue: { fontSize: 8.5, fontWeight: 600 },
  totalsStrongLabel: { fontSize: 9.5, fontWeight: 700, color: "#0f172a" },
  totalsStrongValue: { fontSize: 9.5, fontWeight: 700 },
  totalsDivider: { borderTopWidth: 1, borderTopColor: "#e2e8f0", marginVertical: 4 },
  paymentGrid: { flexDirection: "row", marginTop: 14, borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 10 },
  paymentCell: { flex: 1, paddingRight: 8 },
  signatureRow: { flexDirection: "row", marginTop: 26, gap: 24 },
  signatureBox: { flex: 1 },
  signatureLine: { borderTopWidth: 1, borderTopColor: "#cbd5e1", marginBottom: 4, marginTop: 24 },
  signatureLabel: { fontSize: 8, color: "#64748b" },
});

const INVOICE_COLUMNS = [
  { key: "no", label: "No.", flex: 0.4 },
  { key: "description", label: "Description", flex: 1.6 },
  { key: "designCode", label: "Design Code", flex: 1 },
  { key: "size", label: "Size", flex: 1 },
  { key: "qty", label: "Qty", flex: 0.5 },
  { key: "unitPrice", label: "Unit Price", flex: 0.9 },
  { key: "discount", label: "Discount", flex: 0.9 },
  { key: "vat", label: "VAT", flex: 0.9 },
  { key: "lineTotal", label: "Line Total", flex: 1 },
];

export default function ReactPdfInvoiceDocument({ model }: { model: InvoicePdfModel }) {
  const currency = model.currency;
  const t = model.template;

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.brandRow}>
            {model.vendorLogoUrl ? <Image src={model.vendorLogoUrl} style={styles.logo} /> : null}
            <View>
              <Text style={styles.brandName}>{model.vendorBrandName}</Text>
              <Text style={styles.brandSubtitle}>Cabinet &amp; Membrane Door Production</Text>
              {t.showTaxNumber && model.vendorTaxNumber ? (
                <Text style={styles.brandSubtitle}>TRN: {model.vendorTaxNumber}</Text>
              ) : null}
            </View>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{t.invoicePdfTitle}</Text>
            <Text style={styles.metaLine}>Invoice No. {model.invoiceNo}</Text>
            <Text style={styles.metaLine}>Order No. {model.orderNo}</Text>
          </View>
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Invoice Date</Text>
            <Text style={styles.infoValue}>{model.invoiceDate || "-"}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Due Date</Text>
            <Text style={styles.infoValue}>{model.dueDate || "-"}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Payment Terms</Text>
            <Text style={styles.infoValue}>{model.paymentTerms || "-"}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Currency</Text>
            <Text style={styles.infoValue}>{currency}</Text>
          </View>
        </View>

        <View style={styles.billTo}>
          <Text style={styles.billToLabel}>Bill To</Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Customer Name</Text>
              <Text style={styles.infoValue}>{model.customerName || "-"}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Company</Text>
              <Text style={styles.infoValue}>{model.companyName || "-"}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Phone</Text>
              <Text style={styles.infoValue}>{model.phone || "-"}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Project</Text>
              <Text style={styles.infoValue}>{model.project || "-"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.tableHeaderRow} fixed>
          {INVOICE_COLUMNS.map((col) => {
            // Amount columns drop the currency code from every row cell to
            // cut repetition — it appears here once instead, in the header.
            const isAmountCol = ["unitPrice", "discount", "vat", "lineTotal"].includes(col.key);
            return (
              <Text
                key={col.key}
                style={[styles.tableHeaderCell, { flex: col.flex }, col.key !== "description" && col.key !== "designCode" ? { textAlign: "right" } : {}]}
              >
                {col.label}
                {isAmountCol ? ` (${currency})` : ""}
              </Text>
            );
          })}
        </View>

        {model.rows.map((row, idx) => (
          <View key={row.id} style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
            <Text style={[styles.tableCell, { flex: INVOICE_COLUMNS[0].flex }]}>{idx + 1}</Text>
            <Text style={[styles.tableCell, { flex: INVOICE_COLUMNS[1].flex }]}>{row.designName || "-"}</Text>
            <Text style={[styles.tableCell, { flex: INVOICE_COLUMNS[2].flex }]}>{row.designCode || "-"}</Text>
            <Text style={[styles.tableCell, { flex: INVOICE_COLUMNS[3].flex }]}>
              {row.width || "-"} × {row.height || "-"}
            </Text>
            <Text style={[styles.tableCellRight, { flex: INVOICE_COLUMNS[4].flex }]}>{row.qty || "-"}</Text>
            <Text style={[styles.tableCellRight, { flex: INVOICE_COLUMNS[5].flex }]}>{formatNumber(row.unitPrice)}</Text>
            <Text style={[styles.tableCellRight, { flex: INVOICE_COLUMNS[6].flex }]}>{formatNumber(discountAmount(row))}</Text>
            <Text style={[styles.tableCellRight, { flex: INVOICE_COLUMNS[7].flex }]}>{formatNumber(vatAmount(row))}</Text>
            <Text style={[styles.tableCellRight, { flex: INVOICE_COLUMNS[8].flex }]}>{formatNumber(lineTotal(row))}</Text>
          </View>
        ))}

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{formatCurrency(model.totals.subtotal, currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Discount</Text>
            <Text style={styles.totalsValue}>- {formatCurrency(model.totals.totalDiscount, currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>VAT</Text>
            <Text style={styles.totalsValue}>{formatCurrency(model.totals.vatAmount, currency)}</Text>
          </View>
          <View style={styles.totalsDivider} />
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Grand Total</Text>
            <Text style={styles.totalsValue}>{formatCurrency(model.totals.grandTotal, currency)}</Text>
          </View>
          {model.totals.orderDiscountAmount > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Overall Discount</Text>
              <Text style={styles.totalsValue}>- {formatCurrency(model.totals.orderDiscountAmount, currency)}</Text>
            </View>
          ) : null}
          <View style={styles.totalsRow}>
            <Text style={styles.totalsStrongLabel}>Net Total</Text>
            <Text style={styles.totalsStrongValue}>{formatCurrency(model.totals.finalTotal, currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Paid Amount</Text>
            <Text style={styles.totalsValue}>{formatCurrency(model.paidAmount, currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsStrongLabel}>Balance Due</Text>
            <Text style={styles.totalsStrongValue}>{formatCurrency(model.balanceDue, currency)}</Text>
          </View>
        </View>

        <View style={styles.paymentGrid}>
          {t.showBankDetails ? (
            <View style={styles.paymentCell}>
              <Text style={styles.infoLabel}>Bank Details</Text>
              <Text style={styles.infoValue}>{model.bankDetails || "-"}</Text>
            </View>
          ) : null}
          <View style={styles.paymentCell}>
            <Text style={styles.infoLabel}>Notes</Text>
            <Text style={styles.infoValue}>{model.notes || t.footerNotes || "-"}</Text>
          </View>
        </View>

        {t.showSignatures ? (
          <View style={styles.signatureRow}>
            <View style={styles.signatureBox}>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureLabel}>Authorized Signature</Text>
            </View>
            <View style={styles.signatureBox}>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureLabel}>Customer Signature</Text>
            </View>
            <View style={styles.signatureBox}>
              {model.vendorStampUrl ? <Image src={model.vendorStampUrl} style={{ width: 48, height: 48, marginBottom: 4 }} /> : null}
              <View style={styles.signatureLine} />
              <Text style={styles.signatureLabel}>Company Stamp</Text>
            </View>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
