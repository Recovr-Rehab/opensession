import type React from "react";

/** A Linear-style titled card: label row + a bordered body of rows. */
export function PrCard({
  title,
  headExtra,
  children,
}: {
  title: string;
  headExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-panel border border-line bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <span className="text-meta font-semibold uppercase tracking-[0.08em] text-faint">{title}</span>
        {headExtra}
      </div>
      <div className="flex flex-col gap-2 px-4 py-3 sm:px-5">{children}</div>
    </div>
  );
}
