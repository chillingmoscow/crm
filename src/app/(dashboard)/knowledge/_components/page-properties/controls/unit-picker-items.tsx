"use client";

import { Check } from "lucide-react";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  MASS_UNITS,
  PIECE_UNIT,
  UNIT_CURRENCIES,
  VOLUME_UNITS,
  type Unit,
} from "@/lib/units";

/** Items для submenu «Единица измерения» в ⋯ меню. Группы: «Без
 *  единицы» / Валюта / Масса / Объём / Штук. Текущая единица помечена
 *  галочкой. Click → onChange(unit). Click «Без единицы» → onChange(null)
 *  (= delete unit поля из property). */
export function UnitPickerItems({
  current,
  onChange,
}: {
  current: Unit | undefined;
  onChange: (unit: Unit | null) => void;
}) {
  const isNone = !current || current.kind === "none";
  const isCurrency = (code: string) =>
    current?.kind === "currency" && current.code === code;
  const isMass = (code: string) =>
    current?.kind === "mass" && current.code === code;
  const isVolume = (code: string) =>
    current?.kind === "volume" && current.code === code;
  const isPiece = current?.kind === "piece";

  return (
    <>
      <DropdownMenuItem
        onSelect={() => onChange(null)}
        className="text-muted-foreground"
      >
        <span className="size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/40" />
        Без единицы
        {isNone && <Check className="ml-auto size-3.5" />}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Валюта
      </div>
      {UNIT_CURRENCIES.map((c) => (
        <DropdownMenuItem
          key={c.value}
          onSelect={() => onChange({ kind: "currency", code: c.value })}
        >
          <span className="text-[13px] w-6 shrink-0 text-muted-foreground">
            {c.label.split(" ")[0]}
          </span>
          <span className="flex-1 truncate">
            {c.label.replace(/^\S+\s+/, "")}
          </span>
          {isCurrency(c.value) && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Масса
      </div>
      {MASS_UNITS.map((m) => (
        <DropdownMenuItem
          key={m.code}
          onSelect={() => onChange({ kind: "mass", code: m.code })}
        >
          <span className="text-[13px] w-6 shrink-0 text-muted-foreground">
            {m.label}
          </span>
          <span className="flex-1 truncate">{m.longLabel}</span>
          {isMass(m.code) && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Объём
      </div>
      {VOLUME_UNITS.map((v) => (
        <DropdownMenuItem
          key={v.code}
          onSelect={() => onChange({ kind: "volume", code: v.code })}
        >
          <span className="text-[13px] w-6 shrink-0 text-muted-foreground">
            {v.label}
          </span>
          <span className="flex-1 truncate">{v.longLabel}</span>
          {isVolume(v.code) && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => onChange({ kind: "piece" })}
      >
        <span className="text-[13px] w-6 shrink-0 text-muted-foreground">
          {PIECE_UNIT.label}
        </span>
        <span className="flex-1 truncate">{PIECE_UNIT.longLabel}</span>
        {isPiece && <Check className="ml-auto size-3.5" />}
      </DropdownMenuItem>
    </>
  );
}
