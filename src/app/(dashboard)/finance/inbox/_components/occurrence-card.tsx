"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Banknote, CalendarClock, Loader2, SkipForward } from "lucide-react";
import { ru } from "date-fns/locale/ru";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { AmountInput } from "@/components/finance/amount-input";
import { CategoryPicker } from "@/components/finance/category-picker";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { postOccurrence, postponeOccurrence, skipOccurrence } from "@/lib/finance/recurring";
import { overdueDays } from "@/lib/finance/recurring-schedule";
import { formatAmount, type AmountRoundingScale } from "@/lib/format/amount";
import type { AccountVenueRow } from "@/lib/org/legal-entities";
import type { FinanceCategoryRow, RecurringOccurrenceRow } from "@/types/finance";

import { withSelected } from "../../transactions/_components/fields/with-selected";

/** Правки карточки, которые переживают переход стрелками к соседнему платежу. */
export type OccurrenceDraft = {
  amount: number | null;
  date: string;
  category_id: string | null;
  venue_id: string | null;
  description: string;
};

export type OccurrenceResolution =
  | { kind: "posted"; transactionId: string }
  | { kind: "skipped" }
  | { kind: "postponed"; to: string }
  /** Платёж уже разобрал кто-то другой: карточку убираем без ошибки. */
  | { kind: "gone" };

const NETWORK_ERROR = "Нет связи с сервером. Проверьте соединение и повторите";

/** Начальные значения карточки: снимок шаблона, дата проведения — сегодня. */
export function initialDraft(occurrence: RecurringOccurrenceRow, today: string): OccurrenceDraft {
  return {
    // Меняющуюся сумму вводят заново: снимок остаётся подсказкой.
    amount: occurrence.amount_varies ? null : Number(occurrence.amount),
    date: today,
    category_id: occurrence.category_id,
    venue_id: occurrence.venue_id,
    description: occurrence.description ?? "",
  };
}

type Props = {
  occurrence: RecurringOccurrenceRow;
  draft: OccurrenceDraft;
  onDraftChange: (patch: Partial<OccurrenceDraft>) => void;
  /** Платёж разобран: очередь показывает следующий. */
  onResolved: (result: OccurrenceResolution) => void;
  accountName: string | null;
  /** Валюта счёта: в ней платёж и проводится. */
  currency: string;
  counterpartyName: string | null;
  /** Все статьи, включая архивные: в выборе — действующие и уже стоящая. */
  categories: FinanceCategoryRow[];
  /** Заведения, которые можно выбрать (без view_all_venues — только активное). */
  venues: AccountVenueRow[];
  /** Все заведения — для подписи уже выбранного. */
  allVenues: AccountVenueRow[];
  canResolve: boolean;
  amountRoundingScale: AmountRoundingScale;
  /** Сегодня `YYYY-MM-DD` в поясе аккаунта. */
  today: string;
};

type Busy = "post" | "skip" | "postpone" | null;

/**
 * Карточка ожидаемого платежа в очереди «На разбор»: название и факты одной
 * строкой (тип, срок, просрочка, счёт, контрагент), поля проведения из
 * снимка шаблона и три решения — провести, пропустить этот раз, перенести.
 */
