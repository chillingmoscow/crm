"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { openCommandPalette } from "@/components/shared/command-palette";
import { useKbSearchOptional } from "@/app/(dashboard)/knowledge/_components/kb-search-dialog";
import { isKnowledgePath } from "@/lib/knowledge/shell";
import { cn } from "@/lib/utils";

/** Классы поля поиска: в приложении поле с 768px, в базе знаний — с 1280px. */
const FIELD = {
  app: {
    button: "md:w-56 md:justify-start md:border md:border-input md:bg-background md:px-3 md:hover:bg-accent/60",
    icon: "md:size-4",
    text: "md:inline",
    kbd: "md:inline-flex",
  },
  kb: {
    button: "xl:w-56 xl:justify-start xl:border xl:border-input xl:bg-background xl:px-3 xl:hover:bg-accent/60",
    icon: "xl:size-4",
    text: "xl:inline",
    kbd: "xl:inline-flex",
  },
} as const;

/**
 * Кнопка поиска в верхней панели: открывает палитру ⌘K. На широком экране —
 * поле-кнопка «Поиск» с подсказкой сочетания, на телефоне — иконка.
 * Обёрнута в span: правило верхней панели квадратит прямых детей-кнопок.
 *
 * В базе знаний поиск один: поле подписано «Поиск по базе» и открывает
 * поиск по страницам (как ⌘K там); в окне есть переход к общему поиску.
 * Там слева ещё и дерево страниц, поэтому полем поиск становится только
 * с 1280px — уже оно забирало место у пути к странице.
 */
export function CommandPaletteTrigger() {
  const [mod, setMod] = useState("Ctrl");
  const kbSearch = useKbSearchOptional();
  const inKnowledge = isKnowledgePath(usePathname()) && kbSearch !== null;
  // navigator есть только в браузере — после маунта, без SSR-расхождения.
  useEffect(() => {
    if (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setMod("⌘");
  }, []);
  const field = FIELD[inKnowledge ? "kb" : "app"];
  return (
    <span className="inline-flex">
      <button
        type="button"
        onClick={inKnowledge ? kbSearch.open : openCommandPalette}
        aria-label={inKnowledge ? "Поиск по базе знаний" : "Поиск и команды"}
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          "inline-flex size-9 items-center justify-center gap-2 rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground",
          field.button,
        )}
      >
        <Search className={cn("size-[18px] shrink-0", field.icon)} />
        <span className={cn("hidden flex-1 truncate text-left text-sm", field.text)}>
          {inKnowledge ? "Поиск по базе" : "Поиск"}
        </span>
        {/* На сенсорном экране клавиатуры нет — подсказку прячем. */}
        <span className="hide-on-coarse-pointer shrink-0">
          <kbd
            className={cn(
              "hidden rounded-sm border border-border bg-muted px-1.5 py-px font-mono text-xs font-semibold",
              field.kbd,
            )}
          >
            {mod} K
          </kbd>
        </span>
      </button>
    </span>
  );
}
