"use client";
import { useMemo } from "react";
import { ProfileSection } from "@/components/shared/profile-section";
import { candidateTimeline, timelineDate } from "@/lib/candidates/timeline";
import type { Candidate, CandidateEvent } from "@/lib/candidates/types";
import { cn } from "@/lib/utils";

/**
 * «Ход подбора»: путь кандидата по шагам, от старых к новым. Только шаги
 * подбора — анкета, этапы, назначения, переносы и итоги встреч; правки полей
 * и комментарии остаются в «Журнале».
 */
export function CandidateTimeline({
  candidate,
  events,
}: {
  candidate: Pick<Candidate, "submitted_at" | "source">;
  events: CandidateEvent[];
}) {
  const items = useMemo(() => candidateTimeline(candidate, events), [candidate, events]);
  return (
    <ProfileSection title="Ход подбора">
      <ol className="ml-1 border-l">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={item.id} className={cn("relative pl-5", !last && "pb-4")}>
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -left-[4.5px] top-1.5 size-2 rounded-full ring-4 ring-card",
                  last ? "bg-brand" : "bg-muted-foreground/40",
                )}
              />
              <p className="text-sm font-medium leading-snug">
                {item.title}
                {item.detail ? <span className="font-normal"> {item.detail}</span> : null}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                <time dateTime={item.at}>{timelineDate(item.at)}</time>
                {item.actor ? ` · ${item.actor}` : null}
              </p>
            </li>
          );
        })}
      </ol>
    </ProfileSection>
  );
}
