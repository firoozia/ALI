// A simple text-based PDF the customer can keep for their own records —
// deliberately much smaller than the factory's Order Sheet PDF, since a
// customer-portal submission has no pricing, MDF, or PVC-catalog fields,
// just what was actually collected on the form.
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { CustomerSubmission } from "../../core/publicCatalogSchema";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9.5, fontFamily: "Helvetica", color: "#0f172a" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: "#0a1a33", paddingBottom: 12, marginBottom: 14 },
  brandName: { fontSize: 15, fontWeight: 700, color: "#0a1a33" },
  brandSubtitle: { fontSize: 8, color: "#64748b", marginTop: 2 },
  titleBlock: { alignItems: "flex-end" },
  title: { fontSize: 16, fontWeight: 700 },
  metaLine: { fontSize: 9, color: "#475569", marginTop: 2 },
  infoGrid: { flexDirection: "row", marginBottom: 16, gap: 16 },
  infoCell: { flex: 1 },
  infoLabel: { fontSize: 7.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 3 },
  infoValue: { fontSize: 10.5, fontWeight: 600 },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#0a1a33", paddingVertical: 6, paddingHorizontal: 4 },
  tableHeaderCell: { fontSize: 7.5, color: "#ffffff", textTransform: "uppercase", fontWeight: 700, paddingHorizontal: 3 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 5, paddingHorizontal: 4 },
  tableRowAlt: { backgroundColor: "#f8fafc" },
  tableCell: { fontSize: 8.5, paddingHorizontal: 3 },
  footNote: { marginTop: 20, fontSize: 8, color: "#94a3b8" },
});

const COLUMNS = [
  { key: "no", label: "No.", flex: 0.5 },
  { key: "designCode", label: "Door Code", flex: 1 },
  { key: "size", label: "Size (mm)", flex: 1.1 },
  { key: "qty", label: "Qty", flex: 0.6 },
  { key: "colorCode", label: "Color Code", flex: 1 },
  { key: "direction", label: "Direction", flex: 0.9 },
];

interface CustomerOrderPdfProps {
  companyName: string;
  submission: CustomerSubmission;
  submittedAt: string;
}

export default function ReactPdfCustomerOrderDocument({ companyName, submission, submittedAt }: CustomerOrderPdfProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brandName}>{companyName}</Text>
            <Text style={styles.brandSubtitle}>Customer Order Copy</Text>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Order Summary</Text>
            <Text style={styles.metaLine}>{submittedAt}</Text>
          </View>
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Customer Name</Text>
            <Text style={styles.infoValue}>{submission.customerName || "-"}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>End Customer</Text>
            <Text style={styles.infoValue}>{submission.endCustomerName || "-"}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Installation Unit / Site</Text>
            <Text style={styles.infoValue}>{submission.siteName || "-"}</Text>
          </View>
        </View>

        <View style={styles.tableHeaderRow} fixed>
          {COLUMNS.map((col) => (
            <Text key={col.key} style={[styles.tableHeaderCell, { flex: col.flex }]}>
              {col.label}
            </Text>
          ))}
        </View>

        {submission.items.map((item, idx) => (
          <View key={idx} style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
            <Text style={[styles.tableCell, { flex: COLUMNS[0].flex }]}>{idx + 1}</Text>
            <Text style={[styles.tableCell, { flex: COLUMNS[1].flex }]}>{item.designCode || "-"}</Text>
            <Text style={[styles.tableCell, { flex: COLUMNS[2].flex }]}>{item.width} × {item.height}</Text>
            <Text style={[styles.tableCell, { flex: COLUMNS[3].flex }]}>{item.qty}</Text>
            <Text style={[styles.tableCell, { flex: COLUMNS[4].flex }]}>{item.colorCode || "-"}</Text>
            <Text style={[styles.tableCell, { flex: COLUMNS[5].flex }]}>{item.direction || "-"}</Text>
          </View>
        ))}

        <Text style={styles.footNote}>
          This is a copy of the order you submitted to {companyName}. Please contact them directly for confirmation, pricing, or delivery details.
        </Text>
      </Page>
    </Document>
  );
}
