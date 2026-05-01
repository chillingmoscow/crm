"use client";

/**
 * EditDrawer — стандартизованный right-side drawer по правилу Sheerly DS:
 * 520px wide, без скругления, header/body/footer слоты.
 *
 * Используется для создания/редактирования сущностей (Новая должность,
 * Новый зал и т.д.). Для confirmation/destructive — берите Dialog (Modal).
 *
 * См. правила в `docs/design-system.md` § Overlays.
 */

import * as React from "react";
import { X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface EditDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Footer slot — typically <Button variant="outline">Отмена</Button> + <Button>Сохранить</Button> */
  footer?: React.ReactNode;
  className?: string;
}

export function EditDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: EditDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // Override default w-3/4/sm:max-w-sm: design says fixed 520px.
        className={cn(
          "p-0 gap-0 flex flex-col w-full sm:max-w-[520px]",
          className,
        )}
      >
        {/* Header — bordered bottom, padding [20,24] */}
        <div className="flex items-start justify-between gap-2 px-6 py-5 border-b border-border">
          <div className="flex flex-col gap-1 min-w-0">
            <SheetTitle className="text-[18px] font-semibold tracking-tight leading-tight">
              {title}
            </SheetTitle>
            {description && (
              <SheetDescription className="text-[13px] text-muted-foreground leading-relaxed">
                {description}
              </SheetDescription>
            )}
          </div>
          <SheetClose
            className="flex items-center justify-center size-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
            aria-label="Закрыть"
          >
            <X className="w-[18px] h-[18px]" />
          </SheetClose>
        </div>

        {/* Body — padding 24, vertical gap 20, scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-5">
          {children}
        </div>

        {/* Footer — bordered top, padding [16,24], right-aligned actions */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
