"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowUpDown,
  Download,
  Filter,
  Search,
  Settings2,
  Upload,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type TableControlSearch = {
  value: string;
  onChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
};

type TableControlPopover = {
  active?: boolean;
  content?: ReactNode;
  label?: string;
  align?: "start" | "center" | "end";
  onClick?: () => void;
};

type TableControlAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
};

type TableControlsProps = {
  search?: TableControlSearch;
  filters?: TableControlPopover;
  sort?: TableControlPopover;
  columns?: TableControlPopover;
  importAction?: TableControlAction;
  exportAction?: TableControlAction;
  primaryActions?: ReactNode;
  secondaryActions?: ReactNode;
  summary?: ReactNode;
  className?: string;
};

export function TableControls({
  search,
  filters,
  sort,
  columns,
  importAction,
  exportAction,
  primaryActions,
  secondaryActions,
  summary,
  className,
}: TableControlsProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (search?.open) inputRef.current?.focus();
  }, [search?.open]);

  return (
    // По умолчанию тулбар — content-width и прижат вправо родителем
    // (justify-between/justify-end), чтобы кнопки стояли справа и делили
    // строку с левым контентом (напр. «Черновик …» в форме). Только когда
    // открыт поиск, на мобильном тулбар становится w-full, чтобы поле
    // поиска уместилось отдельной строкой ниже; иконки при этом держим
    // справа через justify-end. На sm+ — всегда content-width.
    <div className={cn("flex items-center gap-2", search?.open && "w-full sm:w-auto", className)}>
      <div
        className={cn(
          "flex flex-wrap items-center justify-end gap-2",
          search?.open && "w-full sm:w-auto",
        )}
      >
        {search ? (
          <TooltipIconButton
            label={search.open ? "Скрыть поиск" : "Показать поиск"}
            active={search.open}
            onClick={() => {
              if (search.open) search.onChange("");
              search.onOpenChange(!search.open);
            }}
          >
            <Search className="h-4 w-4" />
          </TooltipIconButton>
        ) : null}

        {/* Поле поиска. На мобильном (order-last + w-full) переносится на
            отдельную строку под кнопками — на узких экранах рядом с
            иконками для него нет места. На sm+ (order-first + фикс-ширина)
            стоит слева, как раньше. */}
        {search?.open ? (
          <div className="relative order-last w-full sm:order-first sm:w-72">
            <Input
              ref={inputRef}
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              placeholder={search.placeholder ?? "Поиск"}
              className="h-9 w-full pr-8 text-sm"
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

        {filters ? (
          filters.onClick ? (
            <TooltipIconButton
              label={filters.label ?? "Фильтры"}
              active={filters.active}
              onClick={filters.onClick}
            >
              <Filter className="h-4 w-4" />
            </TooltipIconButton>
          ) : filters.content ? (
            <TableControlPopoverButton
              icon={<Filter className="h-4 w-4" />}
              active={filters.active}
              label={filters.label ?? "Фильтры"}
              align={filters.align}
            >
              {filters.content}
            </TableControlPopoverButton>
          ) : null
        ) : null}

        {sort ? (
          sort.onClick ? (
            <TooltipIconButton
              label={sort.label ?? "Сортировка"}
              active={sort.active}
              onClick={sort.onClick}
            >
              <ArrowUpDown className="h-4 w-4" />
            </TooltipIconButton>
          ) : sort.content ? (
            <TableControlPopoverButton
              icon={<ArrowUpDown className="h-4 w-4" />}
              active={sort.active}
              label={sort.label ?? "Сортировка"}
              align={sort.align}
            >
              {sort.content}
            </TableControlPopoverButton>
          ) : null
        ) : null}

        {columns ? (
          <TableControlPopoverButton
            icon={<Settings2 className="h-4 w-4" />}
            active={columns.active}
            label={columns.label ?? "Столбцы"}
            align={columns.align}
          >
            {columns.content}
          </TableControlPopoverButton>
        ) : null}

        {importAction ? (
          <TooltipIconButton
            label={importAction.label}
            disabled={importAction.disabled || importAction.loading}
            onClick={importAction.onClick}
          >
            <Upload className="h-4 w-4" />
          </TooltipIconButton>
        ) : null}

        {exportAction ? (
          <TooltipIconButton
            label={exportAction.label}
            disabled={exportAction.disabled || exportAction.loading}
            onClick={exportAction.onClick}
          >
            <Download className="h-4 w-4" />
          </TooltipIconButton>
        ) : null}

        {secondaryActions}
        {primaryActions}
      </div>
      {summary ? <span className="sr-only">{summary}</span> : null}
    </div>
  );
}

function TooltipIconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip delayDuration={450}>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn(
              "h-9 w-9 border-border text-muted-foreground hover:border-brand/40 hover:bg-background hover:text-foreground",
              "[&_svg]:h-4 [&_svg]:w-4",
              active ? "border-brand bg-background text-foreground shadow-[0_0_0_2px_hsl(var(--brand)/0.16)] hover:border-brand hover:bg-background" : null,
            )}
            disabled={disabled}
            onClick={onClick}
            aria-label={label}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function TableControlPopoverButton({
  icon,
  active,
  label,
  align = "end",
  children,
}: {
  icon: ReactNode;
  active?: boolean;
  label: string;
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  return (
    <Popover>
      <Tooltip delayDuration={450}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={cn(
                "h-9 w-9 border-border text-muted-foreground hover:border-brand/40 hover:bg-background hover:text-foreground",
                "[&_svg]:h-4 [&_svg]:w-4",
                active ? "border-brand bg-background text-foreground shadow-[0_0_0_2px_hsl(var(--brand)/0.16)] hover:border-brand hover:bg-background" : null,
              )}
              aria-label={label}
            >
              {icon}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align={align} className="w-80 p-4">
        {children}
      </PopoverContent>
    </Popover>
  );
}
