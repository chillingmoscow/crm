"use client";

import { useState } from "react";
import { Check, ChevronDown, ClipboardList } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  INVENTORY_ACTS_TIERS,
  detectInventoryActsTier,
} from "./permission-modules";

type ClusterPerm = { id: string; code: string; description: string };

/**
 * Объединённая секция «Акты инвентаризации» в редакторе роли. Вместо ~11
 * галок (документы + интеграция QR + расширенный доступ) — выбор одного из
 * трёх уровней (Исполнитель / Редактор / Полный доступ). Тонкая настройка
 * отдельных прав — под «Расширенно». Коды не меняются (см. permission-modules).
 */
export function InventoryActsPermissionSection({
  clusterPerms,
  isGranted,
  canEdit,
  isPending,
  onToggle,
  onApplyCodes,
}: {
  clusterPerms: ClusterPerm[];
  isGranted: (permId: string) => boolean;
  canEdit: boolean;
  isPending: boolean;
  /** Тоггл одного права (в «Расширенно»). */
  onToggle: (permId: string) => void;
  /** Выставить кластеру РОВНО эти коды (выбор уровня / «Нет доступа»). */
  onApplyCodes: (grantCodes: Set<string>) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const grantedCodes = new Set(
    clusterPerms.filter((p) => isGranted(p.id)).map((p) => p.code),
  );
  const currentTier = detectInventoryActsTier(grantedCodes);

  const options: { id: string; label: string; description: string; codes: string[] }[] = [
    { id: "none", label: "Нет доступа", description: "Роль не работает с актами инвентаризации.", codes: [] },
    ...INVENTORY_ACTS_TIERS,
  ];

  return (
    <div className="rounded-[14px] border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 bg-muted px-5 py-3.5 border-b">
        <div className="flex items-center justify-center size-7 rounded-lg bg-brand/10 shrink-0">
          <ClipboardList className="w-4 h-4 text-brand" />
        </div>
        <span className="text-sm font-semibold">Акты инвентаризации</span>
        {currentTier === "custom" ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200">
            Свой набор
          </span>
        ) : null}
      </div>

      {/* Уровни */}
      <div className="p-3 flex flex-col gap-2">
        {options.map((opt) => {
          const active = currentTier === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={!canEdit || isPending}
              onClick={() => onApplyCodes(new Set(opt.codes))}
              className={cn(
                "flex items-start gap-3 rounded-[10px] border px-4 py-3 text-left transition-colors",
                active ? "border-brand bg-brand/5" : "border-border hover:bg-accent",
                !canEdit ? "cursor-default opacity-80" : "cursor-pointer",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  active ? "border-brand bg-brand text-brand-foreground" : "border-muted-foreground/40",
                )}
                aria-hidden="true"
              >
                {active ? <Check className="size-3" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                  {opt.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Расширенно */}
      <div className="border-t">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-5 py-3 text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={cn("size-4 transition-transform", advancedOpen ? "rotate-180" : "")}
          />
          Расширенно — отдельные права
        </button>
        {advancedOpen ? (
          <div className="border-t">
            {clusterPerms.map((perm, i) => (
              <div
                key={perm.id}
                className={cn(
                  "flex items-center gap-3 px-5 py-3",
                  i < clusterPerms.length - 1 ? "border-b" : "",
                )}
              >
                <Checkbox
                  id={`perm-${perm.id}`}
                  checked={isGranted(perm.id)}
                  disabled={!canEdit}
                  onCheckedChange={() => onToggle(perm.id)}
                />
                <label
                  htmlFor={`perm-${perm.id}`}
                  className={cn(
                    "text-[13px] leading-tight select-none",
                    !canEdit ? "cursor-default text-muted-foreground" : "cursor-pointer text-foreground",
                  )}
                >
                  {perm.description}
                </label>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
