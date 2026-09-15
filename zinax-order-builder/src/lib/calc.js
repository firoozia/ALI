export function lineBase(row) {
  const qty = Number(row.qty) || 0;
  const price = Number(row.unitPrice) || 0;
  return qty * price;
}

export function lineDiscountAmount(row) {
  const base = lineBase(row);
  const discount = Number(row.discount) || 0;
  return (base * discount) / 100;
}

export function lineTaxable(row) {
  return lineBase(row) - lineDiscountAmount(row);
}

export function lineVatAmount(row) {
  const taxable = lineTaxable(row);
  const vat = Number(row.vat) || 0;
  return (taxable * vat) / 100;
}

export function lineTotal(row) {
  return lineTaxable(row) + lineVatAmount(row);
}

export function rowAreaSqm(row) {
  const w = Number(row.width) || 0;
  const h = Number(row.height) || 0;
  const qty = Number(row.qty) || 0;
  return (w / 1000) * (h / 1000) * qty;
}

export function computeOrderTotals(rows) {
  const totalDoors = rows.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
  const totalArea = rows.reduce((sum, r) => sum + rowAreaSqm(r), 0);
  const subtotal = rows.reduce((sum, r) => sum + lineBase(r), 0);
  const totalDiscount = rows.reduce((sum, r) => sum + lineDiscountAmount(r), 0);
  const taxable = subtotal - totalDiscount;
  const vatAmount = rows.reduce((sum, r) => sum + lineVatAmount(r), 0);
  const grandTotal = taxable + vatAmount;
  // Rough estimate: PVC membrane consumption based on door face area + 10% wastage.
  const pvcConsumption = totalArea * 1.1;

  return {
    totalRows: rows.length,
    totalDoors,
    totalArea,
    subtotal,
    totalDiscount,
    taxable,
    vatAmount,
    grandTotal,
    pvcConsumption,
  };
}

export function formatCurrency(value, currency = "AED") {
  const n = Number(value) || 0;
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value, digits = 2) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
