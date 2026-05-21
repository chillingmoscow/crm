"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { HelpCircle } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { InventoryActsHelp } from "./inventory-acts-help";

/**
 * Контекстная справка по актам инвентаризации в топ-баре — кнопка «?»
 * слева от колокольчика уведомлений, той же геометрии (size-9, rounded-lg).
 * Видна на всех страницах раздела актов (/documents/inventory*).
 *
 * Справка про роли/статусы/уведомления. Горячие клавиши — отдельно, в
 * глобальной модалке «Горячие клавиши» (клавиша «?», hotkeys-dialog),
 * которая теперь контекстная и показывает в т.ч. клавиши раздела актов.
 */
export function InventoryHelpTopbarButton() {
  const pathname = usePathname() ?? "";
  const active =
    pathname === "/documents/inventory" || pathname.startsWith("/documents/inventory/");
  const [open, setOpen] = useState(false);

  if (!active) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Справка по актам инвентаризации"
        title="Справка по актам инвентаризации"
        onClick={() => setOpen(true)}
        className="relative inline-flex size-9 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <HelpCircle className="h-[18px] w-[18px]" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Акты инвентаризации</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-5 text-sm leading-relaxed">
            <InventoryActsHelp />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
