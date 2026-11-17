"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { HelpCircle } from "lucide-react";

import { EditDrawer } from "@/components/ui/edit-drawer";
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
        data-tip={`Справка: ${title}`}
        onClick={() => setOpen(true)}
        className="relative inline-flex size-9 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <HelpCircle className="h-[18px] w-[18px]" />
      </button>

      <EditDrawer open={open} onOpenChange={setOpen} title={title}>
        <div className="space-y-5 text-sm leading-relaxed">
          <Content />
        </div>
      </EditDrawer>
    </>
  );
}
