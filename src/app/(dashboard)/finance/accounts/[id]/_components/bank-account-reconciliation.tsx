"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { DrawerSection, DrawerSummary, DrawerSummaryItem, DrawerSummaryTotal } from "@/components/ui/drawer-blocks";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useDiscardGuard } from "@/components/shared/discard-changes-dialog";
import { ProfileSection } from "@/components/shared/profile-section";
import { formatMoney, formatSignedMoney, signedAmountClass } from "@/lib/format/amount";
import { formatDayMonth, formatDayMonthTime } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import {
  dayInZone,
  isMatched,
  parseBankBalance,
  reconciliationDiff,
  reconciliationState,
  searchWindow,
  transactionsSearchHref,
  type ReconciliationRecord,
  type ReconciliationSearch,
} from "@/lib/finance/bank-reconciliation";
import {
  createBankAccountReconciliation,
  deleteBankAccountReconciliation,
  getBankAccountBalanceAt,
  searchReconciliationDiscrepancy,
} from "@/lib/finance/bank-reconciliations";
import { cn } from "@/lib/utils";

const COLLAPSED_ROWS = 5;

/** Деньги сверки — всегда с копейками: расхождение в 50 копеек тоже расхождение. */
function money(value: number, currency: string) {
  return formatMoney(value, currency, 2);
}

/** bare — без слова «Разница»: когда оно уже стоит в подписи рядом. */
function DiffBadge({ diff, currency, bare = false }: { diff: number; currency: string; bare?: boolean }) {
  if (isMatched(diff)) return <StatusBadge tone="success">Сходится</StatusBadge>;
  const amount = formatSignedMoney(diff, currency, 2);
  return <StatusBadge tone="warning">{bare ? amount : `Разница ${amount}`}</StatusBadge>;
}

/**
 * «Сверка с банком» на карточке счёта: история сверок и панель новой.
 * Остаток по операциям на дату и сохранённый расчёт считает база
 * (миграция 374); разница — всегда «банк − расчёт».
 */
export function BankAccountReconciliation({
  bankAccountId,
  currency,
  anchorAt,
  timezone,
  canReconcile,
  lockMessage,
  rows,
}: {
  bankAccountId: string;
  currency: string;
  /** Контрольный остаток переноса: раньше этой даты остаток не посчитать. */
  anchorAt: string | null;
  timezone: string;
  canReconcile: boolean;
  lockMessage: string | null;
  rows: ReconciliationRecord[];
}) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [toDelete, setToDelete] = useState<ReconciliationRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  const visible = showAll ? rows : rows.slice(0, COLLAPSED_ROWS);

  const remove = () => {
    if (!toDelete) return;
    setDeleteError(null);
    startDelete(async () => {
      const { error } = await deleteBankAccountReconciliation(toDelete.id);
      if (error) {
        setDeleteError(error);
        return;
      }
      setToDelete(null);
      toast.success("Сверка удалена");
      router.refresh();
    });
  };

  return (
    <>
      <ProfileSection
        title="Сверка с банком"
        description="Остаток по выписке банка рядом с остатком по операциям на ту же дату"
        locked={lockMessage ? { tone: "locked", message: lockMessage } : undefined}
        actions={
          canReconcile ? (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setDrawerOpen(true)}>
              <Scale className="size-4" />
              Сверить
            </Button>
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Сверок пока нет</p>
        ) : (
          <div className="flex flex-col">
            <ul className="flex flex-col divide-y">
              {visible.map((row) => (
                <ReconciliationRow
                  key={row.id}
                  row={row}
                  currency={currency}
                  timezone={timezone}
                  onDelete={canReconcile ? () => setToDelete(row) : undefined}
                />
              ))}
            </ul>
            {rows.length > COLLAPSED_ROWS ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 self-start"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "Свернуть" : `Показать все (${rows.length})`}
              </Button>
            ) : null}
          </div>
        )}
      </ProfileSection>

      {canReconcile ? (
        <ReconciliationDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          bankAccountId={bankAccountId}
          currency={currency}
          anchorAt={anchorAt}
          timezone={timezone}
          rows={rows}
        />
      ) : null}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => {
          if (!open) {
            setToDelete(null);
            setDeleteError(null);
          }
        }}
        title={toDelete ? `Удалить сверку на ${formatDayMonth(toDelete.balance_date)}?` : "Удалить сверку?"}
        description="Сверка пропадёт из истории. Операции и баланс счёта не изменятся"
        confirmLabel="Удалить сверку"
        pendingLabel="Удаляем…"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={remove}
      />
    </>
  );
}

