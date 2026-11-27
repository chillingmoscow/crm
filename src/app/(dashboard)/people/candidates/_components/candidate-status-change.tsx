"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useExitValue } from "@/hooks/use-exit-value";
import type {
  Appointment,
  AppointmentOptions,
  Candidate,
  CandidateStatus,
} from "@/lib/candidates/types";
import { candidateError } from "@/lib/candidates/errors";
import { unwrapAction } from "@/lib/actions/result";
import { updateCandidate } from "../actions";
import { CandidateStatusAppointment } from "./candidate-status-appointment";

export type CandidateStatusUpdate = {
  id: string;
  revision: number;
  status: CandidateStatus;
};

/**
 * Смена этапа кандидата — одна для меню статуса в таблице и для переноса
 * карточки на доске. «Собеседование» и «Стажировка» открывают панель записи
 * на встречу (этап меняется вместе с ней), остальные этапы сохраняются
 * сразу тем же действием `updateCandidate`: права и журнал проверяет и
 * пишет база (`candidate_command`). «Принят на работу» отсюда не ставится —
 * только через оформление (`HireDrawer`).
 */
export function useCandidateStatusChange({
  options,
  onSaved,
  onRefresh,
}: {
  options: AppointmentOptions;
  onSaved: (saved: CandidateStatusUpdate) => void;
  onRefresh: () => void;
}): {
  change: (candidate: Candidate, next: CandidateStatus) => Promise<void>;
  /** Анкеты, этап которых сейчас сохраняется: id → новый статус. */
  pending: ReadonlyMap<string, CandidateStatus>;
  /** Панель записи на собеседование или стажировку. */
  panel: ReactNode;
} {
  // Несколько анкет могут сохраняться одновременно (на доске перенесли
  // вторую, пока сохраняется первая) — каждая занята до своего ответа.
  const [pending, setPending] = useState<ReadonlyMap<string, CandidateStatus>>(
    () => new Map(),
  );
  const [appointment, setAppointment] = useState<{
    candidate: Candidate;
    kind: Appointment["kind"];
  } | null>(null);
  // Панель держим смонтированной, пока она уезжает (docs/motion.md).
  const shown = useExitValue(appointment);
  const change = async (candidate: Candidate, next: CandidateStatus) => {
    if (next === "interview" || next === "trial") {
      setAppointment({ candidate, kind: next });
      return;
    }
    if (next === candidate.status || next === "hired" || pending.has(candidate.id)) return;
    setPending((current) => new Map(current).set(candidate.id, next));
    try {
      const saved = unwrapAction(
        await updateCandidate(candidate.id, {
          revision: candidate.revision,
          status: next,
        }),
      );
      onSaved(saved);
    } catch (e) {
      toast.error(candidateError(e, "Не удалось изменить статус."));
      onRefresh();
    } finally {
      setPending((current) => {
        const rest = new Map(current);
        rest.delete(candidate.id);
        return rest;
      });
    }
  };
  const panel = shown ? (
    <CandidateStatusAppointment
      key={`${shown.candidate.id}:${shown.kind}`}
      open={!!appointment}
      candidate={shown.candidate}
      kind={shown.kind}
      options={options}
      onClose={() => setAppointment(null)}
      onSaved={onSaved}
    />
  ) : null;
  return { change, pending, panel };
}
