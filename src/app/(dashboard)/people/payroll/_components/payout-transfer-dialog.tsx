"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { Money } from "@/components/shared/money";
import { unwrapAction } from "@/lib/actions/result";
import { markTransferPaid, type PayoutPlanView, type PayoutRowView } from "../payout-actions";
import { PayrollDetailDialog } from "./payroll-detail-dialog";
import { selectClass } from "./select-class";
import formStyle from "./payroll-payment-form.module.css";

/**
 * «Выплачено» по строке «переводом»: счёт сотрудника оплачен — записываем
 * выплату с расчётного счёта. В Adesk она не уходит: платёж уже там из банка.
 */
export function PayoutTransferDialog({
  row,
  view,
  onClose,
  onDone,
}: {
  row: PayoutRowView;
  view: PayoutPlanView;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const left = Math.round((row.amount - row.issued) * 100) / 100;
  const checking = view.banks.filter((b) => b.type === "checking");
  const [amount, setAmount] = useState(String(left));
  const [date, setDate] = useState(view.today);
  const [bank, setBank] = useState(view.settings.schedules.transfer.bank_account_id ?? checking[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Ключ живёт, пока открыта панель: повторное нажатие после сбоя не создаст вторую выплату.
  const key = useRef(crypto.randomUUID());
  const parsed = Number(amount.replace(",", ".").replace(/\s/g, ""));
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= left && /^\d{4}-\d{2}-\d{2}$/.test(date) && !!bank;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      unwrapAction(await markTransferPaid(row.id!, {
        amount: Math.round(parsed * 100) / 100,
        date,
        bankAccountId: bank,
        requestKey: key.current,
      }));
      await onDone();
      toast.success("Выплата записана");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось записать выплату");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PayrollDetailDialog
      open
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      title="Выплачено"
      description="Счёт сотрудника оплачен с расчётного счёта"
      employee={{ name: row.name, role: row.role, avatarUrl: row.avatarUrl }}
      amount={<Money value={left} />}
      amountLabel="Ждём счёт на"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>Отмена</Button>
          <Button disabled={busy || !valid} onClick={() => void submit()}>{busy ? "Записываем…" : "Записать выплату"}</Button>
        </>
      }
    >
      <div className={formStyle.form}>
        <div className="space-y-2">
          <Label htmlFor="transfer-amount">Сумма по счёту, ₽</Label>
          <Input id="transfer-amount" inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
          {Number.isFinite(parsed) && parsed > left && (
            <p className="text-[13px] text-destructive">Больше, чем по плану. Сначала поправьте сумму в строке плана.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="transfer-date">Дата оплаты</Label>
          <DatePicker id="transfer-date" value={date} onChange={setDate} clearable={false} disabled={busy} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="transfer-bank">Счёт</Label>
          <OptionSelect
            id="transfer-bank"
            className={selectClass}
            value={bank}
            disabled={busy}
            onValueChange={setBank}
            placeholder="Выберите расчётный счёт"
            options={checking.map((b) => ({ value: b.id, label: b.name }))}
          />
        </div>
        <p className="text-[13px] text-muted-foreground">
          Выплата появится в «Выплатах» и в финансах. В Adesk не отправляется: платёж по счёту уже пришёл туда из банка.
        </p>
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">{error}</p>}
      </div>
    </PayrollDetailDialog>
  );
}
