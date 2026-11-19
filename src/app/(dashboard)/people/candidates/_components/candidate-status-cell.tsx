"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CANDIDATE_STAGES,
  STATUSES,
  STATUS_TONES,
  type Candidate,
  type CandidateStatus,
  type Appointment,
  type AppointmentOptions,
} from "@/lib/candidates/types";
import { candidateError } from "@/lib/candidates/errors";
import { updateCandidate } from "../actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { CandidateStatusAppointment } from "./candidate-status-appointment";

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
  options,
}: {
  candidate: Candidate;
  onSaved: (saved: CandidateStatusUpdate) => void;
  onRefresh: () => void;
  disabled?: boolean;
  options: AppointmentOptions;
}) {
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState<CandidateStatus | null>(null),
    [appointmentKind, setAppointmentKind] = useState<Appointment["kind"] | null>(null);
  const status = pending ?? candidate.status;
  const save = async (next: CandidateStatus) => {
    setOpen(false);
    if (next === "interview" || next === "trial") {
      setAppointmentKind(next);
      return;
    }
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
      <StatusBadge tone={STATUS_TONES[status]}>{STATUSES[status]}</StatusBadge>
    );
  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Изменить статус: ${candidate.full_name}`}
          data-tip={STATUSES[status]}
          disabled={!!pending}
          aria-busy={!!pending}
          className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full text-left outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-default"
        >
          <StatusBadge tone={STATUS_TONES[status]} className="min-w-0">
            {STATUSES[status]}
          </StatusBadge>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <div className="space-y-0.5" aria-label="Изменить этап кандидата">
          {Object.entries(CANDIDATE_STAGES).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              onClick={() => void save(value as CandidateStatus)}
            >
              <StatusBadge tone={STATUS_TONES[value as CandidateStatus]}>
                {label}
              </StatusBadge>
              {value === candidate.status ? (
                <Check className="size-3.5 text-muted-foreground" />
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
    {appointmentKind && (
      <CandidateStatusAppointment candidate={candidate} kind={appointmentKind} options={options}
        onClose={() => setAppointmentKind(null)} onSaved={onSaved} />
    )}
    </>
  );
}
