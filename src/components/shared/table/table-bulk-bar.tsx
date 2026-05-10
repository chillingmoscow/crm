import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

type TableBulkBarProps = {
  selectedCount: number;
  onClear: () => void;
  actions?: ReactNode;
};

export function TableBulkBar({ selectedCount, onClear, actions }: TableBulkBarProps) {
  if (selectedCount <= 0) return null;

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex h-[49px] items-center justify-between gap-3 border-b bg-muted px-4 shadow-sm">
      <div className="min-w-0 text-sm font-medium">Выбрано {selectedCount}</div>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
        {actions}
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          <X className="mr-2 h-4 w-4" />
          Снять выбор
        </Button>
      </div>
    </div>
  );
}
