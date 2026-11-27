"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { openCommandPalette } from "@/components/shared/command-palette";
import { useKbSearchOptional } from "@/app/(dashboard)/knowledge/_components/kb-search-dialog";
import { isKnowledgePath } from "@/lib/knowledge/shell";

/**
 * Кнопка поиска в верхней панели: открывает палитру ⌘K. На широком экране —
 * поле-кнопка «Поиск» с подсказкой сочетания, на телефоне — иконка.
 * Обёрнута в span: правило верхней панели квадратит прямых детей-кнопок.
 *
 * В базе знаний поиск один: поле подписано «Поиск по базе» и открывает
 * поиск по страницам (как ⌘K там); в окне есть переход к общему поиску.
 */
export function CommandPaletteTrigger() {
  const [mod, setMod] = useState("Ctrl");
  const kbSearch = useKbSearchOptional();
  const inKnowledge = isKnowledgePath(usePathname()) && kbSearch !== null;
  // navigator есть только в браузере — после маунта, без SSR-расхождения.
  useEffect(() => {
    if (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setMod("⌘");
  }, []);
  return (
    <span className="inline-flex">
      <button
        type="button"
        onClick={inKnowledge ? kbSearch.open : openCommandPalette}
        aria-label={inKnowledge ? "Поиск по базе знаний" : "Поиск и команды"}
        aria-keyshortcuts="Meta+K Control+K"
        className="inline-flex size-9 items-center justify-center gap-2 rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground md:w-56 md:justify-start md:border md:border-input md:bg-background md:px-3 md:hover:bg-accent/60"
      >
        <Search className="size-[18px] shrink-0 md:size-4" />
        <span className="hidden flex-1 truncate text-left text-sm md:inline">
          {inKnowledge ? "Поиск по базе" : "Поиск"}
        </span>
        {/* На сенсорном экране клавиатуры нет — подсказку прячем. */}
        <span className="hide-on-coarse-pointer shrink-0">
          <kbd className="hidden rounded-sm border border-border bg-muted px-1.5 py-px font-mono text-xs font-semibold md:inline-flex">
            {mod} K
          </kbd>
        </span>
      </button>
    </span>
  );
}
