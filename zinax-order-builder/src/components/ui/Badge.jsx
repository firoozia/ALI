import { STATUS_STYLES } from "../../data/mockData";

export default function Badge({ status }) {
  const cls = STATUS_STYLES[status] || "bg-ink-100 text-ink-600";
  return <span className={`zx-badge ${cls}`}>{status}</span>;
}
