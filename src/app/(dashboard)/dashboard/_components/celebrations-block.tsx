import Link from "next/link";
import { Cake, PartyPopper } from "lucide-react";

import { PersonAvatar } from "@/components/people/person-avatar";
import { formatDayMonth } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { loadWeekCelebrations } from "@/lib/home/celebrations";
import { relativeDayLabel, type Celebration } from "@/lib/home/today";
import { cn } from "@/lib/utils";

import { BlockError, HomeSection } from "./section";

/**
 * Дни рождения и годовщины работы на этой неделе. Только с правом видеть
 * личные данные сотрудников (см. `canSeeCelebrations`). Пустая неделя —
 * блока нет: праздников не бывает «по расписанию».
 */
export async function CelebrationsBlock() {
  let data: Awaited<ReturnType<typeof loadWeekCelebrations>>;
  try {
    data = await loadWeekCelebrations();
  } catch (error) {
    console.error("[home] celebrations:", error);
    return (
      <HomeSection title="Праздники недели">
        <BlockError what="дни рождения" />
      </HomeSection>
    );
  }
  if (!data || data.items.length === 0) return null;
  const { items, today } = data;
  return (
    <HomeSection title="Праздники недели">
      <ul className="-mx-2">
        {items.map((c, i) => (
          <li
            key={`${c.kind}:${c.userId}`}
            className="table-row-in flex items-center gap-3 rounded-md px-2 py-2"
            style={{ animationDelay: `${Math.min(i, 15) * 40}ms` }}
          >
            <PersonAvatar src={c.avatarUrl} name={c.name} />
            <span className="min-w-0 flex-1">
              <Link
                href={`/people/staff/${c.userId}`}
                className="block truncate text-[13px] font-medium transition-colors duration-200 hover:text-brand focus-visible:text-brand focus-visible:outline-none"
              >
                {c.name}
              </Link>
              <span className="block truncate text-xs text-muted-foreground">{what(c)}</span>
            </span>
            <span
              className={cn(
                "shrink-0 text-right text-xs",
                c.date === today ? "font-medium text-brand" : "text-muted-foreground",
              )}
            >
              {when(c.date, today)}
            </span>
          </li>
        ))}
      </ul>
    </HomeSection>
  );
}

function what(c: Celebration) {
  const Icon = c.kind === "birthday" ? Cake : PartyPopper;
  const text =
    c.kind === "birthday"
      ? c.years
        ? `День рождения · ${countRu(c.years, "год", "года", "лет")}`
        : "День рождения"
      : `${countRu(c.years ?? 1, "год", "года", "лет")} в команде`;
  return (
    <>
      <Icon className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
      {text}
    </>
  );
}

const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** «Сегодня», «Завтра» или «Вс, 29 ноября» — коротко, чтобы не обрезать имя. */
function when(date: string, today: string) {
  const near = relativeDayLabel(date, today);
  if (near) return near;
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${formatDayMonth(date) ?? date}`;
}
