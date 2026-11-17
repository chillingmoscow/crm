"use client";
/* eslint-disable @next/next/no-img-element */
import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, History, Plus, Users } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { dateInZone } from "@/lib/schedule/utils";
import { CASUAL_RECENT_DAYS, splitCasualEmployees } from "@/lib/schedule/casual-recency";
import type { ScheduleData } from "@/lib/schedule/types";

type Option = {
  value: string;
  name: string;
  hint: string;
  avatar?: string | null;
  disabled?: boolean;
  disabledHint?: string;
};

function Avatar({ name, src }: { name: string; src?: string | null }) {
  return src ? (
    <img src={src} alt="" className="size-7 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/**
 * Выбор исполнителя смены: штатные сотрудники, актуальные разовые и (по
 * поиску или по кнопке) бывшие разовые — те, у кого не было смен
 * последние CASUAL_RECENT_DAYS дней.
 *
 * value: user_id штатного, `payroll:<id>` разового, `new-casual` или null.
 */
export function EmployeePicker({
  data,
  value,
  onChange,
  disabled,
  unavailable,
  emptyLabel,
  includeCasual = true,
  allowNewCasual = false,
  id,
}: {
  data: ScheduleData;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  /** Уже занятые в этот день — показываются, но выбрать нельзя. */
  unavailable?: Set<string | null>;
  /** Подпись пункта «без сотрудника»; без неё такого пункта нет. */
  emptyLabel?: string;
  includeCasual?: boolean;
  allowNewCasual?: boolean;
  id?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showFormer, setShowFormer] = useState(false);

  const { staff, recent, former } = useMemo(() => {
    const busy = (key: string) => unavailable?.has(key) ?? false;
    const staff: Option[] = data.staff
      .filter((s) => s.show_in_schedule || s.user_id === value)
      .map((s) => ({
        value: s.user_id,
        name: [s.first_name, s.last_name].filter(Boolean).join(" ") || s.role_name,
        hint: s.role_name,
        avatar: s.avatar_url,
        disabled: busy(s.user_id),
        disabledHint: busy(s.user_id) ? "уже в графике" : undefined,
      }));
    const casuals = data.casualEmployees ?? [];
    const keep = value?.startsWith("payroll:") ? [value.slice(8)] : [];
    const split = splitCasualEmployees({
      employees: includeCasual ? casuals : casuals.filter((e) => keep.includes(e.id)),
      today: dateInZone(new Date(), data.timezone),
      shiftDates: data.shifts
        .filter((s) => s.payroll_employee_id)
        .map((s) => ({
          employeeId: s.payroll_employee_id!,
          date: dateInZone(s.starts_at, data.timezone),
        })),
      keep,
    });
    const toOption = (e: (typeof casuals)[number]): Option => {
      const key = `payroll:${e.id}`;
      return {
        value: key,
        name: e.name,
        hint: `${e.role_name} · разовый`,
        disabled: busy(key),
        disabledHint: busy(key) ? "уже в графике" : undefined,
      };
    };
    return {
      staff,
      recent: split.recent.map(toOption),
      former: split.former.map(toOption),
    };
  }, [data, value, unavailable, includeCasual]);

  const all = [...staff, ...recent, ...former];
  const selected = all.find((o) => o.value === value);
  const searching = search.trim().length > 0;
  const formerVisible = showFormer || searching;

  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };
  const item = (o: Option) => (
    <CommandItem
      key={o.value}
      value={o.value}
      keywords={[o.name, o.hint]}
      disabled={o.disabled}
      onSelect={() => pick(o.value)}
      className="gap-2.5 px-2 py-1.5"
    >
      <Avatar name={o.name} src={o.avatar} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{o.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {o.disabledHint ?? o.hint}
        </span>
      </span>
      {o.value === value && <Check className="size-4 shrink-0 text-brand" />}
    </CommandItem>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSearch("");
          setShowFormer(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          id={id}
          type="button"
          aria-expanded={open}
          aria-label="Сотрудник"
          disabled={disabled}
          className="flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm font-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {value === "new-casual" ? (
            <span className="flex-1 truncate">Новый разовый сотрудник</span>
          ) : selected ? (
            <>
              <Avatar name={selected.name} src={selected.avatar} />
              <span className="min-w-0 flex-1 truncate">
                {selected.name}
                <span className="text-muted-foreground"> · {selected.hint}</span>
              </span>
            </>
          ) : (
            <span className="flex-1 truncate text-muted-foreground">
              {emptyLabel ?? "Выберите сотрудника"}
            </span>
          )}
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      {/* Внутри drawer'а — портал в диалог, чтобы список прокручивался колесом. */}
      <PopoverContent
        portalContainer={trigger.current?.closest<HTMLElement>('[role="dialog"]')}
        align="start"
        sideOffset={6}
        className="w-[var(--radix-popover-trigger-width)] min-w-72 max-w-[calc(100vw-32px)] p-0"
      >
        <Command>
          <CommandInput value={search} onValueChange={setSearch} placeholder="Имя или должность" />
          <CommandList className="max-h-[min(360px,50dvh)] overscroll-contain [scrollbar-width:thin]">
            <CommandEmpty>Сотрудник не найден</CommandEmpty>
            {emptyLabel && (
              <CommandGroup>
                <CommandItem
                  value="__none__"
                  keywords={[emptyLabel, "без сотрудника", "открытая"]}
                  onSelect={() => pick(null)}
                  className="gap-2.5 px-2 py-1.5"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Users className="size-3.5" />
                  </span>
                  <span className="flex-1 text-sm">{emptyLabel}</span>
                  {value === null && <Check className="size-4 shrink-0 text-brand" />}
                </CommandItem>
              </CommandGroup>
            )}
            {staff.length > 0 && <CommandGroup heading="Сотрудники">{staff.map(item)}</CommandGroup>}
            {recent.length > 0 && <CommandGroup heading="Разовые">{recent.map(item)}</CommandGroup>}
            {formerVisible && former.length > 0 && (
              <CommandGroup heading={`Бывшие разовые · без смен больше ${CASUAL_RECENT_DAYS} дней`}>
                {former.map(item)}
              </CommandGroup>
            )}
            {((!formerVisible && former.length > 0) || allowNewCasual) && <CommandSeparator />}
            {!formerVisible && former.length > 0 && (
              <CommandGroup>
                <CommandItem
                  value="__show_former__"
                  onSelect={() => setShowFormer(true)}
                  className="gap-2.5 px-2 py-2 text-muted-foreground"
                >
                  <History className="size-4" />
                  Показать бывших разовых · {former.length}
                </CommandItem>
              </CommandGroup>
            )}
            {allowNewCasual && (
              <CommandGroup>
                <CommandItem
                  value="__new_casual__"
                  keywords={["новый разовый сотрудник", "добавить"]}
                  onSelect={() => pick("new-casual")}
                  className={cn("gap-2.5 px-2 py-2")}
                >
                  <Plus className="size-4" />
                  Новый разовый сотрудник
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
