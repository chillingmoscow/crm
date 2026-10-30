import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { paletteBg, paletteText } from "@/lib/palette";
import { timeInZone } from "@/lib/schedule/utils";
import type { CandidateCalendarTrial } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

export function CandidateTrialCard({ trial, timezone, showName = false }: {
  trial: CandidateCalendarTrial;
  timezone: string;
  showName?: boolean;
}) {
  return (
    <Link
      href={`/people/candidates/${trial.candidate_id}`}
      aria-label={`Стажировка: ${trial.full_name}`}
      title={`Стажировка: ${trial.full_name}`}
      className={cn(
        "block min-w-0 space-y-1 rounded-lg p-2 text-xs outline-none transition-colors hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring",
        paletteBg("purple"), paletteText("purple"),
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        {showName && <CalendarDays className="size-3.5 shrink-0" />}
        <span className="min-w-0 truncate">Стажировка</span>
      </span>
      {showName && <span className="block break-words font-medium">{trial.full_name}</span>}
      <span className="block">
        {trial.starts_at ? timeInZone(trial.starts_at, timezone) : "Время не указано"}
        {trial.outcome === "passed" ? " · Пройдена" : ""}
      </span>
      {trial.location && <span className="block break-words opacity-80">{trial.location}</span>}
    </Link>
  );
}