function ReconciliationRow({
  row,
  currency,
  timezone,
  onDelete,
}: {
  row: ReconciliationRecord;
  currency: string;
  timezone: string;
  onDelete?: () => void;
}) {
  const state = reconciliationState(row);
  const author = [row.source === "bank" ? "Из банка" : row.created_by_name, formatDayMonthTime(row.created_at, new Date(), timezone)]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-medium">{formatDayMonth(row.balance_date)}</span>
          <DiffBadge diff={state.diff} currency={currency} />
        </div>
        <span className="text-[13px] tabular-nums text-muted-foreground">
          По выписке {money(row.bank_balance, currency)} · по операциям {money(row.calculated_balance, currency)}
        </span>
        {state.changedSince ? (
          <span className="text-[13px] text-amber-700 dark:text-amber-400">
            После сверки операции до этой даты менялись:{" "}
            {state.currentMatched
              ? "сейчас сходится"
              : `сейчас разница ${formatSignedMoney(state.currentDiff, currency, 2)}`}
          </span>
        ) : null}
        {row.note ? <span className="text-[13px] text-foreground">{row.note}</span> : null}
        {author ? <span className="text-xs text-muted-foreground">{author}</span> : null}
      </div>
      {onDelete ? (
        <Button
          variant="ghost"
          size="icon"
          className="touch-target size-8 shrink-0 text-muted-foreground"
          aria-label={`Удалить сверку на ${formatDayMonth(row.balance_date)}`}
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : null}
    </li>
  );
}

type BalanceState =
  | { status: "idle" | "loading" }
  | { status: "ready"; balance: number }
  | { status: "unavailable" }
  | { status: "error"; message: string };

