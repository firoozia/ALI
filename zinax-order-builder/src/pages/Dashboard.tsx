import {
  ClipboardList,
  FileClock,
  FileSpreadsheet,
  Hammer,
  Receipt,
  FolderOpen,
  Copy,
  FileDown,
  Plus,
} from "lucide-react";
import StatCard from "../components/ui/StatCard";
import Badge from "../components/ui/Badge";
import { computeOrderStats, sortByRecent, type OrderRecord } from "../core/orderHistorySchema";
import { buildProductionCsvString, productionCsvFileName } from "../core/csvSchema";
import { downloadCsvFile } from "../lib/download";
import type { ScreenKey } from "../types";

interface DashboardProps {
  onNavigate: (key: ScreenKey) => void;
  orders: OrderRecord[];
  onOpenOrder: (order: OrderRecord) => void;
  onDuplicateOrder: (order: OrderRecord) => void;
}

export default function Dashboard({ onNavigate, orders, onOpenOrder, onDuplicateOrder }: DashboardProps) {
  const stats = computeOrderStats(orders);
  const recent = sortByRecent(orders).slice(0, 8);

  const handleExport = async (order: OrderRecord) => {
    const csv = buildProductionCsvString(order.header, order.rows);
    await downloadCsvFile(productionCsvFileName(order.header.orderNo), csv);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink-900">Welcome back, Ahmed</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            Here is what is happening with your orders today.
          </p>
        </div>
        <button onClick={() => onNavigate("new-order")} className="zx-btn-primary">
          <Plus className="h-4 w-4" />
          New Order
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total Orders" value={stats.totalOrders} icon={ClipboardList} accent="navy" />
        <StatCard label="Draft Orders" value={stats.draftOrders} icon={FileClock} accent="amber" />
        <StatCard label="Ready for Production" value={stats.readyForProduction} icon={Hammer} accent="gold" />
        <StatCard label="Invoiced Orders" value={stats.invoicedOrders} icon={Receipt} accent="navy" />
        <StatCard label="CSV Exported" value={stats.exportedCsv} icon={FileSpreadsheet} accent="emerald" />
      </div>

      <div className="zx-card mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h3 className="text-sm font-bold text-ink-900">Recent Orders</h3>
        </div>

        {recent.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <p className="text-sm text-ink-500">
              No orders yet — build one in New Order, then Save/Export it to see it here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr>
                  <th className="zx-th">Order No.</th>
                  <th className="zx-th">Date</th>
                  <th className="zx-th">Customer</th>
                  <th className="zx-th">Project</th>
                  <th className="zx-th">Salesperson</th>
                  <th className="zx-th text-right">Total Doors</th>
                  <th className="zx-th">Status</th>
                  <th className="zx-th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((order) => (
                  <tr key={order.orderNo} className="hover:bg-ink-50/60">
                    <td className="zx-td font-semibold text-navy-800">{order.orderNo}</td>
                    <td className="zx-td text-ink-500">{order.orderDate}</td>
                    <td className="zx-td">{order.customerName || "—"}</td>
                    <td className="zx-td text-ink-600">{order.projectName || "—"}</td>
                    <td className="zx-td text-ink-600">{order.salesperson || "—"}</td>
                    <td className="zx-td text-right tabular-nums">{order.totalDoors}</td>
                    <td className="zx-td">
                      <Badge status={order.status} />
                    </td>
                    <td className="zx-td">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onOpenOrder(order)}
                          title="Open in New Order"
                          className="zx-btn-ghost !px-2 !py-1.5"
                        >
                          <FolderOpen className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => onDuplicateOrder(order)}
                          title="Duplicate as a new order"
                          className="zx-btn-ghost !px-2 !py-1.5"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleExport(order)}
                          title="Export Production CSV"
                          className="zx-btn-ghost !px-2 !py-1.5"
                        >
                          <FileDown className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
