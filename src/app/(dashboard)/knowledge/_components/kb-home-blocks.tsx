import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CircleCheck } from "lucide-react";

import { HomeSection } from "@/app/(dashboard)/dashboard/_components/section";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { ProgressRing } from "@/components/shared/progress-ring";
import { StatusBadge } from "@/components/ui/status-badge";
import { countRu } from "@/lib/format/plural";
import type { KbHomeSection } from "@/lib/knowledge/home";
import type { KbRequiredUnreadRow } from "@/lib/knowledge/landing";
import { paletteBg } from "@/lib/palette";
import { cn } from "@/lib/utils";

/** Строка страницы в блоках главной — как строки «Сегодня»: значок в
 *  плитке 36px, название, справа подпись или действие. */
function PageRow({
  href,
  icon,
  iconColor,
  title,
  badge,
  trailing,
  index,
}: {
  href: string;
  icon: string | null;
  iconColor: string | null;
  title: string;
  badge?: ReactNode;
  trailing?: ReactNode;
  index: number;
}) {
  return (
    <li className="table-row-in" style={{ animationDelay: `${index * 40}ms` }}>
      <Link
        href={href}
        className="group/title flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted">
          <KbPageIcon icon={icon} color={iconColor} size={16} />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm transition-colors group-hover/title:text-brand">
            {title.trim() || "Без названия"}
          </span>
          {badge}
        </span>
        {trailing}
      </Link>
    </li>
  );
}

/**
 * «К прочтению · N»: кольцо с долей прочитанного и непрочитанные страницы.
 * На блок ведёт пункт «К прочтению» дерева (`/knowledge#to-read`).
 */
export function KbHomeToRead({
  rows,
  total,
}: {
  rows: KbRequiredUnreadRow[];
  total: number;
}) {
  const read = Math.max(0, total - rows.length);
  const ratio = total > 0 ? read / total : 0;
  const percent = Math.round(ratio * 100);
  return (
    // Якорь на обёртке, чтобы при переходе из дерева был виден и заголовок;
    // отступ — под липкую верхнюю панель.
    <div id="to-read" className="scroll-mt-20">
    <HomeSection title={rows.length > 0 ? `К прочтению · ${rows.length}` : "К прочтению"}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4 sm:w-28 sm:flex-col sm:gap-2">
          <ProgressRing ratio={ratio} label={`Прочитано ${percent} %`}>
            {percent} %
          </ProgressRing>
          <span className="text-[13px] tabular-nums text-muted-foreground">
            Прочитано {read} из {total}
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 text-sm">
            <CircleCheck className="size-4 text-emerald-700 dark:text-emerald-400" />
            Всё обязательное прочитано
          </div>
        ) : (
          <ul className="-mx-2 min-w-0 flex-1">
            {/* Весь список: заголовок «К прочтению · N» и пункт дерева со
                счётчиком обещают все N страниц, а не первые пять. */}
            {rows.map((row, i) => (
              <PageRow
                key={row.id}
                index={i}
                href={`/knowledge/${row.slug}`}
                icon={row.icon}
                iconColor={row.icon_color}
                title={row.title}
                badge={row.reread ? <StatusBadge tone="info">Обновлено</StatusBadge> : null}
                trailing={
                  <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-brand">
                    Читать
                    <ArrowRight className="size-4" />
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </div>
    </HomeSection>
    </div>
  );
}

/** «Разделы»: плитки страниц верхнего уровня. */
export function KbHomeSections({ sections }: { sections: KbHomeSection[] }) {
  if (sections.length === 0) return null;
  return (
    <HomeSection title="Разделы">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sections.map((section, i) => (
          <li key={section.id} className="table-row-in" style={{ animationDelay: `${i * 40}ms` }}>
            <Link
              href={`/knowledge/${section.slug}`}
              className="group/title flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-foreground/20 hover:bg-muted/40"
            >
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-lg",
                  paletteBg(section.iconColor) || "bg-muted",
                )}
              >
                <KbPageIcon icon={section.icon} color={section.iconColor} size={20} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium transition-colors group-hover/title:text-brand">
                  {section.title.trim() || "Без названия"}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {section.pageCount > 0
                    ? countRu(section.pageCount, "страница", "страницы", "страниц")
                    : "Без подстраниц"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </HomeSection>
  );
}

/** Список страниц («Недавно обновлённые», «Избранное»); пустой — не рисуется. */
export function KbHomePageList({
  title,
  rows,
  trailing,
}: {
  title: string;
  rows: { id: string; slug: string; title: string; icon: string | null; icon_color: string | null }[];
  trailing?: (id: string) => ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <HomeSection title={title}>
      <ul className="-mx-2">
        {rows.map((row, i) => (
          <PageRow
            key={row.id}
            index={i}
            href={`/knowledge/${row.slug}`}
            icon={row.icon}
            iconColor={row.icon_color}
            title={row.title}
            trailing={trailing?.(row.id)}
          />
        ))}
      </ul>
    </HomeSection>
  );
}
