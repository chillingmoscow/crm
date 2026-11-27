"use client";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/status-badge";
import { Money, formatRub } from "@/components/shared/money";
import { unwrapAction } from "@/lib/actions/result";
import { kpiResult, KPI_MAX_COUNT, type KpiAnswers, type KpiLine } from "@/lib/payroll/kpi";
import type { KpiMonthPerson, KpiMonthView } from "@/lib/payroll/kpi-month";
import { transferMonthLabel } from "@/lib/payroll/transfer-reason";
import { saveKpiReview } from "../kpi-actions";
import { PayrollDetailDialog } from "./payroll-detail-dialog";

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });

function inventoryHint(view: KpiMonthView): string {
  if (!view.inventory.length) return `Актов инвентаризации за ${transferMonthLabel(view.month)} нет`;
  const acts = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "акт" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "акта" : "актов"}`;
  const text = view.inventory.map((d) => `${dayLabel(d.date)} (${acts(d.count)})`).join(", ");
  return view.inventory.some((d) => d.beforeDeadline) ? `Проведено ${text}` : `Проведено ${text} — позже 20-го`;
}

/** Чек-лист итогов KPI за месяц: живой итог, сохранение одной премией. */
export function KpiChecklistDialog({ open, onOpenChange, view, person, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: KpiMonthView;
  person: KpiMonthPerson;
  onSaved: (next: KpiMonthView) => void;
}) {
  const [answers, setAnswers] = useState<KpiAnswers>(() => person.review?.answers ?? {});
  // Ключ запроса — один на открытие: двойной клик не создаст вторую премию.
  const [requestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const result = useMemo((): { lines: KpiLine[]; total: number; error: string | null } => {
    try {
      return { ...kpiResult(person.items, answers, view.plan), error: null };
    } catch (e) {
      return { lines: [], total: 0, error: e instanceof Error ? e.message : "Проверьте ответы" };
    }
  }, [person.items, answers, view.plan]);
  const blocked = view.blocked ?? person.blocked;
  const readOnly = !view.canSave || Boolean(blocked);
  const line = (id: string) => result.lines.find((l) => l.id === id);
  const inventoryItem = person.items.find((i) => i.type === "done" && /инвентар/i.test(i.label));

  const save = async () => {
    if (result.error) return toast.error(result.error);
    setBusy(true);
    try {
      const next = unwrapAction(await saveKpiReview({
        employeeId: person.employeeId,
        month: view.month.slice(0, 7),
        termsId: person.termsId,
        answers,
        requestKey,
        expectedSavedAt: person.review?.savedAt ?? null,
      }));
      toast.success(result.total > 0 ? `Итоги KPI сохранены: ${formatRub(result.total)}` : "Итоги KPI сохранены без премии");
      onSaved(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить итоги KPI");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PayrollDetailDialog
      open={open}
      onOpenChange={(v) => { if (!busy) onOpenChange(v); }}
      title={`Итоги KPI за ${transferMonthLabel(view.month)}`}
      description="Отметьте, что выполнено. Итог уйдёт премией во вторую выплату"
      employee={{ name: person.name, role: person.since ? `${person.roleName} с ${dayLabel(person.since)}` : person.roleName }}
      amount={<Money value={result.total} />}
      amountLabel="Итог KPI"
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Отмена</Button>
          {!readOnly && (
            <Button onClick={save} disabled={busy || Boolean(result.error)}>
              {busy && <Loader2 className="size-4 animate-spin" />}Сохранить
            </Button>
          )}
        </div>
      }
    >
      {blocked && <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">{blocked}</p>}
      {person.manual.length > 0 && (
        <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          Уже начислено вручную: {person.manual.map((m) => `${formatRub(m.amount)} «${m.reason}»`).join(", ")} — проверьте, чтобы не заплатить дважды
        </p>
      )}
      <ul className="divide-y rounded-lg border">
        {person.items.map((item) => {
          const l = line(item.id);
          return (
            <li key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-[13px] text-muted-foreground">
                  {item.type === "each" ? `${formatRub(item.price)} за каждую` : formatRub(item.amount)}
                  {item.type === "all" && " · если выполнены все пункты"}
                  {item.type === "plan" && ` · план ${view.plan.target != null ? formatRub(view.plan.target) : "не задан"}, факт ${view.plan.actual != null ? formatRub(view.plan.actual) : "—"}`}
                </p>
                {item.id === inventoryItem?.id && <p className="text-[13px] text-muted-foreground">{inventoryHint(view)}</p>}
              </div>
              {item.type === "done" && (
                <Switch
                  checked={answers[item.id] === true}
                  disabled={readOnly}
                  aria-label={item.label}
                  onCheckedChange={(v) => setAnswers({ ...answers, [item.id]: v })}
                />
              )}
              {item.type === "each" && (
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={KPI_MAX_COUNT}
                  step={1}
                  disabled={readOnly}
                  aria-label={`${item.label}: количество`}
                  className="w-24 text-base sm:text-sm"
                  value={typeof answers[item.id] === "number" ? String(answers[item.id]) : ""}
                  placeholder="0"
                  onChange={(e) => setAnswers({ ...answers, [item.id]: e.target.value === "" ? 0 : Number(e.target.value) })}
                />
              )}
              {(item.type === "plan" || item.type === "all") && (
                <StatusBadge tone={l?.counted ? "success" : "neutral"}>
                  {item.type === "plan" ? (l?.counted ? "Выполнен" : l?.note && !/плана$/.test(l.note) ? l.note : "Не выполнен") : l?.counted ? "Засчитан" : "Не засчитан"}
                </StatusBadge>
              )}
              {item.type === "plan" && l?.note && /плана$/.test(l.note) && (
                <p className="w-full text-[13px] text-muted-foreground">{l.note}</p>
              )}
            </li>
          );
        })}
      </ul>
      {result.error && <p role="alert" className="text-sm text-destructive">{result.error}</p>}
      {person.review && (
        <p className="text-[13px] text-muted-foreground">
          Сохранено {new Date(person.review.savedAt).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
          {person.review.savedBy ? ` · ${person.review.savedBy}` : ""}
        </p>
      )}
    </PayrollDetailDialog>
  );
}
