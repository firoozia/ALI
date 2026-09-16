import { STATUS_STYLES } from "../../core/mockData";

export default function Badge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] || "bg-ink-100 text-ink-600";
  return <span className={`zx-badge ${cls}`}>{status}</span>;
}
