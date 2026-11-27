"use client";

import { useState } from "react";
import Link from "next/link";
import { Banknote, Loader2, SkipForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { AmountInput } from "@/components/finance/amount-input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { resolveOfficialMonth, skipOfficialMonth } from "@/lib/finance/official-inbox";
import { officialTaxOf } from "@/lib/payroll/official-payment";
import {
  officialMonthName,
  officialPayDate,
  officialResolvePayload,
  officialReviewCopy,
  withOfficialGross,
  withOfficialNet,
  type OfficialDraftErrors,
  type OfficialReviewDraft,
  type OfficialReviewItem,
} from "@/lib/payroll/official-review";
import type { PayrollData } from "@/lib/payroll/types";

export type OfficialResolution =
  | { kind: "posted"; paymentId: string | null }
  | { kind: "skipped" }
  /** Карточку уже разобрал кто-то другой: убираем без ошибки. */
  | { kind: "gone" };

const NETWORK_ERROR = "Нет связи с сервером. Проверьте соединение и повторите";

type Props = {
  item: OfficialReviewItem;
  draft: OfficialReviewDraft;
  onDraftChange: (next: OfficialReviewDraft) => void;
  onResolved: (result: OfficialResolution) => void;
  /** Расчётные счета в рублях, доступные заведению. */
  banks: PayrollData["banks"];
  payDay: number;
  /** Права на выплаты зарплаты и на операции в финансах. */
  canResolve: boolean;
  /** Сегодня `YYYY-MM-DD` в поясе аккаунта. */
  today: string;
};

type Busy = "post" | "skip" | null;

/**
 * Карточка официальной части в «На разбор»: месяц, который не провёлся сам
 * (окончательный расчёт, нет счёта или статьи, сотрудник уволен без даты
 * официального увольнения, прошлый месяц, который крон не провёл). Поля: на руки, оклад с налогом (досчитывается
 * от суммы на руки), расчётный счёт, дата; решения: провести или пропустить.
 * Оформление «Платит агентство» — одна сумма «Получено через агентство» и
 * дата: без счёта и налога.
 */
export function OfficialMonthCard({ item, draft, onDraftChange, onResolved, banks, payDay, canResolve, today }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<OfficialDraftErrors>({});
  const [confirmSkip, setConfirmSkip] = useState(false);

  const locked = !canResolve || busy !== null;
  const copy = officialReviewCopy(item, today);
  const month = officialMonthName(item.month, today);
  const tax = officialTaxOf(draft.net, draft.gross);
  const agency = item.agency;

  const patch = (next: OfficialReviewDraft, field: keyof OfficialDraftErrors) => {
    onDraftChange(next);
    setError(null);
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const post = async () => {
    if (locked) return;
    const { input, errors: found } = officialResolvePayload(item, draft);
    if (!input) {
      setErrors(found);
      return;
    }
    setErrors({});
    setBusy("post");
    setError(null);
    try {
      const result = await resolveOfficialMonth(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onResolved(result.data.gone ? { kind: "gone" } : { kind: "posted", paymentId: result.data.paymentId });
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
      const result = await skipOfficialMonth(item.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmSkip(false);
      onResolved(result.data.gone ? { kind: "gone" } : { kind: "skipped" });
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(null);
    }
  };

  const bankOptions = banks.map((b) => ({ value: b.id, label: b.name }));

  return (
    <section
      aria-label={copy.title}
      className="min-w-0 max-w-[720px] space-y-6 rounded-lg border bg-card p-4 sm:p-6"
    >
      <div className="min-w-0 space-y-1">
        <h2 className="break-words text-xl font-semibold tracking-normal">{copy.title}</h2>
        <p className="text-[13px] text-muted-foreground">
          {agency ? "Через агентство" : "Официальная часть"} · срок {formatDue(officialPayDate(item.month, payDay), today)}
        </p>
        <p className="pt-1 text-sm text-muted-foreground">{copy.hint}</p>
      </div>

      {!canResolve ? (
        <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          Разбирать официальные выплаты может сотрудник с правами на выплаты зарплаты и операции в финансах
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={agency ? "Получено через агентство" : "На руки"} required error={errors.amount}>
          {(control) => (
            <AmountInput
              {...control}
              value={draft.net}
              onChange={(net) => patch(agency ? { ...draft, net, gross: net } : withOfficialNet(draft, net), "amount")}
              currency="RUB"
              placeholder="0"
              inputClassName="text-xl font-semibold md:text-xl"
              disabled={locked}
            />
          )}
        </Field>
        {!agency && (
          <>
            <Field
              label="Оклад с налогом"
              required
              hint={
                tax !== null && tax >= 0 ? (
                  <>
                    НДФЛ <Money value={tax} fraction="auto" />
                  </>
                ) : (
                  "Посчитается от суммы на руки"
                )
              }
            >
              {(control) => (
                <AmountInput
                  {...control}
                  value={draft.gross}
                  onChange={(gross) => patch(withOfficialGross(draft, gross), "amount")}
                  currency="RUB"
                  placeholder="0"
                  disabled={locked}
                />
              )}
            </Field>
            <Field
              label="Расчётный счёт"
              required
              error={errors.bank}
              hint={banks.length === 0 ? "Нет активных расчётных счетов в рублях" : undefined}
            >
              {(control) => (
                <OptionSelect
                  {...control}
                  value={draft.bank_account_id}
                  onValueChange={(bank_account_id) => patch({ ...draft, bank_account_id }, "bank")}
                  options={bankOptions}
                  placeholder="Выберите счёт"
                  disabled={locked || banks.length === 0}
                />
              )}
            </Field>
          </>
        )}
        <Field label="Дата выплаты" required error={errors.date}>
          {(control) => (
            <DatePicker
              {...control}
              value={draft.date}
              onChange={(date) => patch({ ...draft, date }, "date")}
              placeholder="Выберите дату"
              clearable={false}
              readOnly={!canResolve}
              disabled={busy !== null}
            />
          )}
        </Field>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canResolve ? (
          <>
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
              {busy === "skip" ? "Пропускаем…" : "Пропустить"}
            </Button>
          </>
        ) : null}
        {item.reason === "inactive" && item.employee_user_id ? (
          <Button asChild variant="outline">
            <Link href={`/people/staff/${item.employee_user_id}`}>Открыть карточку сотрудника</Link>
          </Button>
        ) : null}
        {item.reason === "no_bank_account" ? (
          <Button asChild variant="outline">
            <Link href={`/org/venues/${item.venue_id}/payroll`}>Настройки оплаты труда</Link>
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        icon={SkipForward}
        open={confirmSkip}
        onOpenChange={(open) => {
          if (!open && busy !== "skip") setConfirmSkip(false);
        }}
        title={`Пропустить официальную выплату: ${item.employee_name}, ${month}?`}
        consequences={[
          { kind: "remove", text: "Карточка уйдёт из очереди, выплата не появится" },
          { kind: "info", text: "Провести её можно будет вручную из формы выплаты в «Зарплате»" },
        ]}
        destructive
        confirmLabel="Пропустить"
        pendingLabel="Пропускаем…"
        busy={busy === "skip"}
        error={confirmSkip ? error : null}
        onConfirm={() => void skip()}
      />
    </section>
  );
}

/** Срок `05.12`; год дописывается, только если он не текущий. */
function formatDue(due: string, today: string): string {
  const [y, m, d] = due.split("-");
  return y === today.slice(0, 4) ? `${d}.${m}` : `${d}.${m}.${y}`;
}
