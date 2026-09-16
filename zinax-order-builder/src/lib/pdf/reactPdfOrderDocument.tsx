// Text-based Order Sheet PDF, built entirely from core/pdfSchema's
// OrderPdfModel. No totals or business math happen here — everything
// (totalDoors, totalArea, line totals) is read straight off the model or
// computed by core/calculations.ts.
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { OrderPdfModel } from "../../core/pdfSchema";
import { lineTotal, formatCurrency } from "../../core/calculations";

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: "#0a1a33", paddingBottom: 10, marginBottom: 10 },
  logo: { width: 36, height: 36, marginRight: 8, borderRadius: 4 },
  brandRow: { flexDirection: "row", alignItems: "center" },
  brandName: { fontSize: 13, fontWeight: 700, color: "#0a1a33" },
  brandSubtitle: { fontSize: 7, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 },
  titleBlock: { alignItems: "flex-end" },
  title: { fontSize: 16, fontWeight: 700 },
  metaLine: { fontSize: 9, color: "#475569", marginTop: 2 },
  infoGrid: { flexDirection: "row", marginBottom: 12 },
  infoCell: { flex: 1, paddingRight: 8 },
  infoLabel: { fontSize: 7, color: "#94a3b8", textTransform: "uppercase", marginBottom: 2 },
  infoValue: { fontSize: 9.5, fontWeight: 600 },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#0a1a33", paddingVertical: 5, paddingHorizontal: 2 },
  tableHeaderCell: { fontSize: 7, color: "#ffffff", textTransform: "uppercase", fontWeight: 700, paddingHorizontal: 2 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 4, paddingHorizontal: 2 },
  tableRowAlt: { backgroundColor: "#f8fafc" },
  tableCell: { fontSize: 8, paddingHorizontal: 2 },
  notesBlock: { marginTop: 10, padding: 8, backgroundColor: "#f1f5f9", borderRadius: 4 },
  notesLabel: { fontSize: 7, color: "#94a3b8", textTransform: "uppercase", marginBottom: 2 },
  notesText: { fontSize: 8.5, color: "#334155" },
  footerGrid: { flexDirection: "row", marginTop: 16, borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 10 },
  footerCell: { flex: 1 },
  signatureRow: { flexDirection: "row", marginTop: 28, gap: 24 },
  signatureBox: { flex: 1 },
  signatureLine: { borderTopWidth: 1, borderTopColor: "#cbd5e1", marginBottom: 4, marginTop: 24 },
  signatureLabel: { fontSize: 8, color: "#64748b" },
});

function buildOrderColumns(showPrices: boolean) {
  const base = [
    { key: "no", label: "No.", flex: 0.45 },
    { key: "designCode", label: "Design Code", flex: 1.1 },
    { key: "designName", label: "Design Name", flex: 1.7 },
    { key: "width", label: "Width", flex: 0.7 },
    { key: "height", label: "Height", flex: 0.7 },
    { key: "qty", label: "Qty", flex: 0.5 },
    { key: "mdf", label: "MDF", flex: 0.8 },
    { key: "pvcCode", label: "PVC Code", flex: 0.9 },
    { key: "pvcColor", label: "PVC Color", flex: 1.1 },
    { key: "grain", label: "Grain", flex: 0.8 },
    { key: "notes", label: "Notes", flex: 1.8 },
  ];
  if (!showPrices) return base;
  return [
    ...base,
    { key: "unitPrice", label: "Unit Price", flex: 0.9 },
    { key: "lineTotal", label: "Line Total", flex: 1 },
  ];
}

export default function ReactPdfOrderDocument({ model, currency }: { model: OrderPdfModel; currency: string }) {
  const showPrices = model.template.showPricesOnOrderPdf;
  const columns = buildOrderColumns(showPrices);

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.brandRow}>
            {model.vendorLogoUrl ? <Image src={model.vendorLogoUrl} style={styles.logo} /> : null}
            <View>
              <Text style={styles.brandName}>{model.vendorBrandName}</Text>
              <Text style={styles.brandSubtitle}>Cabinet &amp; Membrane Door Production</Text>
            </View>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{model.template.orderPdfTitle}</Text>
            <Text style={styles.metaLine}>Order No. {model.orderNo}</Text>
            <Text style={styles.metaLine}>Date: {model.date}</Text>
          </View>
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Customer</Text>
            <Text style={styles.infoValue}>{model.customer || "-"}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Project</Text>
            <Text style={styles.infoValue}>{model.project || "-"}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Phone / WhatsApp</Text>
            <Text style={styles.infoValue}>{model.phone || "-"}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Salesperson</Text>
            <Text style={styles.infoValue}>{model.salesperson || "-"}</Text>
          </View>
        </View>

        <View style={styles.tableHeaderRow} fixed>
          {columns.map((col) => (
            <Text key={col.key} style={[styles.tableHeaderCell, { flex: col.flex }]}>
              {col.label}
            </Text>
          ))}
        </View>

        {model.rows.map((row, idx) => (
          <View key={row.id} style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
            {columns.map((col) => {
              let value: string;
              switch (col.key) {
                case "no":
                  value = String(idx + 1);
                  break;
                case "designCode":
                  value = row.designCode || "-";
                  break;
                case "designName":
                  value = row.designName || "-";
                  break;
                case "width":
                  value = String(row.width || "-");
                  break;
                case "height":
                  value = String(row.height || "-");
                  break;
                case "qty":
                  value = String(row.qty || "-");
                  break;
                case "mdf":
                  value = row.mdfThickness || "-";
                  break;
                case "pvcCode":
                  value = row.pvcCode || "-";
                  break;
                case "pvcColor":
                  value = row.pvcColor || "-";
                  break;
                case "grain":
                  value = row.grain || "-";
                  break;
                case "notes":
                  value = row.notes || "-";
                  break;
                case "unitPrice":
                  value = formatCurrency(row.unitPrice, currency);
                  break;
                case "lineTotal":
                  value = formatCurrency(lineTotal(row), currency);
                  break;
                default:
                  value = "";
              }
              return (
                <Text key={col.key} style={[styles.tableCell, { flex: col.flex }]}>
                  {value}
                </Text>
              );
            })}
          </View>
        ))}

        {model.notes ? (
          <View style={styles.notesBlock}>
            <Text style={styles.notesLabel}>General Notes</Text>
            <Text style={styles.notesText}>{model.notes}</Text>
          </View>
        ) : null}

        <View style={styles.footerGrid}>
          <View style={styles.footerCell}>
            <Text style={styles.infoLabel}>Total Doors</Text>
            <Text style={styles.infoValue}>{model.totalDoors}</Text>
          </View>
          <View style={styles.footerCell}>
            <Text style={styles.infoLabel}>Total Area</Text>
            <Text style={styles.infoValue}>{model.totalArea.toFixed(2)} m²</Text>
          </View>
          <View style={styles.footerCell}>
            <Text style={styles.infoLabel}>Prepared By</Text>
            <Text style={styles.infoValue}>{model.preparedBy || "-"}</Text>
          </View>
          <View style={styles.footerCell} />
        </View>

        {model.template.showSignatures ? (
          <View style={styles.signatureRow}>
            <View style={styles.signatureBox}>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureLabel}>Prepared By</Text>
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
