import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Раздел документа: «Подстраницы» и «Ссылаются сюда» под текстом (линия
 * сверху), «Обсуждение» над текстом (линия снизу). Заголовок 16 / 600 с
 * серым числом (docs/design-system.md → «База знаний» → «Документ»).
 */
export function KbDocSection({
  title,
  count,
  divider = "top",
  children,
}: {
  title: string;
  count?: number;
  /** Где линия: над разделом (под текстом) или под ним (раздел над
   *  текстом — «Обсуждение»). */
  divider?: "top" | "bottom";
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col gap-3",
        divider === "top" ? "mt-2 border-t pt-5" : "mb-2 border-b pb-5",
      )}
    >
      {/* tracking-normal: общий h2 сжат (tracking-tight) под крупные
          заголовки; на 16px это выглядело другим шрифтом. */}
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-normal">
        {title}
        {count !== undefined && count > 0 && (
          <span className="font-medium tabular-nums text-muted-foreground">{count}</span>
        )}
      </h2>
      {children}
    </section>
  );
}
