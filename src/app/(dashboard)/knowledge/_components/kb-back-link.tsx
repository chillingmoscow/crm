"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * Breadcrumb-back link для KB-страниц. Рендерится в PageBreadcrumb
 * слоте — т.е. в KB-собственном top-bar'е (см. knowledge/layout.tsx).
 *
 * "‹ Родитель" если есть parent, иначе "‹ База знаний".
 */
export function KbBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 -ml-2 px-2 py-1.5 rounded-md
                 text-[13px] font-medium text-muted-foreground
                 hover:text-foreground hover:bg-accent transition-colors"
    >
      <ChevronLeft className="w-4 h-4" />
      {label}
    </Link>
  );
}
