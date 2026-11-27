import type { ReactNode } from "react";

/**
 * Раздел под текстом документа: «Подстраницы», «Обсуждение», «Ссылаются
 * сюда». Один вид для всех — тонкая линия сверху и заголовок 16 / 600 с
 * серым числом (docs/design-system.md → «База знаний» → «Документ»).
 */
export function KbDocSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="mt-2 flex flex-col gap-3 border-t pt-5">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        {title}
        {count !== undefined && count > 0 && (
          <span className="font-medium tabular-nums text-muted-foreground">{count}</span>
        )}
      </h2>
      {children}
    </section>
  );
}
