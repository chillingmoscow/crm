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
  canViewOverview?: boolean;
  readingSummary?: { total: number; unread: number };
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
  canViewOverview = false,
  readingSummary,
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
          className="shrink-0 gap-1.5 max-sm:size-9 max-sm:px-0 md:hidden"
          aria-label="Открыть дерево страниц"
        >
          <Menu className="size-4" />
          {/* На узком телефоне — только значок: подпись не оставляет места
              значкам справа. */}
          <span className="max-sm:hidden">Страницы</span>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        // Крестик панели стоит в правом верхнем углу — «+» шапки дерева
        // отодвигаем от него.
        className="flex w-[88vw] max-w-sm flex-col bg-sidebar p-0 [&_[data-kb-tree-header]]:pr-10"
        // Не автофокусим первый элемент (кнопку «Поиск») — иначе на тач её
        // Tooltip раскрывается по фокусу и подсказка «Поиск (⌘K)» висит при
        // каждом открытии дровера.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Заголовок «База знаний» рисует само дерево — здесь только для
            скринридера. */}
        <SheetHeader className="sr-only">
          <SheetTitle>База знаний</SheetTitle>
          <SheetDescription className="sr-only">
            Дерево страниц базы знаний
          </SheetDescription>
        </SheetHeader>
        {/* flex-1 + min-h-0 вместо h-[calc(100vh-…)]: 100vh на мобильном
            Safari переоценивает высоту (учитывает адресную строку), из-за чего
            нижняя секция «Инструменты менеджера» уходила за низ экрана и была
            недоступна. Теперь контейнер ровно заполняет Sheet и скроллится. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <KbTreeNav
            nodes={nodes}
            favorites={favorites}
            canSeeTrash={canSeeTrash}
            canDelete={canDelete}
            canDuplicate={canDuplicate}
            canViewOverview={canViewOverview}
            readingSummary={readingSummary}
            canImport={canImport}
            canCreate={canCreate}
            canManageTemplates={canManageTemplates}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
