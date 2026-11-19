"use client";

import { useId, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  CUSTOM_LEVEL,
  NO_ACCESS_LEVEL,
  detectLevel,
  type PermissionSectionDef,
} from "./permission-modules";

export type SectionPermission = { id: string; code: string; description: string };

type LevelOption = { id: string; label: string; description: string; codes: readonly string[] };

/**
 * Раздел прав в карточке должности: иконка, название, выбор уровня справа,
 * под ним — что даёт уровень. Отдельные права с галками спрятаны в
 * раскрывашку «Отдельные права». Один вид для всех разделов, включая акты
 * инвентаризации (у них свои названия уровней — это данные, не разметка).
 */
export function PermissionSection({
  section,
  perms,
  visiblePerms,
  isGranted,
  open,
  onOpenChange,
  readOnly,
  busy,
  onApplyCodes,
  onToggle,
}: {
  section: PermissionSectionDef;
  /** Все права раздела, которые есть в БД, в порядке уровней. */
  perms: SectionPermission[];
  /** Что показать в раскрывашке (при поиске — только совпадения). */
  visiblePerms: SectionPermission[];
  isGranted: (permId: string) => boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly: boolean;
  busy: boolean;
  /** Выставить разделу РОВНО эти коды (выбор уровня). */
  onApplyCodes: (codes: ReadonlySet<string>) => void;
  onToggle: (permId: string) => void;
}) {
  const listId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);

  const available = new Set(perms.map((p) => p.code));
  const granted = new Set(perms.filter((p) => isGranted(p.id)).map((p) => p.code));
  const current = detectLevel(section.levels, granted, available);

  const options: LevelOption[] = [
    { ...NO_ACCESS_LEVEL, codes: [] },
    ...section.levels.map((l) => ({ ...l, codes: l.codes.filter((c) => available.has(c)) })),
  ];
  const currentOption =
    current === CUSTOM_LEVEL.id
      ? { ...CUSTOM_LEVEL, codes: [] }
      : (options.find((o) => o.id === current) ?? options[0]);
  const hasAccess = granted.size > 0;
  const Icon = section.icon;

  return (
    <div className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            hasAccess ? "bg-brand/10 text-brand" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold leading-tight">{section.label}</h3>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={readOnly || busy}
              aria-label={`${section.label}: ${currentOption.label}. Изменить уровень доступа`}
              className="shrink-0 font-normal"
            >
              {currentOption.label}
              <ChevronDown className="opacity-70" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 max-w-[calc(100vw-24px)] p-1">
            <div aria-label={`Уровни доступа: ${section.label}`}>
              {options.map((o) => {
                const selected = o.id === current;
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setPickerOpen(false);
                      if (!selected) onApplyCodes(new Set(o.codes));
                    }}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 rounded-md px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent",
                      selected && "bg-accent",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm">{o.label}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {o.description}
                      </span>
                    </span>
                    {selected ? <Check className="mt-0.5 size-3.5 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex flex-col items-start gap-1 pl-10">
        <p className="text-[13px] leading-snug text-muted-foreground">{currentOption.description}</p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => onOpenChange(!open)}
          className="inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
          Отдельные права · {granted.size} из {perms.length}
        </button>
      </div>

      {open ? (
        <div id={listId} className="rounded-[10px] border sm:ml-10">
          {visiblePerms.map((perm) => (
            <div
              key={perm.id}
              className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <Checkbox
                id={`perm-${perm.id}`}
                className="mt-px"
                checked={isGranted(perm.id)}
                disabled={readOnly}
                onCheckedChange={() => onToggle(perm.id)}
              />
              <label
                htmlFor={`perm-${perm.id}`}
                className={cn(
                  "text-[13px] leading-snug select-none",
                  readOnly ? "cursor-default text-muted-foreground" : "cursor-pointer text-foreground",
                )}
              >
                {perm.description}
              </label>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
