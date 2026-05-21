import type { ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

type TableBulkBarProps = {
  selectedCount: number;
  onClear: () => void;
  actions?: ReactNode;
  /** Доп. сводка рядом со счётчиком (например, сумма по выделенным строкам). */
  summary?: ReactNode;
  colSpan?: number;
  floating?: boolean;
};

export function TableBulkBar({ selectedCount, onClear, actions, summary, colSpan, floating }: TableBulkBarProps) {
  if (selectedCount <= 0) return null;

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          aria-label="Снять выбор"
          title="Снять выбор"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <span className="whitespace-nowrap text-sm font-medium text-brand">Выбрано {selectedCount}</span>
        {summary}
      </div>
      {actions ? (
        <div className="ml-auto flex min-w-0 items-center gap-2 overflow-x-auto">{actions}</div>
      ) : null}
    </>
  );

  if (colSpan) {
    return (
      <tr className="h-11 border-b bg-brand/10">
        <th colSpan={colSpan} className="px-3 py-2 text-left">
          <div className="flex items-center gap-3">{content}</div>
        </th>
      </tr>
    );
  }

  return (
    <div
      className={cn(
        "relative flex min-h-11 items-center gap-3 border bg-brand/10 px-4 py-2",
        floating
          ? "fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl rounded-lg border-border bg-background/95 shadow-md backdrop-blur"
          : "border-x-0 border-t-0",
      )}
    >
      {content}
    </div>
  );
}
