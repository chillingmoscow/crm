"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Link2,
  Pencil,
  Search,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { AmountInput } from "@/components/finance/amount-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  SupplyDetail,
  SupplyPaymentCandidate,
  SupplyPaymentCandidates,
} from "@/lib/supplies/types";
import { loadSupplyPaymentCandidates, setSupplyPayment } from "./actions";

const money = (c: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(c / 100);
type Selection = { transaction: string; title: string; unlink: boolean };
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
  const [picking, setPicking] = useState(false),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const [candidates, setCandidates] = useState<SupplyPaymentCandidates | null>(
      null,
    ),
    [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null),
    [amount, setAmount] = useState<number | null>(null),
    [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null),
    field = useId();
  const date = (v: string | null) =>
    v
      ? new Date(v).toLocaleDateString("ru-RU", { timeZone: timezone })
      : "Дата недоступна";
  useEffect(() => {
    if (!picking || selection) return;
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void loadSupplyPaymentCandidates(venue, detail.id, search, page)
        .then((next) => {
          if (active) setCandidates(next);
        })
        .catch((e) => {
          if (active) {
            setCandidates(null);
            setError(
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
  }, [venue, detail.id, picking, selection, search, page]);
  const choose = (c: SupplyPaymentCandidate) => {
    setSelection({
      transaction: c.id,
      title: `Расход №${c.publicId}`,
      unlink: false,
    });
    setAmount(
      Math.min(
        c.availableCents,
        detail.payment.remainingCents ?? c.availableCents,
      ) / 100,
    );
    setReason("");
    setError("");
  };
  const reset = () => {
    setSelection(null);
    setPicking(false);
    setReason("");
    setError("");
    request.current = null;
  };
  const submit = async () => {
    if (!selection || saving) return;
    const cents = selection.unlink ? 0 : Math.round((amount ?? 0) * 100);
    if (
      !selection.unlink &&
      (!amount || cents <= 0 || Math.abs(amount * 100 - cents) > 0.00001)
    ) {
      setError("Укажите сумму с точностью до копейки");
      return;
    }
    const body = {
      document: detail.id,
      transaction: selection.transaction,
      amountCents: cents,
      revision: detail.revision,
      reason: reason.trim(),
    };
    if (!body.reason) {
      setError("Укажите основание для истории");
      return;
    }
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
          : "Не удалось сохранить связь. Повтор использует тот же запрос",
      );
      setSaving(false);
      return;
    }
    reset();
    toast.success(
      selection.unlink
        ? "Связь удалена. Расход сохранён"
        : "Платёж связан с накладной",
    );
    try {
      await onChanged();
    } catch {
      setError(
        "Связь сохранена. Откройте карточку заново, чтобы увидеть актуальные данные",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="space-y-4" aria-label="Платежи по накладной">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">Платежи</h3>
        {detail.canLink && !picking && !selection && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPicking(true);
              setPage(0);
              setSearch("");
            }}
          >
            <Link2 className="mr-2 size-4" />
            Связать расход
          </Button>
        )}
      </div>
      {detail.payment.state === "review" ? (
        <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          Связанный расход или сумма накладной изменились. Проверьте
          распределение оплаты.
        </p>
      ) : (
        detail.payments.length > 0 && (
          <dl className="grid grid-cols-2 gap-4 rounded-lg bg-muted/40 p-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Подтверждено</dt>
              <dd className="mt-1 font-medium tabular-nums">
                {money(detail.payment.paidCents)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Осталось связать</dt>
              <dd className="mt-1 font-medium tabular-nums">
                {money(detail.payment.remainingCents ?? 0)}
              </dd>
            </div>
          </dl>
        )
      )}
      {detail.payment.sourceMismatch && (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          Оплата подтверждена расходом. В Quick Resto накладная пока отмечена
          неоплаченной.
        </p>
      )}
      {detail.payments.length === 0 && !picking && !selection && (
        <p className="text-sm text-muted-foreground">
          Расход пока не связан. Отметка Quick Resto сама по себе не
          подтверждает оплату в финансах.
        </p>
      )}
      <ul className="divide-y">
        {detail.payments.map((p) => (
          <li key={p.id} className="space-y-2 py-3 first:pt-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium tabular-nums">
                  {money(p.amountCents)}
                </p>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {date(p.date)} · {p.bank ?? "Расход недоступен"}
                  {p.cancelled ? " · Отменён" : ""}
                </p>
              </div>
              {p.transactionId && (
                <Button variant="ghost" size="sm" asChild>
                  <Link
                    href={`/finance/transactions?id=${p.transactionId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    №{p.publicId}
                    <ArrowUpRight className="ml-1 size-3.5" />
                    <span className="sr-only">Открыть расход</span>
                  </Link>
                </Button>
              )}
            </div>
            {p.description && (
              <p className="break-words text-xs text-muted-foreground">
                {p.description}
              </p>
            )}
            {p.canManage && !selection && !picking && (
              <div className="flex flex-wrap gap-1">
                {!p.cancelled && !p.unavailable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelection({
                        transaction: p.reference,
                        title: `Расход №${p.publicId}`,
                        unlink: false,
                      });
                      setAmount(p.amountCents / 100);
                      setReason("");
                      setError("");
                    }}
                  >
                    <Pencil className="mr-1.5 size-3.5" />
                    Сумма связи
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelection({
                      transaction: p.reference,
                      title: p.publicId
                        ? `Расход №${p.publicId}`
                        : "Недоступный расход",
                      unlink: true,
                    });
                    setReason("");
                    setError("");
                  }}
                >
                  <Unlink className="mr-1.5 size-3.5" />
                  Убрать связь
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {picking && !selection && (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">Выберите существующий расход</p>
            <Button size="sm" variant="ghost" onClick={reset}>
              Отмена
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
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
            Рублёвые расходы выбранного заведения. Новая операция не создаётся.
          </p>
          <div
            className="max-h-72 overflow-y-auto overscroll-contain"
            aria-busy={loading}
          >
            {loading ? (
              <p role="status" className="py-4 text-sm text-muted-foreground">
                Загрузка расходов…
              </p>
            ) : (
              candidates?.rows.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="block w-full space-y-1 rounded-md p-3 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  onClick={() => choose(c)}
                >
                  <span className="flex justify-between gap-3 text-sm">
                    <span>
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
            {!loading && candidates?.total === 0 && (
              <p className="py-4 text-sm text-muted-foreground">
                Подходящих расходов нет. Сначала проверьте операцию и её
                заведение в финансах.
              </p>
            )}
          </div>
          {!loading && candidates && candidates.total > 20 && (
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Назад
              </Button>
              <span className="text-xs text-muted-foreground">
                {page + 1} / {Math.ceil(candidates.total / 20)}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * 20 >= candidates.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Далее
              </Button>
            </div>
          )}
        </div>
      )}
      {selection && (
        <form
          className="space-y-4 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="font-medium">
            {selection.unlink ? "Убрать связь с оплатой" : selection.title}
          </p>
          {selection.unlink ? (
            <p className="text-sm text-muted-foreground">
              Сам расход и остаток счёта сохранятся. Изменится только
              подтверждение оплаты этой накладной.
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor={`${field}-amount`}>Сумма по этой накладной</Label>
              <AmountInput
                id={`${field}-amount`}
                value={amount}
                onChange={setAmount}
                disabled={saving}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${field}-reason`}>Основание</Label>
            <Textarea
              id={`${field}-reason`}
              placeholder="Пояснение для истории"
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving
                ? "Сохраняется…"
                : selection.unlink
                  ? "Убрать связь"
                  : "Сохранить связь"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={reset}
            >
              <ArrowLeft className="mr-1.5 size-4" />
              Отмена
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
