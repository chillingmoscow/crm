"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { KbTreeNav } from "@/app/(dashboard)/knowledge/_components/kb-tree-nav";
import type { KbFavoritePage } from "@/lib/knowledge/favorites";
import type { KbTreeNode } from "@/types/knowledge";

interface KbMobileTreeDrawerProps {
  nodes: KbTreeNode[];
  favorites?: KbFavoritePage[];
  canSeeTrash: boolean;
  canDelete?: boolean;
  canDuplicate?: boolean;
  canViewAudit?: boolean;
  canViewAnalytics?: boolean;
  canImport?: boolean;
  canCreate?: boolean;
  canManageTemplates?: boolean;
}

/**
 * Мобильная (< md) обёртка над KbTreeNav. Sticky-кнопка-«гамбургер»
 * под app-header'ом открывает дерево в Sheet'е слева. На desktop
 * (≥ md) триггер скрывается — там работает sticky-aside из layout.
 *
 * Sheet закрывается автоматически при смене pathname (т.е. когда
 * пользователь кликнул страницу в дереве).
 */
export function KbMobileTreeDrawer({
  nodes,
  favorites,
  canSeeTrash,
  canDelete = false,
  canDuplicate = false,
  canViewAudit = false,
  canViewAnalytics = false,
  canImport = false,
  canCreate = false,
  canManageTemplates = false,
}: KbMobileTreeDrawerProps) {
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
          <SheetDescription className="sr-only">
            Дерево страниц базы знаний
          </SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto h-[calc(100vh-3.25rem)]">
          <KbTreeNav
            nodes={nodes}
            favorites={favorites}
            canSeeTrash={canSeeTrash}
            canDelete={canDelete}
            canDuplicate={canDuplicate}
            canViewAudit={canViewAudit}
            canViewAnalytics={canViewAnalytics}
            canImport={canImport}
            canCreate={canCreate}
            canManageTemplates={canManageTemplates}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
