import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { paletteBg, paletteText } from "@/lib/palette";
import { timeInZone } from "@/lib/schedule/utils";
import type { CandidateCalendarTrial } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

export function CandidateTrialCard({ trial, timezone, showName = false, linked = true, venueName }: {
  trial: CandidateCalendarTrial;
  timezone: string;
  showName?: boolean;
  /** Текущее заведение: если стажировка в нём же, место не повторяем. */
  venueName?: string | null;
  /** Ссылка на карточку кандидата — только с правом работы с кандидатами. */
  linked?: boolean;
}) {
  const className = cn(
        "block min-w-0 space-y-1 rounded-lg p-2 text-xs outline-none transition-colors hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring",
        paletteBg("purple"), paletteText("purple"),
        !linked && "hover:opacity-100",
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
      {trial.location && trial.location.trim() !== venueName?.trim() && (
        <span className="block break-words opacity-80">{trial.location}</span>
      )}
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
