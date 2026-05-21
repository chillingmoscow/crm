import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
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
      <div className="flex min-w-0 items-center gap-3">
        <span className="whitespace-nowrap text-sm font-medium text-brand">Выбрано {selectedCount}</span>
        {summary}
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2 overflow-x-auto">
        {actions}
        <Button type="button" variant="ghost" size="sm" onClick={onClear} className="h-8 text-xs">
          <X className="mr-2 h-4 w-4" />
          Снять выбор
        </Button>
      </div>
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
