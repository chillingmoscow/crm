"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MonthPicker } from "@/components/shared/month-picker";
import { recalculateInventoryDeduction } from "@/app/(dashboard)/inventory/_actions/deduction";

/**
 * Ручной пересчёт удержания за месяц. Обычно удержание ставится в ведомость само
 * (после итогов акта, разнесения списаний, правок исключений и правил). Пересчёт
 * нужен, когда изменилось то, что автоматику не будит: например, правки табеля.
 */
export function DeductionRecalculate({ venueId, today }: { venueId: string; today: string }) {
  const currentMonth = `${today.slice(0, 7)}-01`;
  const [month, setMonth] = useState(currentMonth);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    try {
      const r = await recalculateInventoryDeduction({ venueId, month });
      setSummary(r.error ?? r.summary);
      if (r.error) toast.error(r.error);
      else toast.success("Удержание пересчитано");
    } catch (e) {
      const text = e instanceof Error ? e.message : "Не удалось пересчитать удержание";
      setSummary(text);
      toast.error(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 space-y-3 border-t pt-6">
      <div>
        <h3 className="font-semibold">Пересчитать удержание за месяц</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Удержание по недостаче ставится в зарплатную ведомость само. Пересчитайте месяц вручную, если поправили табель
          или смены: такие правки пересчёт сами не запускают.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-44">
          <MonthPicker
            value={month}
            min="2025-01-01"
            max={currentMonth}
            onChange={setMonth}
            variant="field"
            prefix=""
            ariaLabel="Месяц удержания"
          />
        </div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void run()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Пересчитать
        </Button>
      </div>
      {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
    </section>
  );
}
