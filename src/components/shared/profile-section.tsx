"use client";

import * as React from "react";
import { Lock, Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** Shared section layout for staff and candidate profiles. */
export function ProfileSection({
  title,
  description,
  locked,
  children,
  actions,
}: {
  actions?: React.ReactNode;
  title: string;
  description?: string;
  /** Если задан — рядом с заголовком секции рисуется иконка-замочек
   * с tooltip'ом. tone:
   *   - "locked" — данными управляет сотрудник, для админа read-only
   *   - "info"   — placeholder-юзер, админ временно может править */
  locked?: { tone: "locked" | "info"; message?: string };
  children: React.ReactNode;
}) {
  const lockMessage = locked?.message ?? (locked?.tone === "locked"
    ? "Этими данными управляет сотрудник через свой профиль. Чтобы поменять — попросите его обновить."
    : "Сотрудник пока не зарегистрирован. Заполните за него — позже он сможет обновлять сам.");
  return (
    <section className="rounded-[14px] border bg-card p-5 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-foreground leading-tight">
              {title}
            </h2>
            {locked && (
              <TooltipProvider delayDuration={500} skipDelayDuration={500}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center text-muted-foreground/70 hover:text-muted-foreground cursor-help">
                      <Lock className="w-3 h-3" aria-label="Раздел с ограничением" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[280px] text-xs">
                    {lockMessage}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {description && (
            <p className="text-[13px] text-muted-foreground leading-snug">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** Кнопка «Добавить …» в шапке секции (`actions`). Один вид для всех секций
 *  профиля: outline 36px с плюсом, подпись — глагол с объектом
 *  («Добавить файл», «Добавить покупку»). */
export const ProfileSectionAddButton = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "variant" | "size" | "children" | "asChild"> & { children: string }
>(function ProfileSectionAddButton({ children, type = "button", ...props }, ref) {
  return (
    <Button ref={ref} type={type} variant="outline" size="sm" {...props}>
      <Plus className="size-4" />
      {children}
    </Button>
  );
});