function ReconciliationDrawer({
  open,
  onOpenChange,
  bankAccountId,
  currency,
  anchorAt,
  timezone,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bankAccountId: string;
  currency: string;
  anchorAt: string | null;
  timezone: string;
  rows: ReconciliationRecord[];
}) {
  const router = useRouter();
  const today = dayInZone(timezone);
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [balance, setBalance] = useState<BalanceState>({ status: "idle" });
  const [search, setSearch] = useState<ReconciliationSearch | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const dirty = amount.trim() !== "" || note.trim() !== "" || day !== today;
  const { guard, dialog } = useDiscardGuard(dirty, "Сверка не будет сохранена.");

  const bankBalance = amount.trim() ? parseBankBalance(amount) : null;
  const amountError = amount.trim() && bankBalance === null ? "Число, не больше двух знаков после запятой" : null;
  const diff = balance.status === "ready" && bankBalance !== null ? reconciliationDiff(bankBalance, balance.balance) : null;
  const period = useMemo(() => (day ? searchWindow(rows, day) : null), [rows, day]);
  const minDay = anchorAt ? dayInZone(timezone, new Date(anchorAt)) : undefined;

  // Остаток по операциям на выбранную дату — сразу при выборе.
  useEffect(() => {
    if (!open || !day) {
      setBalance({ status: "idle" });
      return;
    }
    let cancelled = false;
    setBalance({ status: "loading" });
    getBankAccountBalanceAt(bankAccountId, day)
      .then(({ balance: value, error }) => {
        if (cancelled) return;
        if (error) setBalance({ status: "error", message: error });
        else if (value === null) setBalance({ status: "unavailable" });
        else setBalance({ status: "ready", balance: value });
      })
      .catch(() => {
        if (!cancelled) setBalance({ status: "error", message: "Не удалось посчитать остаток. Проверьте соединение" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, day, bankAccountId]);

  // Где искать, если не сошлось: операции с последней сошедшейся сверки.
  useEffect(() => {
    setSearch(null);
    if (!open || diff === null || isMatched(diff) || !period) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchReconciliationDiscrepancy(bankAccountId, period, diff)
        .then(({ search: found }) => {
          if (!cancelled) setSearch(found);
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, diff, period, bankAccountId]);

  const reset = () => {
    setDay(today);
    setAmount("");
    setNote("");
    setServerError(null);
    setSearch(null);
  };
  const close = () => {
    onOpenChange(false);
    reset();
  };

  const canSave = !!day && bankBalance !== null && balance.status === "ready" && !saving;

  const submit = () => {
    if (!canSave) return;
    setServerError(null);
    startSave(async () => {
      try {
        const { row, error } = await createBankAccountReconciliation({
          bankAccountId,
          balanceDate: day,
          bankBalance: amount,
          note,
        });
        if (error || !row) {
          setServerError(error ?? "Не удалось сохранить сверку. Повторите попытку");
          return;
        }
        const saved = reconciliationDiff(bankBalance!, row.calculated_balance);
        toast.success(
          isMatched(saved)
            ? `Сверка на ${formatDayMonth(day)} сохранена: сходится`
            : `Сверка на ${formatDayMonth(day)} сохранена, разница ${formatSignedMoney(saved, currency, 2)}`,
        );
        close();
        router.refresh();
      } catch {
        setServerError("Не удалось сохранить сверку. Проверьте соединение и повторите");
      }
    });
  };

  return (
    <>
      <EditDrawer
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else if (!saving) guard(close);
        }}
        title="Сверка с банком"
        description="Введите остаток по выписке банка на конец дня"
        footer={
          <>
            <Button variant="outline" onClick={() => guard(close)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={submit} disabled={!canSave} className="min-w-32">
              {saving ? "Сохраняем…" : "Сохранить сверку"}
            </Button>
          </>
        }
      >
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
          <DrawerSection>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Дата" required>
                {(control) => (
                  <DatePicker
                    {...control}
                    value={day}
                    onChange={setDay}
                    clearable={false}
                    fromDate={minDay ? new Date(`${minDay}T00:00:00`) : undefined}
                    toDate={new Date(`${today}T00:00:00`)}
                  />
                )}
              </Field>
              <Field label="Остаток по выписке" required error={amountError}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0,00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="Комментарий">
              {(control) => (
                <Textarea
                  {...control}
                  rows={2}
                  maxLength={500}
                  placeholder="Например, номер выписки"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
          </DrawerSection>

          <DrawerSection title="Результат">
            <DrawerSummary label="Результат сверки">
              <DrawerSummaryTotal label={day ? `По операциям на ${formatDayMonth(day)}` : "По операциям"}>
                {balance.status === "ready" ? (
                  <span className={cn(balance.balance < 0 && signedAmountClass(balance.balance))}>
                    {money(balance.balance, currency)}
                  </span>
                ) : balance.status === "loading" ? (
                  <span className="text-muted-foreground">Считаем…</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </DrawerSummaryTotal>
              {balance.status === "unavailable" ? (
                <p className="text-sm text-muted-foreground">
                  На эту дату остаток не посчитать: раньше даты переноса счёт перенесён одной суммой
                </p>
              ) : null}
              {balance.status === "error" ? (
                <p role="alert" className="text-sm text-destructive">
                  {balance.message}
                </p>
              ) : null}
              {diff !== null ? (
                <DrawerSummaryItem icon={<Scale />} label="Разница">
                  <span className="flex flex-wrap items-center gap-2">
                    <DiffBadge diff={diff} currency={currency} bare />
                    {!isMatched(diff) ? (
                      <span className="text-[13px] text-muted-foreground">
                        {diff > 0 ? "В банке больше, чем по операциям" : "В банке меньше, чем по операциям"}
                      </span>
                    ) : null}
                  </span>
                </DrawerSummaryItem>
              ) : null}
            </DrawerSummary>
          </DrawerSection>

          {diff !== null && !isMatched(diff) && period ? (
            <DrawerSection
              title="Где искать"
              description={
                period.matchedOn
                  ? `С последней сошедшейся сверки на ${formatDayMonth(period.matchedOn)}`
                  : "Сошедшихся сверок раньше этой даты нет: смотрите операции с начала"
              }
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm">
                    {period.from
                      ? `${formatDayMonth(period.from)} – ${formatDayMonth(period.to)}`
                      : `По ${formatDayMonth(period.to)}`}
                    {search ? ` · ${countRu(search.operations, "операция", "операции", "операций")}` : ""}
                  </span>
                  <Button variant="outline" size="sm" className="gap-2" asChild>
                    <Link href={transactionsSearchHref(bankAccountId, period)} target="_blank">
                      <ArrowLeftRight className="size-4" />
                      Операции за период
                    </Link>
                  </Button>
                </div>
                {search && search.suspects.length > 0 ? (
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {search.suspects.map((s) => (
                      <li key={s.id} className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                        Операция №{s.public_id} от {formatDayMonth(s.date, new Date(), timezone)} на{" "}
                        {money(s.amount, currency)}:{" "}
                        {s.reason === "duplicate"
                          ? diff > 0
                            ? "её сумма равна разнице. Возможно, это дубль или расхода нет в банке"
                            : "её сумма равна разнице. Возможно, это дубль или прихода нет в банке"
                          : "двойная сумма равна разнице. Возможно, она проведена не в ту сторону"}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </DrawerSection>
          ) : null}

          {serverError ? (
            <p role="alert" className="text-xs text-destructive">
              {serverError}
            </p>
          ) : null}
        </form>
      </EditDrawer>
      {dialog}
    </>
  );
}
