"use client";
import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { unwrapAction } from "@/lib/actions/result";
import type { MonthPlanView } from "@/lib/sales/plan-data";
import { deletePriceChange, loadMonthPlan, savePriceChange } from "../plan-actions";

const date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).replace(" г.", "");
const signed = (p: number) => `${p > 0 ? "+" : ""}${p.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;

/** Журнал изменений цен: прогноз плана приводит прошлые месяцы к нынешним ценам. */
export function PriceChangesDrawer({ open, onOpenChange, month, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  onSaved: () => void;
}) {
  const [view, setView] = useState<MonthPlanView | null>(null);
  const [error, setError] = useState("");
  const [day, setDay] = useState("");
  const [percent, setPercent] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setView(null);
    setError("");
    loadMonthPlan(month).then(unwrapAction).then((v) => alive && setView(v))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Не удалось загрузить изменения цен"));
    return () => { alive = false; };
  }, [open, month]);

  const canEdit = view?.canEdit ?? false;
  const add = async () => {
    const p = percent.trim() === "" ? null : Number(percent.replace(",", "."));
    if (!day) return toast.error("Укажите, с какого дня");
    if (p === null || !Number.isFinite(p) || p === 0) return toast.error("Укажите рост чека в процентах");
    setBusy(true);
    try {
      setView(unwrapAction(await savePriceChange({ month, date: day, percent: p, note })));
      setDay(""); setPercent(""); setNote("");
      toast.success("Изменение цен записано");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось записать изменение цен");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string, label: string) => {
    if (!(await confirm({ title: "Удалить изменение цен?", description: label, confirmLabel: "Удалить изменение", destructive: true }))) return;
    try {
      setView(unwrapAction(await deletePriceChange(month, id)));
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить изменение цен");
    }
  };

  return (
    <EditDrawer
      open={open}
      onOpenChange={(v) => { if (!busy) onOpenChange(v); }}
      title="Изменения цен"
      description="Средний рост чека по всему меню"
      footer={canEdit ? (
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Закрыть</Button>
          <Button onClick={add} disabled={busy || !view}>{busy && <Loader2 className="size-4 animate-spin" />}{busy ? "Записываем…" : "Записать"}</Button>
        </>
      ) : undefined}
    >
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!view && !error && <Skeleton className="h-32 w-full" />}
      {view && (
        <>
          {canEdit && (
            <DrawerSection title="Новое изменение">
              <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                <Field label="С какого дня">{(control) => <DatePicker {...control} value={day} onChange={setDay} />}</Field>
                <Field label="Рост чека, %">
                  {(control) => <Input {...control} type="number" inputMode="decimal" step="0.1" className="text-base sm:text-sm" value={percent} onChange={(e) => setPercent(e.target.value)} />}
                </Field>
              </div>
              <Field label="Комментарий" hint="Если подняли часть меню — пересчитайте в средний рост чека">
                {(control) => <Input {...control} maxLength={300} className="text-base sm:text-sm" value={note} placeholder="Бар +8%" onChange={(e) => setNote(e.target.value)} />}
              </Field>
            </DrawerSection>
          )}
          <DrawerSection title="Записанные">
            {view.prices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Изменений цен нет</p>
            ) : (
              <ul className="divide-y">
                {[...view.prices].reverse().map((p) => (
                  <li key={p.id} className="flex min-w-0 items-center gap-3 py-2.5 text-sm">
                    <span className="w-36 shrink-0 tabular-nums">{date(p.date)}</span>
                    <span className="w-16 shrink-0 font-medium tabular-nums">{signed(p.percent)}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.note}</span>
                    {canEdit && (
                      <Button variant="ghost" size="sm" className="w-9 shrink-0 px-0 text-destructive touch-target" aria-label="Удалить изменение цен" data-tip="Удалить"
                        onClick={() => void remove(p.id, `${date(p.date)}, ${signed(p.percent)}`)}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </DrawerSection>
        </>
      )}
      {dialog}
    </EditDrawer>
  );
}
