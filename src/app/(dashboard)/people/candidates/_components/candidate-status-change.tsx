"use client";

import { UserX } from "lucide-react";
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
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { rejectCandidate, updateCandidate } from "../actions";
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
 * пишет база (`candidate_command`). «Не подходит» — только с комментарием
 * о причине (окно ниже, база без него этап не меняет). «Принят на работу» отсюда не ставится —
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
  const [reject, setReject] = useState<{ candidate: Candidate; key: string } | null>(null);
  const shownReject = useExitValue(reject);
  const [reason, setReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  const release = (id: string) =>
    setPending((current) => {
      const rest = new Map(current);
      rest.delete(id);
      return rest;
    });
  const change = async (candidate: Candidate, next: CandidateStatus) => {
    if (next === "interview" || next === "trial") {
      setAppointment({ candidate, kind: next });
      return;
    }
    if (next === candidate.status || next === "hired" || pending.has(candidate.id)) return;
    if (next === "rejected") {
      setReason("");
      setRejectError(null);
      setReject({ candidate, key: crypto.randomUUID() });
      return;
    }
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
      release(candidate.id);
    }
  };
  const confirmReject = async () => {
    if (!reject || !reason.trim()) return;
    const { candidate, key } = reject;
    setRejectError(null);
    setPending((current) => new Map(current).set(candidate.id, "rejected"));
    try {
      const saved = unwrapAction(
        await rejectCandidate(candidate.id, candidate.revision, reason, key),
      );
      setReject(null);
      onSaved(saved);
    } catch (e) {
      const message = candidateError(e, "Не удалось перевести кандидата в «Не подходит».");
      // Анкету поменяли параллельно: повтор со старой ревизией не пройдёт —
      // закрываем окно, список обновится, этап можно выбрать снова.
      if (message.includes("Анкета изменена")) {
        setReject(null);
        toast.error(message);
      } else setRejectError(message);
      onRefresh();
    } finally {
      release(candidate.id);
    }
  };
  const rejecting = !!shownReject && pending.has(shownReject.candidate.id);
  const panel = (
    <>
      {shown ? (
        <CandidateStatusAppointment
          key={`${shown.candidate.id}:${shown.kind}`}
          open={!!appointment}
          candidate={shown.candidate}
          kind={shown.kind}
          options={options}
          onClose={() => setAppointment(null)}
          onSaved={onSaved}
        />
      ) : null}
      {shownReject ? (
        <ConfirmDialog
          tone="warning"
          icon={UserX}
          open={!!reject}
          onOpenChange={(open) => {
            if (!open) setReject(null);
          }}
          title={`${shownReject.candidate.full_name} не подходит?`}
          description="Кандидат перейдёт на этап «Не подходит». Причина останется в комментариях к анкете."
          confirmLabel="Перевести в «Не подходит»"
          pendingLabel="Сохраняем…"
          busy={rejecting}
          confirmDisabled={!reason.trim()}
          error={rejectError}
          onConfirm={() => void confirmReject()}
        >
          <Field label="Почему не подходит" required>
            {(control) => (
              <Textarea
                {...control}
                value={reason}
                rows={4}
                maxLength={12000}
                placeholder="Например: нет опыта, не устроил график, не пришёл на стажировку"
                disabled={rejecting}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        </ConfirmDialog>
      ) : null}
    </>
  );
  return { change, pending, panel };
}
