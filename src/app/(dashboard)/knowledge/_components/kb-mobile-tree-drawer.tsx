"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { KbTreeNav } from "@/app/(dashboard)/knowledge/_components/kb-tree-nav";
import type { KbTreeNode } from "@/types/knowledge";

interface KbMobileTreeDrawerProps {
  nodes: KbTreeNode[];
  canSeeTrash: boolean;
}

/**
 * Мобильная (< md) обёртка над KbTreeNav. Sticky-кнопка-«гамбургер»
 * под app-header'ом открывает дерево в Sheet'е слева. На desktop
 * (≥ md) триггер скрывается — там работает sticky-aside из layout.
 *
 * Sheet закрывается автоматически при смене pathname (т.е. когда
 * пользователь кликнул страницу в дереве).
 */
export function KbMobileTreeDrawer({ nodes, canSeeTrash }: KbMobileTreeDrawerProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="md:hidden gap-1.5"
          aria-label="Открыть дерево страниц"
        >
          <Menu className="size-4" />
          Страницы
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[88vw] max-w-sm bg-sidebar p-0"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm">База знаний</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto h-[calc(100vh-3.25rem)]">
          <KbTreeNav nodes={nodes} canSeeTrash={canSeeTrash} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
