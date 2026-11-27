"use client";

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import {
  SIDEBAR_COOKIE_MAX_AGE,
  SIDEBAR_COOKIE_NAME,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  KB_MENU_COOKIE,
  isKnowledgePath,
  resolveMenuOpen,
} from "@/lib/knowledge/shell";

/**
 * Меню приложения с двумя запомненными состояниями: обычное и в базе
 * знаний. В базе меню по умолчанию свёрнуто в иконки, чтобы дереву
 * страниц и тексту хватало места; выбор «развернуть» там запоминается
 * отдельно и не трогает настройку меню в остальных разделах
 * (docs/superpowers/specs/2026-11-27-kb-redesign-design.md, «Раскладка»).
 */
export function WorkspaceSidebarProvider({
  appDefaultOpen,
  kbDefaultOpen,
  className,
  style,
  children,
}: {
  appDefaultOpen: boolean;
  kbDefaultOpen: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const onKnowledge = isKnowledgePath(usePathname());
  const [appOpen, setAppOpen] = useState(appDefaultOpen);
  const [kbOpen, setKbOpen] = useState(kbDefaultOpen);

  const onOpenChange = useCallback(
    (next: boolean) => {
      const cookie = onKnowledge ? KB_MENU_COOKIE : SIDEBAR_COOKIE_NAME;
      (onKnowledge ? setKbOpen : setAppOpen)(next);
      document.cookie = `${cookie}=${next}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
    },
    [onKnowledge],
  );

  return (
    <SidebarProvider
      open={resolveMenuOpen({ onKnowledge, appOpen, kbOpen })}
      onOpenChange={onOpenChange}
      className={className}
      style={style}
    >
      {children}
    </SidebarProvider>
  );
}
