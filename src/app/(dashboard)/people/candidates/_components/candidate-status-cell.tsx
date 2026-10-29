"use client";

import { useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CANDIDATE_STAGES,
  STATUSES,
  STATUS_CLASSES,
  type Candidate,
  type CandidateStatus,
} from "@/lib/candidates/types";
import { candidateError } from "@/lib/candidates/errors";
import { updateCandidate } from "../actions";
import { StatusBadge } from "./fields";

export type CandidateStatusUpdate = {
  id: string;
  revision: number;
  status: CandidateStatus;
};
export function CandidateStatusCell({
  candidate,
  onSaved,
  onRefresh,
  disabled = false,
}: {
  candidate: Candidate;
  onSaved: (saved: CandidateStatusUpdate) => void;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState<CandidateStatus | null>(null);
  const status = pending ?? candidate.status;
  const save = async (next: CandidateStatus) => {
    setOpen(false);
    if (next === candidate.status) return;
    setPending(next);
    try {
      const saved = await updateCandidate(candidate.id, {
        revision: candidate.revision,
        status: next,
      });
      onSaved(saved);
    } catch (e) {
      toast.error(candidateError(e, "Не удалось изменить статус."));
      onRefresh();
    } finally {
      setPending(null);
    }
  };
  if (candidate.status === "hired" || disabled)
    return (
      <StatusBadge
        label={STATUSES[status]}
        className={STATUS_CLASSES[status]}
      />
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Изменить статус: ${candidate.full_name}`}
          title={STATUSES[status]}
          disabled={!!pending}
          className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full text-left outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-wait"
        >
          <StatusBadge
            label={STATUSES[status]}
            className={STATUS_CLASSES[status]}
          />
          {pending ? (
            <Loader2 className="size-3 shrink-0 motion-safe:animate-spin" />
          ) : (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <div className="space-y-0.5" aria-label="Изменить этап кандидата">
          {Object.entries(CANDIDATE_STAGES).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              onClick={() => void save(value as CandidateStatus)}
            >
              <StatusBadge
                label={label}
                className={STATUS_CLASSES[value as CandidateStatus]}
              />
              {value === candidate.status ? (
                <Check className="size-3.5 text-muted-foreground" />
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
