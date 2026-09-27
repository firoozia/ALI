import { useState } from "react";

interface NumberCellProps {
  value: number;
  onCommit: (value: number) => void;
  className?: string;
  step?: number;
  invalid?: boolean;
  /** Input style: "cell" for tables (default), "field" for forms. */
  variant?: "cell" | "field";
}

/**
 * A number input for values stored as numbers. While the user is typing, an
 * empty or partial entry ("", "-", "0.") stays in the box instead of snapping
 * to 0 (the old `Number(v) || 0` pattern made clearing a field impossible).
 * Only a finite number is committed; leaving the field empty restores the
 * last committed value.
 */
export default function NumberCell({ value, onCommit, className = "", step, invalid = false, variant = "cell" }: NumberCellProps) {
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);

  // Follow outside changes (import, undo) unless the box already shows that number.
  if (seen !== value) {
    setSeen(value);
    if (!(Number(text) === value && text.trim() !== "")) setText(String(value));
  }

  const base = variant === "cell" ? "zx-cell-input text-right" : "zx-input";
  return (
    <input
      type="number"
      step={step}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const n = Number(next);
        if (next.trim() !== "" && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => {
        if (text.trim() === "" || !Number.isFinite(Number(text))) setText(String(value));
      }}
      className={`${base} ${invalid ? "invalid" : ""} ${className}`}
    />
  );
}
