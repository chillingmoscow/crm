"use client";
import { useEffect, useState } from "react";
import { ArrowLeftRight, Check, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ToolbarCountButton } from "./toolbar-count-button";
import { DrawerAvatar, DrawerSection, DrawerSummaryItem } from "@/components/ui/drawer-blocks";
import { cn } from "@/lib/utils";
import { dateInZone, dayLabel, timeInZone } from "@/lib/schedule/utils";
import type { ScheduleData, Shift } from "@/lib/schedule/types";
import {
  swapActions,
  swapAnswerLabel,
  swapDisplayStatus,
  swapStatusLabel,
  type ShiftSwap,
  type SwapDisplayStatus,
} from "@/lib/schedule/shift-swaps";
import { loadSwapCandidates, swapCommand, type SwapCandidate, type SwapCommandInput } from "../actions";
import { unwrapAction } from "@/lib/actions/result";

const statusTone: Record<SwapDisplayStatus, StatusTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
  voided: "neutral",
  expired: "neutral",
};
const answerTone = (answer: ShiftSwap["candidate_answer"]): StatusTone =>
  answer === "accepted" ? "success" : answer === "declined" ? "danger" : "neutral";

/** Последняя заявка по смене: открытая важнее решённых. */
export function shiftSwap(swaps: ShiftSwap[], shiftId: string) {
  const own = swaps.filter((s) => s.shift_id === shiftId);
  return own.find((s) => s.status === "pending") ?? own[0] ?? null;
}

function personLabel(data: ScheduleData, id: string | null) {
  const person = data.staff.find((s) => s.user_id === id);
  const name = person ? [person.first_name, person.last_name].filter(Boolean).join(" ") || person.role_name : "Сотрудник";
  return { name: id === data.userId ? `${name} (вы)` : name, avatar: person?.avatar_url ?? null };
}

function shiftSpan(data: ScheduleData, shift: Pick<Shift, "starts_at" | "ends_at">) {
  return `${dayLabel(dateInZone(shift.starts_at, data.timezone), { day: "numeric", month: "short" })}, ${timeInZone(shift.starts_at, data.timezone)}–${timeInZone(shift.ends_at, data.timezone)}`;
}

/** Выполнить действие по заявке: ошибка — тостом, успех — обновить расписание. */
export async function runSwap(input: SwapCommandInput, success: string, refresh: () => Promise<unknown>) {
  const result = await swapCommand(input);
  if (result.error) {
    toast.error(result.error);
    return false;
  }
  toast.success(success);
  await refresh().catch(() => {});
  return true;
}

/** Раздел «Замена» в панели просмотра смены. */
export function SwapSection({ data, swap, shift }: { data: ScheduleData; swap: ShiftSwap; shift: Shift }) {
  const status = swapDisplayStatus(swap, shift, Date.now());
  const from = personLabel(data, swap.from_user_id);
  const to = personLabel(data, swap.to_user_id);
  const decider = swap.decided_by ? personLabel(data, swap.decided_by).name : null;
  return (
    <DrawerSection
      title="Замена"
      description={
        status === "pending"
          ? "Ответ коллеги необязателен: управляющий решает в любой момент"
          : undefined
      }
      actions={<StatusBadge tone={statusTone[status]}>{swapStatusLabel[status]}</StatusBadge>}
    >
      {/* Сводка в панели одна — у смены; здесь строки без своей рамки. */}
      <dl aria-label="Заявка на замену" className="grid gap-3">
        <DrawerSummaryItem avatar icon={<DrawerAvatar name={from.name} src={from.avatar} />} label="Предлагает замену">
          {from.name}
        </DrawerSummaryItem>
        <DrawerSummaryItem avatar icon={<DrawerAvatar name={to.name} src={to.avatar} />} label="Выйдет вместо">
          <span className="flex flex-wrap items-center gap-2">
            {to.name}
            <StatusBadge tone={answerTone(swap.candidate_answer)}>
              {swapAnswerLabel(swap.candidate_answer)}
            </StatusBadge>
          </span>
        </DrawerSummaryItem>
        {swap.comment && (
          <DrawerSummaryItem icon={<MessageSquare />} label="Комментарий">
            <span className="whitespace-pre-wrap">{swap.comment}</span>
          </DrawerSummaryItem>
        )}
        {decider && (status === "approved" || status === "rejected") && (
          <DrawerSummaryItem icon={<Check />} label={status === "approved" ? "Утвердил(а)" : "Отклонил(а)"}>
            {decider}
            {swap.decision_comment && (
              <span className="block whitespace-pre-wrap text-muted-foreground">{swap.decision_comment}</span>
            )}
          </DrawerSummaryItem>
        )}
      </dl>
    </DrawerSection>
  );
}

