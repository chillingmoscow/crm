import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

type TableBulkBarProps = {
  selectedCount: number;
  onClear: () => void;
  actions?: ReactNode;
  colSpan?: number;
};

export function TableBulkBar({ selectedCount, onClear, actions, colSpan }: TableBulkBarProps) {
  if (selectedCount <= 0) return null;

  const content = (
    <>
      <div className="min-w-0 text-sm font-medium text-brand">Выбрано {selectedCount}</div>
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
    <div className="flex h-11 items-center gap-3 border-b bg-brand/10 px-4">
      {content}
    </div>
  );
}
