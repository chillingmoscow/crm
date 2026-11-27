"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Link2, Pencil, Search, Unlink } from "lucide-react";
import { toast } from "sonner";
import { AmountInput } from "@/components/finance/amount-input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExpandPanel } from "@/components/shared/overview-toggle";
import { Button } from "@/components/ui/button";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format/amount";
import { formatDateCell } from "@/lib/format/date";
import type {
  SupplyDetail,
  SupplyPaymentCandidate,
  SupplyPaymentCandidates,
} from "@/lib/supplies/types";
import { loadSupplyPaymentCandidates, setSupplyPayment } from "./actions";

type Selection = {
  transaction: string;
  /** Номер расхода; null — расход недоступен в этом заведении. */
  publicId: number | null;
  unlink: boolean;
};

const CANDIDATES_PAGE = 20;

/**
 * Секция «Оплата» в панели накладной: какие расходы подтверждают оплату и
 * сколько осталось связать. Новая операция здесь не создаётся — накладную
 * связывают с уже внесённым расходом. Любое изменение связи требует
 * основания: оно попадает в историю накладной.
 */
export function SupplyPaymentPanel({
  venue,
  detail,
  timezone,
  onChanged,
}: {
  venue: string;
  detail: SupplyDetail;
  timezone: string;
  onChanged: () => Promise<void>;
}) {
  // Связь платежа сверяется до копейки («Осталось связать 0,04 ₽» не должно
  // округляться в «0 ₽»), поэтому здесь копейки всегда, даже если аккаунт
  // округляет суммы. Список и итоги месяца следуют настройке аккаунта.
  const money = (cents: number) =>
    formatMoney(cents / 100, "RUB", 2);
  const date = (v: string | null) =>
    formatDateCell(v, timezone) ?? "Дата недоступна";

  const [picking, setPicking] = useState(false),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const [candidates, setCandidates] = useState<SupplyPaymentCandidates | null>(
      null,
    ),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null),
    [amount, setAmount] = useState<number | null>(null),
    [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [amountError, setAmountError] = useState(""),
    [reasonError, setReasonError] = useState("");
  // Повтор после сбоя сети отправляет тот же идентификатор запроса: сервер
  // не создаст вторую связь, если первая уже записалась.
  const request = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    if (!picking || selection) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    const timer = setTimeout(() => {
      void loadSupplyPaymentCandidates(venue, detail.id, search, page)
        .then((next) => {
          if (active) setCandidates(next);
        })
        .catch((e) => {
          if (active) {
            setCandidates(null);
            setLoadError(
              e instanceof Error ? e.message : "Не удалось загрузить расходы",
            );
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [venue, detail.id, picking, selection, search, page, attempt]);

  const clearErrors = () => {
    setError("");
    setAmountError("");
    setReasonError("");
  };
  const begin = (next: Selection, nextAmount: number | null) => {
    setSelection(next);
    setAmount(nextAmount);
    setReason("");
    clearErrors();
  };
  const choose = (c: SupplyPaymentCandidate) =>
    begin(
      { transaction: c.id, publicId: c.publicId, unlink: false },
      Math.min(
        c.availableCents,
        detail.payment.remainingCents ?? c.availableCents,
      ) / 100,
    );
  const reset = () => {
    setSelection(null);
    setPicking(false);
    setReason("");
    clearErrors();
    request.current = null;
  };

  const submit = async () => {
    if (!selection || saving) return;
    const cents = selection.unlink ? 0 : Math.round((amount ?? 0) * 100);
    let invalid = false;
    if (
      !selection.unlink &&
      (!amount || cents <= 0 || Math.abs(amount * 100 - cents) > 0.00001)
    ) {
      setAmountError("Укажите сумму больше нуля с точностью до копейки");
      invalid = true;
    } else setAmountError("");
    if (!reason.trim()) {
      setReasonError("Укажите основание: оно попадёт в историю накладной");
      invalid = true;
    } else setReasonError("");
    if (invalid) return;
    const body = {
      document: detail.id,
      transaction: selection.transaction,
      amountCents: cents,
      revision: detail.revision,
      reason: reason.trim(),
    };
    const key = JSON.stringify(body);
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    setSaving(true);
    setError("");
    try {
      await setSupplyPayment(venue, { ...body, request: request.current.id });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Не удалось сохранить связь. Повторите: второй связи не появится",
      );
      setSaving(false);
      return;
    }
    const unlinked = selection.unlink;
    reset();
    toast.success(
      unlinked ? "Связь убрана. Расход сохранён" : "Расход связан с накладной",
    );
    try {
      await onChanged();
    } catch {
      setError(
        "Связь сохранена. Откройте накладную заново, чтобы увидеть свежие данные",
      );
    } finally {
      setSaving(false);
    }
  };

  const reasonField = (
    <Field
      id={`supply-${detail.id}-reason`}
      label="Основание"
      required
      error={reasonError || null}
    >
      {(control) => (
        <Textarea
          {...control}
          placeholder={
            selection?.unlink
              ? "Например, расход относится к другой накладной"
              : "Например, оплата по счёту поставщика"
          }
          value={reason}
          maxLength={1000}
          rows={3}
          onChange={(e) => {
            setReason(e.target.value);
            if (reasonError) setReasonError("");
          }}
          disabled={saving}
        />
      )}
    </Field>
  );

  const editing = !!selection && !selection.unlink;
  const unlinking = !!selection?.unlink;
  const idle = !picking && !selection;
  // База принимает связь с суммой только у проведённой накладной, которая есть
  // в Quick Resto (supply_set_payment). Снять связь можно всегда. Раньше кнопка
  // была активна и у черновика, и отказ приходил уже после ввода основания.
  const linkBlocked = detail.missing
    ? "Накладной нет в Quick Resto: новую оплату к ней не привязать"
    : !detail.data.processed
      ? "Черновик: оплату можно связать после проведения накладной в Quick Resto"
      : null;
  const pages = candidates ? Math.ceil(candidates.total / CANDIDATES_PAGE) : 0;

  return (
    <DrawerSection
      title="Оплата"
      actions={
        detail.canLink && idle ? (
          <span className="inline-flex" data-tip={linkBlocked ?? undefined}>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={!!linkBlocked}
              onClick={() => {
                setPicking(true);
                setPage(0);
                setSearch("");
                clearErrors();
              }}
            >
              <Link2 className="size-4" />
              Связать расход
            </Button>
          </span>
        ) : undefined
      }
    >
      {detail.payment.state === "review" ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          Связанный расход или сумма накладной изменились. Проверьте, какие
          суммы расходов относятся к этой накладной
        </div>
      ) : (
        detail.payments.length > 0 && (
          <dl className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <dt className="text-[13px] text-muted-foreground">Подтверждено</dt>
              <dd className="mt-1 text-sm font-medium tabular-nums">
                {money(detail.payment.paidCents)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[13px] text-muted-foreground">
                Осталось связать
              </dt>
              <dd className="mt-1 text-sm font-medium tabular-nums">
                {detail.payment.remainingCents == null
                  ? "—"
                  : money(detail.payment.remainingCents)}
              </dd>
            </div>
          </dl>
        )
      )}
      {detail.payment.sourceMismatch && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Оплата подтверждена расходом, но в Quick Resto накладная пока отмечена
          неоплаченной
        </p>
      )}
      {detail.payments.length === 0 && idle && (
        <p className="text-sm text-muted-foreground">
          {detail.canLink && linkBlocked
            ? linkBlocked
            : "Расход не связан. Отметка «оплачено» в Quick Resto сама по себе не подтверждает оплату в финансах"}
        </p>
      )}

      {detail.payments.length > 0 && (
        <ul className="divide-y">
          {detail.payments.map((p) => (
            <li key={p.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium tabular-nums">
                    {money(p.amountCents)}
                  </p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {date(p.date)} · {p.bank ?? "Расход недоступен"}
                    {p.cancelled ? " · Отменён" : ""}
                  </p>
                </div>
                {p.transactionId && (
                  <Button variant="ghost" size="sm" className="gap-1" asChild>
                    <Link
                      href={`/finance/transactions?id=${p.transactionId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-tip="Открыть расход в новой вкладке"
                    >
                      №{p.publicId}
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  </Button>
                )}
              </div>
              {p.description && (
                <p className="break-words text-xs text-muted-foreground">
                  {p.description}
                </p>
              )}
              {p.canManage && idle && (
                <div className="flex flex-wrap gap-1">
                  {!p.cancelled && !p.unavailable && !linkBlocked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={() =>
                        begin(
                          {
                            transaction: p.reference,
                            publicId: p.publicId,
                            unlink: false,
                          },
                          p.amountCents / 100,
                        )
                      }
                    >
                      <Pencil className="size-3.5" />
                      Изменить сумму
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() =>
                      begin(
                        {
                          transaction: p.reference,
                          publicId: p.publicId,
                          unlink: true,
                        },
                        null,
                      )
                    }
                  >
                    <Unlink className="size-3.5" />
                    Убрать связь
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ExpandPanel open={picking && !selection}>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Выберите расход</p>
            <Button size="sm" variant="outline" onClick={reset}>
              Отмена
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Поиск расхода"
              placeholder="Номер, поставщик или назначение"
              maxLength={120}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Расходы в рублях этого заведения. Новая операция не создаётся
          </p>
          <div
            className="max-h-72 overflow-y-auto overscroll-contain"
            aria-busy={loading}
          >
            {loading ? (
              <div role="status" aria-label="Загружаем расходы" className="space-y-1 py-1">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[4.5rem] w-full" />
                ))}
              </div>
            ) : loadError ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-destructive"
              >
                <span className="min-w-0">{loadError}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Повторить
                </Button>
              </div>
            ) : (
              candidates?.rows.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="block w-full space-y-1 rounded-md p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                  onClick={() => choose(c)}
                >
                  <span className="flex justify-between gap-3 text-sm">
                    <span className="tabular-nums">
                      №{c.publicId} · {date(c.date)}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {money(c.availableCents)}
                    </span>
                  </span>
                  <span className="block break-words text-xs text-muted-foreground">
                    {c.counterparty ?? c.description ?? "Без назначения"}
                  </span>
                  <span className="block break-words text-xs text-muted-foreground">
                    {c.bank}
                  </span>
                </button>
              ))
            )}
            {!loading && !loadError && candidates?.total === 0 && (
              <p className="py-4 text-sm text-muted-foreground">
                Подходящих расходов нет. Проверьте, что расход внесён в
                финансах и отнесён к этому заведению
              </p>
            )}
          </div>
          {!loading && candidates && pages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Назад
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {page + 1} из {pages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page + 1 >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Далее
              </Button>
            </div>
          )}
        </div>
      </ExpandPanel>

      {editing && selection && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-sm font-medium">
            {selection.publicId != null
              ? `Расход №${selection.publicId}`
              : "Недоступный расход"}
          </p>
          <Field
            id={`supply-${detail.id}-amount`}
            label="Сумма по этой накладной"
            required
            error={amountError || null}
          >
            {(control) => (
              <AmountInput
                id={control.id}
                aria-label="Сумма по этой накладной"
                value={amount}
                onChange={(v) => {
                  setAmount(v);
                  if (amountError) setAmountError("");
                }}
                disabled={saving}
              />
            )}
          </Field>
          {reasonField}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={reset}
            >
              Отмена
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Сохраняем…" : "Сохранить связь"}
            </Button>
          </div>
        </form>
      )}

      {!selection && error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={unlinking}
        onOpenChange={(open) => {
          if (!open && !saving) reset();
        }}
        title={
          selection?.unlink && selection.publicId != null
            ? `Убрать связь с расходом №${selection.publicId}?`
            : "Убрать связь с расходом?"
        }
        description="Сам расход и остаток счёта сохранятся. Изменится только подтверждение оплаты этой накладной"
        confirmLabel="Убрать связь"
        pendingLabel="Убираем…"
        busy={saving}
        error={unlinking ? error || null : null}
        onConfirm={() => void submit()}
      >
        {reasonField}
      </ConfirmDialog>
    </DrawerSection>
  );
}
