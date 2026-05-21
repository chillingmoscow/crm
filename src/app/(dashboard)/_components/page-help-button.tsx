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
import { resolvePageHelp } from "./page-help-registry";

/**
 * Контекстная справка в топ-баре — кнопка «?» слева от колокольчика
 * уведомлений, той же геометрии (size-9, rounded-lg). Контент берётся из
 * page-help-registry по текущему pathname; если справки для страницы нет —
 * кнопка не рендерится.
 *
 * Горячие клавиши — отдельная глобальная модалка (клавиша «?»,
 * hotkeys-dialog), здесь только справка по разделу.
 */
export function PageHelpButton() {
  const pathname = usePathname() ?? "";
  const entry = resolvePageHelp(pathname);
  const [open, setOpen] = useState(false);

  if (!entry) return null;
  const { Content, title } = entry;

  return (
    <>
      <button
        type="button"
        aria-label={`Справка: ${title}`}
        title={`Справка: ${title}`}
        onClick={() => setOpen(true)}
        className="relative inline-flex size-9 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <HelpCircle className="h-[18px] w-[18px]" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-5 text-sm leading-relaxed">
            <Content />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
