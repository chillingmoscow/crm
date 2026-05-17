import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { PageBreadcrumb } from "@/components/shared/page-header-actions";

/**
 * Единый заголовок для разделов базы знаний (Дашборд, Журнал,
 * Корзина). Унифицирует breadcrumb-возврат, типографику h1 и
 * подзаголовок — перекликается с KB-главной (`/knowledge`:
 * text-[28px] font-bold tracking-tight). До этого каждый экран
 * оформлял шапку по-своему (28px bold/extrabold, иконка у h1
 * где-то была, breadcrumb то ссылка-назад, то название с иконкой).
 *
 * Рендерит:
 *  — `<PageBreadcrumb>` слот в топбар: ссылка «‹ База знаний»;
 *  — блок шапки в теле: h1 + опц. описание + опц. `actions`
 *    (период/вид-табы, кнопки) справа.
 */
export function KbSectionHeader({
  title,
  description,
  actions,
  hideBreadcrumb = false,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /**
   * Index-страницы (Дашборд) breadcrumb не нужен — главный
   * заголовок остаётся в теле (см. design-system § Top bar).
   */
  hideBreadcrumb?: boolean;
}) {
  return (
    <>
      {!hideBreadcrumb && (
        <PageBreadcrumb>
          <Link
            href="/knowledge"
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            База знаний
          </Link>
        </PageBreadcrumb>
      )}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="text-[28px] font-bold tracking-tight leading-tight">
            {title}
          </h1>
          {description != null && (
            <p className="text-sm text-muted-foreground max-w-[640px]">
              {description}
            </p>
          )}
        </div>
        {actions}
      </header>
    </>
  );
}
