"use client";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Money, formatRub } from "@/components/shared/money";
import { unwrapAction } from "@/lib/actions/result";
import { suggestAlcoholPlan } from "@/lib/sales/alcohol-plan";
import type { KpiMonthView } from "@/lib/payroll/kpi-month";
import { transferMonthLabel } from "@/lib/payroll/transfer-reason";
import { saveAlcoholPlan } from "../kpi-actions";
import { PayrollDetailDialog } from "./payroll-detail-dialog";

const shift = (month: string, by: number) => {
  const d = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 10);
};
const ratio = (n: number) => `×${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}`;

/** План продаж алкоголя на следующий месяц: предложение приложения и правка. */
export function AlcoholPlanDialog({ open, onOpenChange, view, which = "next", onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: KpiMonthView;
  /** План месяца итогов (если его не задали вовремя) или следующего. */
  which?: "this" | "next";
  onSaved: (next: KpiMonthView) => void;
}) {
  const target = which === "this" ? view.month : view.next.month;
  const initialPercent = which === "this" ? null : view.next.priceIncreasePercent;
  const initialPlan = which === "this" ? view.plan.target : view.next.current;
  const [raised, setRaised] = useState(initialPercent != null);
  const [percent, setPercent] = useState(initialPercent != null ? String(initialPercent) : "");
  const history = useMemo(() => new Map(view.next.history), [view.next.history]);
  const percentValue = raised && percent !== "" ? Number(percent.replace(",", ".")) : null;
  const suggestion = useMemo(
    () => suggestAlcoholPlan(history, target, percentValue !== null && Number.isFinite(percentValue) ? percentValue : null),
    [history, target, percentValue],
  );
  const [amount, setAmount] = useState(() => (initialPlan != null ? String(initialPlan) : ""));
  // Пока человек сам не менял сумму, она идёт за предложением.
  const [touched, setTouched] = useState(initialPlan != null);
  const shown = touched ? amount : suggestion.amount != null ? String(suggestion.amount) : amount;
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const value = shown.trim() === "" ? null : Number(shown.replace(/\s/g, "").replace(",", "."));
    if (value !== null && (!Number.isFinite(value) || value <= 0)) return toast.error("План должен быть больше нуля");
    if (raised && (percentValue === null || !Number.isFinite(percentValue) || percentValue < 0.1 || percentValue > 100))
      return toast.error("Повышение цен — от 0,1 до 100%");
    setBusy(true);
    try {
      const next = unwrapAction(await saveAlcoholPlan({
        viewMonth: view.month.slice(0, 7),
        target: which,
        amount: value,
        priceIncreasePercent: raised ? percentValue : null,
      }));
      toast.success(value === null ? "План продаж алкоголя убран" : `План на ${transferMonthLabel(target)}: ${formatRub(value)}`);
      onSaved(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить план продаж");
    } finally {
      setBusy(false);
    }
  };

  const prev = shift(target, -1);
  return (
    <PayrollDetailDialog
      open={open}
      onOpenChange={(v) => { if (!busy) onOpenChange(v); }}
      title={`План продаж алкоголя на ${transferMonthLabel(target)}`}
      description="Приложение предлагает план по прошлым продажам — поправьте и утвердите"
      amount={suggestion.amount != null ? <Money value={suggestion.amount} /> : "Нет данных"}
      amountLabel="Предложение приложения"
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Отмена</Button>
          {view.canSave && (
            <Button onClick={save} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}Утвердить</Button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
      <section aria-label="Из чего сложено предложение" className="space-y-1 text-sm">
        <p>
          {transferMonthLabel(prev)}:{" "}
          {suggestion.lastMonth != null ? <Money value={suggestion.lastMonth} /> : "нет данных"}
        </p>
        <p>
          {suggestion.basis === "seasonal" && suggestion.lastYearSame && suggestion.lastYearPrev
            ? `${transferMonthLabel(shift(target, -12))} / ${transferMonthLabel(shift(target, -13))}: ${ratio(suggestion.lastYearSame / suggestion.lastYearPrev)}`
            : "Данных за прошлый год нет — берём прошлый месяц"}
        </p>
        {suggestion.priceIncreasePercent != null && (
          <p>Цены: +{suggestion.priceIncreasePercent.toLocaleString("ru-RU")}%</p>
        )}
        <p className="text-[13px] text-muted-foreground">Округлено вверх до 1 000 ₽</p>
      </section>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Поднимали цены?</span>
        <Switch checked={raised} onCheckedChange={setRaised} disabled={!view.canSave} />
      </label>
      {raised && (
        <div className="space-y-2">
          <Label htmlFor="alcohol-price-increase">Средний рост цен, %</Label>
          <Input
            id="alcohol-price-increase"
            type="number"
            inputMode="decimal"
            min={0.1}
            max={100}
            step="any"
            className="text-base sm:text-sm"
            value={percent}
            disabled={!view.canSave}
            onChange={(e) => setPercent(e.target.value)}
          />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="alcohol-plan-amount">План, ₽</Label>
        <Input
          id="alcohol-plan-amount"
          type="number"
          inputMode="decimal"
          min={1}
          step="any"
          className="text-base sm:text-sm"
          value={shown}
          placeholder="Не задан"
          disabled={!view.canSave}
          onChange={(e) => { setTouched(true); setAmount(e.target.value); }}
        />
        <p className="text-[13px] text-muted-foreground">План засчитывается, только если продажи алкоголя за месяц не меньше плана</p>
      </div>
      </div>
    </PayrollDetailDialog>
  );
}