/**
 * Кнопки подвала панели смены для заявки. Главная (`default`) — одна:
 * у управляющего «Утвердить замену», у коллеги «Согласиться», у автора
 * «Найти замену».
 */
export function SwapFooterActions({
  data,
  shift,
  swap,
  canRequest,
  onRequest,
  refresh,
  onDone,
}: {
  data: ScheduleData;
  shift: Shift;
  swap: ShiftSwap | null;
  canRequest: boolean;
  onRequest: () => void;
  refresh: () => Promise<unknown>;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"cancel" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const actions = swap
    ? swapActions(swap, shift, { userId: data.userId, canDecide: data.permissions.includes("schedule.shift_assign") }, Date.now())
    : [];
  const run = async (input: SwapCommandInput, success: string, close = false) => {
    setBusy(true);
    try {
      const ok = await runSwap(input, success, refresh);
      if (ok) {
        setConfirm(null);
        if (close) onDone();
      }
    } finally {
      setBusy(false);
    }
  };
  if (!swap || actions.length === 0)
    return canRequest ? (
      <Button variant="outline" onClick={onRequest}>
        <ArrowLeftRight />
        Найти замену
      </Button>
    ) : null;
  const to = personLabel(data, swap.to_user_id).name;
  const from = personLabel(data, swap.from_user_id).name;
  return (
    <>
      {actions.includes("cancel") && (
        <Button variant="outline" disabled={busy} onClick={() => setConfirm("cancel")}>
          Отозвать заявку
        </Button>
      )}
      {actions.includes("respond") && !actions.includes("approve") && (
        <>
          {swap.candidate_answer !== "declined" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run({ action: "respond", id: swap.id, version: swap.version, answer: "declined" }, "Ответ отправлен")}
            >
              Не могу
            </Button>
          )}
          {swap.candidate_answer !== "accepted" && (
            <Button
              disabled={busy}
              onClick={() => void run({ action: "respond", id: swap.id, version: swap.version, answer: "accepted" }, "Ответ отправлен")}
            >
              Согласиться
            </Button>
          )}
        </>
      )}
      {actions.includes("approve") && (
        <>
          <Button variant="outline" disabled={busy} onClick={() => setConfirm("reject")}>
            Отклонить
          </Button>
          <Button
            disabled={busy}
            onClick={() => void run({ action: "approve", id: swap.id, version: swap.version }, `Смена передана: ${to}`, true)}
          >
            Утвердить замену
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Отозвать заявку на замену?"
        description={`Смена останется за вами. ${to} получит уведомление, что замена не нужна.`}
        confirmLabel="Отозвать заявку"
        busy={busy}
        onConfirm={() => void run({ action: "cancel", id: swap.id, version: swap.version }, "Заявка отозвана")}
      />
      <ConfirmDialog
        open={confirm === "reject"}
        onOpenChange={(open) => {
          if (!open) {
            setConfirm(null);
            setReason("");
          }
        }}
        title="Отклонить замену?"
        description={`Смена останется за ${from}. Оба получат уведомление.`}
        confirmLabel="Отклонить замену"
        destructive
        busy={busy}
        onConfirm={() =>
          void run({ action: "reject", id: swap.id, version: swap.version, comment: reason }, "Замена отклонена")
        }
      >
        <Field label="Причина" hint="Необязательно. Увидят оба сотрудника">
          {(control) => (
            <Textarea {...control} value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>
      </ConfirmDialog>
    </>
  );
}

/** Панель «Замена смены»: автор выбирает коллегу из подходящих и свободных. */
export function SwapRequestDrawer({
  data,
  shift,
  onClose,
  refresh,
}: {
  data: ScheduleData;
  shift: Shift;
  onClose: () => void;
  refresh: () => Promise<unknown>;
}) {
  const [candidates, setCandidates] = useState<SwapCandidate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    setCandidates(null);
    loadSwapCandidates(shift.id)
      .then(unwrapAction)
      .then((list) => alive && setCandidates(list))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [shift.id, attempt]);
  const role = data.roles.find((r) => r.id === shift.role_id)?.name;
  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const name = candidates?.find((c) => c.user_id === picked)?.name ?? "коллега";
      if (await runSwap({ action: "request", shift_id: shift.id, to_user_id: picked, comment }, `Заявка отправлена: ${name} и управляющий получат уведомление`, refresh))
        onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditDrawer
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title="Замена смены"
      description={[shiftSpan(data, shift), shift.title].join(" · ")}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy || !picked} onClick={() => void submit()}>
            Отправить заявку
          </Button>
        </>
      }
    >
      <DrawerSection
        title="Кто выйдет вместо вас"
        description={`${role ? `Должность «${role}» или допуск на неё` : "Любой сотрудник заведения"}, без другой смены в этот день`}
      >
        {failed ? (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-destructive">Не удалось подобрать замену</span>
            <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Повторить
            </Button>
          </div>
        ) : candidates === null ? (
          <div className="space-y-2" aria-label="Загрузка списка">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            ))}
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Свободных коллег с допуском на эту позицию нет</p>
        ) : (
          <div role="radiogroup" aria-label="Кто выйдет вместо вас" className="space-y-1">
            {candidates.map((c) => (
              <button
                key={c.user_id}
                type="button"
                role="radio"
                aria-checked={picked === c.user_id}
                aria-label={`${c.name}, ${c.role_name}`}
                onClick={() => setPicked(c.user_id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  picked === c.user_id ? "border-brand/30 bg-brand/5 dark:border-brand/40 dark:bg-brand/10" : "border-transparent",
                )}
              >
                <DrawerAvatar name={c.name} src={c.avatar_url} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.role_name}</span>
                </span>
                {picked === c.user_id && <Check className="size-4 shrink-0 text-brand" />}
              </button>
            ))}
          </div>
        )}
      </DrawerSection>
      <DrawerSection title="Комментарий">
        <Field label="Для коллеги и управляющего" hint="Необязательно">
          {(control) => (
            <Textarea {...control} value={comment} maxLength={500} rows={3} onChange={(e) => setComment(e.target.value)} />
          )}
        </Field>
      </DrawerSection>
    </EditDrawer>
  );
}

