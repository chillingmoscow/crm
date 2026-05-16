"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Filter, Search, Settings2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type DataTableToolbarSearch = {
  value: string;
  onChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
};

type DataTableToolbarPopover = {
  active?: boolean;
  content: ReactNode;
  label?: string;
};

type DataTableToolbarProps = {
  search?: DataTableToolbarSearch;
  filters?: DataTableToolbarPopover;
  columns?: DataTableToolbarPopover;
  actions?: ReactNode;
  summary?: ReactNode;
  className?: string;
};

export function DataTableToolbar({
  search,
  filters,
  columns,
  actions,
  summary,
  className,
}: DataTableToolbarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (search?.open) inputRef.current?.focus();
  }, [search?.open]);

  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border bg-background p-3", className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {search ? (
            <div className="flex items-center gap-1">
              {search.open ? (
                <div className="relative">
                  <Input
                    ref={inputRef}
                    value={search.value}
                    onChange={(event) => search.onChange(event.target.value)}
                    placeholder={search.placeholder ?? "Поиск"}
                    className="h-9 w-64 pr-8 text-sm"
                  />
                  {search.value ? (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => search.onChange("")}
                      aria-label="Очистить поиск"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn("h-9 w-9", search.open ? "border-primary text-primary" : null)}
                onClick={() => {
                  if (search.open) search.onChange("");
                  search.onOpenChange(!search.open);
                }}
                aria-label={search.open ? "Скрыть поиск" : "Показать поиск"}
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
          ) : null}

          {filters ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={cn("h-9 w-9", filters.active ? "border-primary text-primary" : null)}
                  aria-label={filters.label ?? "Фильтры"}
                >
                  <Filter className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-4">
                {filters.content}
              </PopoverContent>
            </Popover>
          ) : null}

          {columns ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={cn("h-9 w-9", columns.active ? "border-primary text-primary" : null)}
                  aria-label={columns.label ?? "Столбцы таблицы"}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-4">
                {columns.content}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>

        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {summary ? <div className="text-xs text-muted-foreground">{summary}</div> : null}
    </div>
  );
}
