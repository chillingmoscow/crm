"use client";
import { useEffect, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { unwrapAction } from "@/lib/actions/result";
import type { MonthPlanView } from "@/lib/sales/plan-data";
import { OWNER_SEASON_NOTE } from "@/lib/sales/seasonality";
import { loadMonthPlan, saveSeasonality } from "../plan-actions";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });

/** Сезонность заведения: 12 индексов дня месяца к среднему дню года, по умолчанию — общепит Москвы. */
export function SeasonalityDrawer({ open, onOpenChange, month, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  onSaved: () => void;
}) {
  const [view, setView] = useState<MonthPlanView | null>(null);
  const [error, setError] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);

  const apply = (v: MonthPlanView) => {
    setView(v);
    setValues(v.season.index.map((x) => String(x)));
  };
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setView(null);
    setError("");
    loadMonthPlan(month).then(unwrapAction).then((v) => alive && apply(v))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Не удалось загрузить сезонность"));
    return () => { alive = false; };
  }, [open, month]);

  const canEdit = view?.canEdit ?? false;
  const hasOwn = view?.season.own.some((v) => v !== null) ?? false;
  const run = async (kind: "save" | "reset") => {
    let index: number[] | null = null;
    if (kind === "save") {
      const parsed = values.map((v) => Number(v.replace(",", ".")));
      if (parsed.some((v) => !Number.isFinite(v) || v <= 0)) return toast.error("Индексы — положительные числа");
      index = parsed;
    }
    setBusy(kind);
    try {
      apply(unwrapAction(await saveSeasonality(month, index)));
      toast.success(kind === "save" ? "Сезонность сохранена" : "Вернули сезонность Росстата");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить сезонность");
    } finally {
      setBusy(null);
    }
  };

  return (
    <EditDrawer
      open={open}
      onOpenChange={(v) => { if (!busy) onOpenChange(v); }}
      title="Сезонность"
      description="Оборот дня месяца к среднему дню года"
      footer={canEdit ? (
        <>
          {view?.season.custom ? (
            <Button variant="outline" onClick={() => void run("reset")} disabled={busy !== null}>
              {busy === "reset" && <Loader2 className="size-4 animate-spin" />}Вернуть Росстат
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>Отмена</Button>
          )}
          <Button onClick={() => void run("save")} disabled={busy !== null || !view}>
            {busy === "save" && <Loader2 className="size-4 animate-spin" />}{busy === "save" ? "Сохраняем…" : "Сохранить"}
          </Button>
        </>
      ) : undefined}
    >
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!view && !error && <Skeleton className="h-96 w-full" />}
      {view && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">Месяц</th>
              <th className="pb-2 font-medium">
                <span className="inline-flex cursor-help items-center gap-1" data-tip={`${view.season.source}. ${view.season.note}`} data-tip-sub={OWNER_SEASON_NOTE}>
                  Росстат <Info className="size-3.5" aria-hidden />
                </span>
              </th>
              {hasOwn && <th className="pb-2 font-medium">Ваши данные</th>}
              <th className="pb-2 text-right font-medium">В прогнозе</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {MONTHS.map((name, i) => (
              <tr key={name}>
                <td className="py-1.5">{name}</td>
                <td className="py-1.5 tabular-nums text-muted-foreground">{fmt(view.season.industry[i])}</td>
                {hasOwn && <td className="py-1.5 tabular-nums text-muted-foreground">{view.season.own[i] == null ? "—" : fmt(view.season.own[i]!)}</td>}
                <td className="py-1.5 text-right">
                  <Input type="number" inputMode="decimal" step="0.01" min={0.01} aria-label={`Индекс: ${name}`}
                    className="ml-auto h-9 w-24 text-right text-base tabular-nums sm:text-sm"
                    value={values[i] ?? ""} disabled={!canEdit} onChange={(e) => setValues(values.map((v, j) => (j === i ? e.target.value : v)))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </EditDrawer>
  );
}