/** Заявки на замену в ряду инструментов расписания: иконка со счётчиком, открытые заявки за все дни. */
export function SwapRequestsButton({
  data,
  onOpen,
}: {
  data: ScheduleData;
  onOpen: (shift: Shift) => void;
}) {
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const pending = data.swaps
    .map((swap) => ({ swap, shift: data.shifts.find((s) => s.id === swap.shift_id) }))
    .filter(
      (entry): entry is { swap: ShiftSwap; shift: Shift } =>
        !!entry.shift && swapDisplayStatus(entry.swap, entry.shift, now) === "pending",
    )
    .sort((a, b) => a.shift.starts_at.localeCompare(b.shift.starts_at));
  if (pending.length === 0) return null;
  return (
    <ToolbarCountButton
      icon={<ArrowLeftRight />}
      count={pending.length}
      label="Заявки на замену"
      open={open}
      onOpenChange={setOpen}
    >
        <p className="mb-1 text-sm font-semibold">Заявки на замену</p>
        <p className="mb-3 text-[13px] text-muted-foreground">Ждут решения, за все дни</p>
        <div className="space-y-1">
          {pending.map(({ swap, shift }) => {
            const from = personLabel(data, swap.from_user_id);
            const to = personLabel(data, swap.to_user_id);
            return (
              <button
                key={swap.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpen(shift);
                }}
                className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <DrawerAvatar name={to.name} src={to.avatar} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {from.name} → {to.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {shiftSpan(data, shift)} · {shift.title}
                  </span>
                </span>
                <StatusBadge tone={answerTone(swap.candidate_answer)}>{swapAnswerLabel(swap.candidate_answer)}</StatusBadge>
              </button>
            );
          })}
        </div>
    </ToolbarCountButton>
  );
}
