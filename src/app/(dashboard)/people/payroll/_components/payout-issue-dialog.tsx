"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Money, formatRub } from "@/components/shared/money";
import { unwrapAction } from "@/lib/actions/result";
import { formatDayMonth } from "@/lib/format/date";
import { issuePayoutToday, previewPayoutToday, type IssuePreview } from "../payout-actions";
import { PayrollDetailDialog } from "./payroll-detail-dialog";
import formStyle from "./payroll-payment-form.module.css";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

/**
 * «Выдать сегодня»: кассы и сколько можно выдать, кому сколько, текст для
 * менеджеров. Проводит выплаты с кэшбокса и отправляет сообщение в чат.
 * Ключ выдачи живёт, пока открыта панель: повтор после сбоя не задвоит выплаты.
 */
export function PayoutIssueDialog({ open = true, planId, onClose, onDone }: {
  /** Открыта ли панель. Её держат смонтированной, пока она уезжает (docs/motion.md). */
  open?: boolean;
  planId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<IssuePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unsent, setUnsent] = useState<string | null>(null);

  const load = async () => {
    setError("");
    setPreview(null);
    try {
      setPreview(unwrapAction(await previewPayoutToday(planId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось проверить наличные");
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз при открытии
  }, [planId]);

  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const result = unwrapAction(await issuePayoutToday(planId, preview.requestKey, preview.lines));
      await onDone();
      const sum = formatRub(preview.lines.reduce((s, l) => s + l.amount, 0));
      if (result.notMoved.length)
        toast.warning(`Выберите новый день в плане: ${result.notMoved.join(", ")}`);
      if (result.messageState === "sent") {
        toast.success(`Выдача проведена: ${sum}. Сообщение отправлено`);
        onClose();
      } else if (result.messageState === "sending") {
        toast.success(`Выдача проведена: ${sum}. Сообщение отправляется`);
        onClose();
      } else {
        toast.success("Выдача проведена");
        setUnsent(result.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось провести выдачу");
    } finally {
      setBusy(false);
    }
  };

  const total = preview?.lines.reduce((s, l) => s + l.amount, 0) ?? 0;
  // Список «не хватило» имеет смысл, только когда кассы прочитаны и мешает лишь сумма.
  const cashShort = !preview?.problem || preview.problem === "В кассах меньше минимума";
  const nothing = cashShort ? (preview?.short.filter((r) => !preview.lines.some((l) => l.row_id === r.row_id)) ?? []) : [];

  return (
    <PayrollDetailDialog
      open={open}
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      title="Выдать сегодня"
      description="Выплаты с кэшбокса и сообщение менеджерам"
      amount={preview ? <Money value={total} /> : undefined}
      amountLabel="К выдаче"
      footer={
        unsent !== null ? (
          <Button onClick={onClose}>Готово</Button>
        ) : (
          <>
            <Button variant="outline" disabled={busy} onClick={onClose}>Отмена</Button>
            {preview && !preview.problem && (
              <Button disabled={busy} onClick={() => void submit()}>
                {busy ? "Проводим…" : "Провести и отправить"}
              </Button>
            )}
          </>
        )
      }
    >
      <div className={formStyle.form}>
        {!preview && !error && <p className="text-sm text-muted-foreground">Проверяем кассы…</p>}
        {error && (
          <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
            <p>{error}</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>Проверить ещё раз</Button>
          </div>
        )}
        {unsent !== null && (
          <div role="alert" className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Выплаты проведены, но сообщение не отправлено</p>
            <p>Отправьте его менеджерам сами:</p>
            <pre className="whitespace-pre-wrap rounded-md bg-background p-2 font-sans">{unsent}</pre>
            <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(unsent).then(() => toast.success("Скопировано"))}>
              Скопировать
            </Button>
          </div>
        )}
        {preview && unsent === null && (
          <>
            <ul className="divide-y rounded-xl border px-3 text-sm">
              {preview.registers.map((r) => (
                <li key={r.terminalId || r.terminal} className="flex items-start justify-between gap-3 py-1.5">
                  <span>
                    {r.terminal}
                    <span className="block text-xs text-muted-foreground">
                      {r.source === "open" ? `открытие смены ${time(r.at)}` : `закрытие ${formatDayMonth(r.at) ?? ""} ${time(r.at)}`}
                    </span>
                  </span>
                  <Money value={r.amount} />
                </li>
              ))}
              <li className="flex justify-between gap-3 py-1.5">
                <span>Оставить в кассах</span>
                <Money value={-preview.minimum} signed />
              </li>
              {preview.issuedToday > 0 && (
                <li className="flex justify-between gap-3 py-1.5">
                  <span>Уже выдано сегодня</span>
                  <Money value={-preview.issuedToday} signed />
                </li>
              )}
              <li className="flex justify-between gap-3 py-1.5 font-medium">
                <span>Можно выдать</span>
                <Money value={preview.available} />
              </li>
            </ul>

            {preview.problem && (
              <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                {preview.problem}. Ничего не проведено.
              </div>
            )}

            {preview.warning && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">{preview.warning}</p>
            )}

            {preview.lines.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Выдаём</p>
                <ul className="divide-y rounded-xl border px-3 text-sm">
                  {preview.lines.map((l) => {
                    const row = preview.short.find((r) => r.row_id === l.row_id);
                    return (
                      <li key={l.row_id} className="flex items-start justify-between gap-3 py-1.5">
                        <span>
                          {l.name}
                          {row && (
                            <span className="block text-xs text-muted-foreground">
                              {formatRub(l.amount)} из {formatRub(row.due)}, остаток:{" "}
                              {l.next_pay_date ? formatDayMonth(l.next_pay_date) : "день не выбран"}
                            </span>
                          )}
                        </span>
                        <Money value={l.amount} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {nothing.length > 0 && (
              <div className="space-y-1 text-sm">
                <p className="font-medium">Не хватило наличных</p>
                <ul className="text-muted-foreground">
                  {nothing.map((r) => (
                    <li key={r.row_id}>
                      {r.name} · {formatRub(r.due)} · {r.next_pay_date ? `перенесём на ${formatDayMonth(r.next_pay_date)}` : "выберите день в плане"}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.message && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Сообщение менеджерам</p>
                <pre className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 font-sans text-sm">{preview.message}</pre>
              </div>
            )}
          </>
        )}
      </div>
    </PayrollDetailDialog>
  );
}
