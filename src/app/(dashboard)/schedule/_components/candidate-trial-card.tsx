import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { paletteBg, paletteText } from "@/lib/palette";
import { timeInZone } from "@/lib/schedule/utils";
import type { CandidateCalendarTrial } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

export function CandidateTrialCard({ trial, timezone, showName = false, linked = true }: {
  trial: CandidateCalendarTrial;
  timezone: string;
  showName?: boolean;
  /** Ссылка на карточку кандидата — только с правом работы с кандидатами. */
  linked?: boolean;
}) {
  const className = cn(
        // Та же карточка, что у смены в ячейке: rounded-md, px-1.5 py-2, gap-1.
        "grid min-w-0 gap-1 rounded-md px-1.5 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
        paletteBg("purple"), paletteText("purple"),
        // Наведение — подложка поверх цвета, как у карточки смены.
        linked && "transition-shadow duration-200 hover:shadow-[inset_0_0_0_999px_hsl(var(--foreground)/0.05)]",
      );
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        {showName && <CalendarDays className="size-3.5 shrink-0" />}
        <span className="min-w-0 truncate">Стажировка</span>
      </span>
      {showName && <span className="block break-words font-medium">{trial.full_name}</span>}
      <span className="block">
        {trial.starts_at ? timeInZone(trial.starts_at, timezone) : "Время не указано"}
        {trial.outcome === "passed" ? " · Пройдена" : ""}
      </span>
      {/* Место не показываем: расписание — по одному заведению, и стажировки
          здесь только его; стажировки другого заведения — в его расписании. */}
    </>
  );
  const label = `Стажировка: ${trial.full_name}`;
  return linked ? (
    <Link href={`/people/candidates/${trial.candidate_id}`} aria-label={label} data-tip={label} className={className}>
      {body}
    </Link>
  ) : (
    <div aria-label={label} data-tip={label} className={className}>
      {body}
    </div>
  );
}
