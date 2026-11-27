import Link from "next/link";
import { BookMarked, CalendarDays, ListChecks } from "lucide-react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { AnimatedMoney } from "@/components/shared/animated-money";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { formatRub } from "@/components/shared/money";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatDayMonth, formatWeekdayDayMonth } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { getHomeContext } from "@/lib/home/context";
import { loadMyAccrued, loadMyReading, loadMyShifts, loadMyTasks, type MyTask } from "@/lib/home/my-day";
import { capitalize } from "@/lib/home/attention-text";
import { relativeDayLabel } from "@/lib/home/today";
import { taskStatus } from "@/lib/schedule/tasks";
import { cn } from "@/lib/utils";

import { BlockEmpty, BlockError, HomeSection, SectionLink } from "./section";

const MONTHS_NOMINATIVE = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

function timeIn(iso: string, timeZone: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone });
}

/** День смены по часам заведения: «Сегодня», «Завтра» или «Суббота, 29 ноября». */
function dayLabel(iso: string, today: string, timeZone: string) {
  const day = new Date(iso).toLocaleDateString("sv-SE", { timeZone });
  return relativeDayLabel(day, today) ?? capitalize(formatWeekdayDayMonth(day) ?? day);
}

/** Мои ближайшие смены. */
export async function MyShiftsBlock() {
  const ctx = await getHomeContext();
  if (!ctx) return null;
  let shifts: Awaited<ReturnType<typeof loadMyShifts>>;
  try {
    shifts = await loadMyShifts();
  } catch (error) {
    console.error("[home] my shifts:", error);
    return (
      <HomeSection title="Мои смены">
        <BlockError what="смены" />
      </HomeSection>
    );
  }
  return (
    <HomeSection title="Мои смены" action={<SectionLink href="/schedule" label="Расписание" />}>
      {shifts.length === 0 ? (
        <BlockEmpty>Ближайших смен в графике нет</BlockEmpty>
      ) : (
        <ul className="-mx-2">
          {shifts.map((s, i) => {
            const now = Date.now();
            const live = Date.parse(s.startsAt) <= now && Date.parse(s.endsAt) > now;
            return (
              <li
                key={s.id}
                className="table-row-in flex items-center gap-3 rounded-md px-2 py-2"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <CalendarDays className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  {/* Ночная смена, начатая вчера, — «Идёт сейчас», а не «Вчера». */}
                  <span className={cn("block truncate text-sm font-medium", live && "text-emerald-700 dark:text-emerald-400")}>
                    {live ? "Идёт сейчас" : dayLabel(s.startsAt, ctx.calendarDay, ctx.timezone)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground tabular-nums">
                    {timeIn(s.startsAt, ctx.timezone)}–{timeIn(s.endsAt, ctx.timezone)}
                    {s.title ? ` · ${s.title}` : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </HomeSection>
  );
}

/** Начислено за месяц — досчитывается. Нет карточки в «Зарплате» — блока нет. */
export async function MyAccruedBlock() {
  let data: Awaited<ReturnType<typeof loadMyAccrued>>;
  try {
    data = await loadMyAccrued();
  } catch (error) {
    console.error("[home] my accrued:", error);
    return <BlockError what="начисления" />;
  }
  if (!data) return null;
  const month = MONTHS_NOMINATIVE[Number(data.month.slice(5, 7)) - 1];
  return (
    <MetricStrip label={`Начислено за ${month}`} columns={data.tips > 0 ? 2 : 1} className="motion-rise">
      <Metric
        primary
        label={`Начислено за ${month}`}
        value={<AnimatedMoney value={data.salary} />}
        hint={data.shifts ? `За ${countRu(data.shifts, "смену", "смены", "смен")}` : "Смен в этом месяце пока нет"}
      />
      {data.tips > 0 ? (
        <Metric label="Чаевые" value={<AnimatedMoney value={data.tips} />} hint={`Всего с зарплатой ${formatRub(data.salary + data.tips)}`} />
      ) : null}
    </MetricStrip>
  );
}

const TASK_TONE: Partial<Record<MyTask["status"], StatusTone>> = {
  assigned: "neutral",
  in_progress: "info",
  returned: "warning",
};

/** Мои задачи, которые ждут меня. */
export async function MyTasksBlock() {
  const ctx = await getHomeContext();
  if (!ctx) return null;
  let tasks: MyTask[];
  try {
    tasks = await loadMyTasks();
  } catch (error) {
    console.error("[home] my tasks:", error);
    return (
      <HomeSection title="Мои задачи">
        <BlockError what="задачи" />
      </HomeSection>
    );
  }
  return (
    <HomeSection title="Мои задачи" action={<SectionLink href="/schedule?showTasks=1" label="Все задачи" />}>
      {tasks.length === 0 ? (
        <BlockEmpty>Открытых задач нет</BlockEmpty>
      ) : (
        <ul className="-mx-2">
          {tasks.map((t, i) => (
            <li
              key={t.id}
              className="table-row-in flex items-center gap-3 rounded-md px-2 py-2"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <ListChecks className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{t.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {relativeDayLabel(t.businessDay, ctx.businessDay) ?? formatDayMonth(t.businessDay)}
                  {t.deadlineAt ? ` · до ${timeIn(t.deadlineAt, ctx.timezone)}` : ""}
                </span>
              </span>
              <StatusBadge tone={TASK_TONE[t.status] ?? "neutral"}>{taskStatus[t.status]}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </HomeSection>
  );
}

/** Обязательное чтение из базы знаний, которое ещё не прочитано. */
export async function MyReadingBlock() {
  const { rows, error } = await loadMyReading();
  if (error)
    return (
      <HomeSection title="Обязательно к прочтению">
        <BlockError what="базу знаний" />
      </HomeSection>
    );
  return (
    <HomeSection
      title={rows.length ? `Обязательно к прочтению · ${rows.length}` : "Обязательно к прочтению"}
      action={<SectionLink href="/knowledge" label="База знаний" />}
    >
      {rows.length === 0 ? (
        <div className="flex items-center gap-3 py-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <BookMarked className="size-4" aria-hidden />
          </span>
          <span className="text-sm text-muted-foreground">Всё прочитано</span>
        </div>
      ) : (
        <ul className="-mx-2">
          {rows.slice(0, 5).map((r, i) => (
            <li key={r.id} className="table-row-in" style={{ animationDelay: `${i * 40}ms` }}>
              <Link
                href={`/knowledge/${r.slug}`}
                className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted">
                  <KbPageIcon icon={r.icon} color={r.iconColor} size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HomeSection>
  );
}
