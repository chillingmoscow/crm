"use client";

import { HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * Контекстная справка по странице: кнопка «?» в шапке открывает боковую
 * панель с подсказкой (статусы, роли, горячие клавиши и т.п.). Контент
 * передаётся как children — справка по конкретной странице живёт рядом с
 * этой страницей. Состояние open контролируемое, чтобы клавиша «?» могла
 * открыть панель из родителя.
 */
export function HelpButton({
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
          aria-label="Справка"
          title="Справка (?)"
        >
          <HelpCircle className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="mt-4 space-y-5 text-sm leading-relaxed">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
