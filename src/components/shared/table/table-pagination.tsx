"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TablePaginationProps = {
  pageIndex: number;
  pageSize: number;
  total: number;
  hiddenCount?: number;
  pageSizeOptions?: number[];
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function TablePagination({
  pageIndex,
  pageSize,
  total,
  hiddenCount = 0,
  pageSizeOptions = [25, 50, 100],
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps) {
  if (total <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);

  return (
    <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div>
        Строк на странице:{" "}
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            onPageSizeChange(Number(value));
            onPageChange(0);
          }}
        >
          <SelectTrigger className="mx-1 inline-flex h-8 w-auto px-2 align-middle">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-2 tabular-nums">
          {from}-{to} из {total}
          {hiddenCount > 0 ? <span className="ml-1 text-muted-foreground/80">· скрыто: {hiddenCount}</span> : null}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <span className="mr-2 tabular-nums">
          Стр. {pageIndex + 1} из {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex <= 0}
          onClick={() => onPageChange(Math.max(0, pageIndex - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex >= totalPages - 1}
          onClick={() => onPageChange(Math.min(totalPages - 1, pageIndex + 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