export function OccurrenceCard({
  occurrence,
  draft,
  onDraftChange,
  onResolved,
  accountName,
  currency,
  counterpartyName,
  categories,
  venues,
  allVenues,
  canResolve,
  amountRoundingScale,
  today,
}: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ amount?: string; date?: string }>({});
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [postponeOpen, setPostponeOpen] = useState(false);

  const locked = !canResolve || busy !== null;
  const overdue = overdueDays(occurrence.due_date, today);
  const typeLabel = occurrence.type === "income" ? "Доход" : "Расход";
  const hintAmount = formatAmount(Number(occurrence.amount), amountRoundingScale);

  // Факты одной строкой: «Расход · срок 05.12 · просрочено 2 дн. · Т-Банк · ООО «Арендодатель»».
  const meta: ReactNode[] = [
    typeLabel,
    `срок ${formatDue(occurrence.due_date, today)}`,
    overdue > 0 ? (
      <span className="font-medium text-destructive">просрочено {overdue} дн.</span>
    ) : null,
    accountName ?? "Счёт недоступен",
    counterpartyName,
  ].filter(Boolean);

  // Выбранное заведение остаётся в списке, даже если его нельзя выбрать заново.
  const venueChoices = useMemo(() => {
    const current = allVenues.find((v) => v.id === draft.venue_id);
    return current && !venues.some((v) => v.id === current.id) ? [...venues, current] : venues;
  }, [allVenues, draft.venue_id, venues]);

  const tomorrow = useMemo(() => localDay(addDays(today, 1)), [today]);

  const patch = (next: Partial<OccurrenceDraft>) => {
    onDraftChange(next);
    setError(null);
    setErrors((e) => ({
      ...e,
      ...("amount" in next ? { amount: undefined } : {}),
      ...("date" in next ? { date: undefined } : {}),
    }));
  };

  const post = async () => {
    if (locked) return;
    const found: typeof errors = {};
    if (draft.amount === null || !(draft.amount > 0)) found.amount = "Укажите сумму больше нуля";
    if (!draft.date) found.date = "Укажите дату";
    setErrors(found);
    if (found.amount || found.date) return;

    setBusy("post");
    setError(null);
    try {
      const { transactionId, error: postError, gone } = await postOccurrence(occurrence.id, {
        amount: draft.amount as number,
        date: draft.date,
        bank_account_id: occurrence.bank_account_id,
        category_id: draft.category_id,
        counterparty_id: occurrence.counterparty_id,
        venue_id: draft.venue_id,
        description: draft.description.trim() || null,
      });
      if (gone) {
        onResolved({ kind: "gone" });
        return;
      }
      if (postError || !transactionId) {
        setError(postError ?? "Не удалось провести платёж");
        return;
      }
      onResolved({ kind: "posted", transactionId });
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(null);
    }
  };

  const skip = async () => {
    setBusy("skip");
    setError(null);
    try {
      const { error: skipError, gone } = await skipOccurrence(occurrence.id);
      if (gone) {
        setConfirmSkip(false);
        onResolved({ kind: "gone" });
        return;
      }
      if (skipError) {
        setError(skipError);
        return;
      }
      setConfirmSkip(false);
      onResolved({ kind: "skipped" });
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(null);
    }
  };

  const postpone = async (to: string) => {
    setPostponeOpen(false);
    setBusy("postpone");
    setError(null);
    try {
      const { error: postponeError, gone } = await postponeOccurrence(occurrence.id, to);
      if (gone) {
        onResolved({ kind: "gone" });
        return;
      }
      if (postponeError) {
        setError(postponeError);
        return;
      }
      onResolved({ kind: "postponed", to });
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-label={`Платёж «${occurrence.name}»`}
      className="min-w-0 max-w-[720px] space-y-6 rounded-lg border bg-card p-4 sm:p-6"
    >
      <div className="min-w-0 space-y-1">
        <h2 className="break-words text-xl font-semibold tracking-normal">{occurrence.name}</h2>
        <p className="text-[13px] text-muted-foreground">
          {meta.map((part, i) => (
            <span key={i}>
              {i > 0 ? " · " : null}
              {part}
            </span>
          ))}
        </p>
      </div>

      {!canResolve ? (
        <p
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
        >
          Разбирать платежи может сотрудник с правом создавать операции
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Сумма"
          required
          error={errors.amount}
          hint={occurrence.amount_varies ? "Сумма меняется: укажите точную" : undefined}
        >
          {(control) => (
            <AmountInput
              {...control}
              value={draft.amount}
              onChange={(amount) => patch({ amount })}
              currency={currency}
              placeholder={occurrence.amount_varies ? `~${hintAmount}` : "0"}
              inputClassName="text-xl font-semibold md:text-xl"
              disabled={locked}
            />
          )}
        </Field>
        <Field label="Дата проведения" required error={errors.date}>
          {(control) => (
            <DatePicker
              {...control}
              value={draft.date}
              onChange={(date) => patch({ date })}
              placeholder="Выберите дату"
              clearable={false}
              readOnly={!canResolve}
              disabled={busy !== null}
            />
          )}
        </Field>
        <Field label="Статья">
          {() => (
            <CategoryPicker
              categories={withSelected(categories, draft.category_id)}
              value={draft.category_id}
              onChange={(category_id) => patch({ category_id })}
              type={occurrence.type === "income" ? "income" : "expense"}
              placeholder="Без статьи"
              allowClear
              ariaLabel="Статья"
              disabled={locked}
            />
          )}
        </Field>
        {allVenues.length > 0 ? (
          <Field label="Заведение">
            {(control) => (
              <OptionSelect
                {...control}
                value={draft.venue_id ?? ""}
                onValueChange={(v) => patch({ venue_id: v || null })}
                options={[
                  { value: "", label: "Без заведения" },
                  ...venueChoices.map((v) => ({ value: v.id, label: v.name })),
                ]}
                disabled={locked}
              />
            )}
          </Field>
        ) : null}
        <div className="sm:col-span-2">
          <Field label="Описание">
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="Например: аренда за декабрь"
                readOnly={!canResolve || busy !== null}
              />
            )}
          </Field>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          {error}
        </p>
      ) : null}

      {canResolve ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void post()} disabled={busy !== null} className="min-w-32">
            {busy === "post" ? <Loader2 className="size-4 animate-spin" /> : <Banknote className="size-4" />}
            {busy === "post" ? "Проводим…" : "Провести"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setError(null);
              setConfirmSkip(true);
            }}
            disabled={busy !== null}
          >
            {busy === "skip" ? "Пропускаем…" : "Пропустить этот раз"}
          </Button>
          <Popover open={postponeOpen} onOpenChange={setPostponeOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" disabled={busy !== null} className="min-w-32">
                <CalendarClock className="size-4" aria-hidden />
                {busy === "postpone" ? "Переносим…" : "Перенести"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto max-w-[calc(100vw-24px)] p-0">
              <p className="px-3 pt-3 text-[13px] text-muted-foreground">
                До какого дня отложить платёж
              </p>
              <Calendar
                locale={ru}
                mode="single"
                weekStartsOn={1}
                defaultMonth={tomorrow}
                disabled={{ before: tomorrow }}
                onSelect={(day) => {
                  if (day) void postpone(isoDay(day));
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      <ConfirmDialog
        icon={SkipForward}
        open={confirmSkip}
        onOpenChange={(open) => {
          if (!open && busy !== "skip") setConfirmSkip(false);
        }}
        title={`Пропустить платёж «${occurrence.name}»?`}
        consequences={[
          { kind: "remove", text: `Платёж за ${formatDue(occurrence.due_date, today)} уйдёт из очереди, операция не появится` },
          { kind: "keep", text: "Следующий платёж придёт в свой срок" },
        ]}
        destructive
        confirmLabel="Пропустить платёж"
        pendingLabel="Пропускаем…"
        busy={busy === "skip"}
        error={confirmSkip ? error : null}
        onConfirm={() => void skip()}
      />
    </section>
  );
}

// ─── Даты ───────────────────────────────────────────────────────────────────

/** Срок `05.12`; год дописывается, только если он не текущий. */
function formatDue(due: string, today: string): string {
  const [y, m, d] = due.split("-");
  return y === today.slice(0, 4) ? `${d}.${m}` : `${d}.${m}.${y}`;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Календарный день `YYYY-MM-DD` как локальная полночь — для календаря. */
function localDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isoDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}
