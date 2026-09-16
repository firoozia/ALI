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
import { DASHBOARD_STATS, RECENT_ORDERS } from "../core/mockData";

export default function Dashboard({ onNavigate, onOpenOrder }) {
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
        <StatCard label="Total Orders" value={DASHBOARD_STATS.totalOrders} icon={ClipboardList} accent="navy" />
        <StatCard label="Draft Orders" value={DASHBOARD_STATS.draftOrders} icon={FileClock} accent="amber" />
        <StatCard label="Ready for Production" value={DASHBOARD_STATS.readyForProduction} icon={Hammer} accent="gold" />
        <StatCard label="Invoiced Orders" value={DASHBOARD_STATS.invoicedOrders} icon={Receipt} accent="navy" />
        <StatCard label="Exported CSV Files" value={DASHBOARD_STATS.exportedCsv} icon={FileSpreadsheet} accent="emerald" />
      </div>

      <div className="zx-card mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h3 className="text-sm font-bold text-ink-900">Recent Orders</h3>
          <button className="text-xs font-semibold text-navy-700 hover:underline">View all orders</button>
        </div>

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
              {RECENT_ORDERS.map((order) => (
                <tr key={order.orderNo} className="hover:bg-ink-50/60">
                  <td className="zx-td font-semibold text-navy-800">{order.orderNo}</td>
                  <td className="zx-td text-ink-500">{order.date}</td>
                  <td className="zx-td">{order.customer}</td>
                  <td className="zx-td text-ink-600">{order.project}</td>
                  <td className="zx-td text-ink-600">{order.salesperson}</td>
                  <td className="zx-td text-right tabular-nums">{order.totalDoors}</td>
                  <td className="zx-td">
                    <Badge status={order.status} />
                  </td>
                  <td className="zx-td">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onOpenOrder && onOpenOrder(order)}
                        title="Open"
                        className="zx-btn-ghost !px-2 !py-1.5"
                      >
                        <FolderOpen className="h-4 w-4" />
                      </button>
                      <button title="Duplicate" className="zx-btn-ghost !px-2 !py-1.5">
                        <Copy className="h-4 w-4" />
                      </button>
                      <button title="Export" className="zx-btn-ghost !px-2 !py-1.5">
                        <FileDown className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
