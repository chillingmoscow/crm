"use client";

import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command";
import { PayrollEmployeeCell } from "./payroll-employee-cell";

type EmployeeOption = { id: string; name: string; role_name?: string | null; avatar_url?: string | null };

/** Shared single/multiple employee selection; callers retain eligibility rules. */
export function PayrollEmployeePicker({ employees, selectedIds, onChange, multiple = false, disabled = false }: {
  employees: EmployeeOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const employee = employees.find((e) => e.id === selectedIds[0]);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button ref={trigger} type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={multiple ? "Выбрать сотрудников" : "Выбрать сотрудника"}
        disabled={disabled} className="h-auto min-h-12 w-full justify-between gap-3 px-3 py-2 text-left font-normal">
        {!multiple && employee ? <PayrollEmployeeCell name={employee.name} role={employee.role_name} avatarUrl={employee.avatar_url}/> : <span className="text-[13px]">{multiple ? selectedIds.length ? `Добавить сотрудника · выбрано ${selectedIds.length}` : "Выберите сотрудников" : "Выберите сотрудника"}</span>}
        <ChevronDown size={16} className="shrink-0 text-muted-foreground"/>
      </Button>
    </PopoverTrigger>
    {/* Keep the scrollable popup within the modal scroll lock. */}
    <PopoverContent portalContainer={trigger.current?.closest<HTMLElement>('[role="dialog"]')} align="start" className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-32px)] p-0">
      <Command>
        <CommandInput placeholder="Имя или должность"/>
        <CommandList className="max-h-[min(320px,50dvh)] overscroll-contain touch-pan-y [scrollbar-width:thin]">
          <CommandEmpty>Сотрудник не найден</CommandEmpty>
          {[...employees].sort((a, b) => a.name.localeCompare(b.name, "ru")).map((e) => <CommandItem key={e.id} value={`${e.name} ${e.role_name ?? ""} ${e.id}`} className="gap-3 px-3 py-2.5"
            onSelect={() => {
              onChange(multiple ? selectedIds.includes(e.id) ? selectedIds.filter((id) => id !== e.id) : [...selectedIds, e.id] : [e.id]);
              if (!multiple) setOpen(false);
            }}>
            <PayrollEmployeeCell name={e.name} role={e.role_name} avatarUrl={e.avatar_url}/>
            {selectedIds.includes(e.id) && <Check size={16} className="ml-auto shrink-0 text-brand"/>}
          </CommandItem>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
