"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shiftTemplateLabel, type Shift, type ShiftTemplate } from "@/lib/schedule/types";
import { addDays, dateInZone, dayLabel, weekStart } from "@/lib/schedule/utils";
import { applyTemplateToShifts, countTemplateShifts } from "../actions";
import { unwrapAction } from "@/lib/actions/result";

/**
 * После сохранения шаблона предлагает перенести изменения в уже созданные
 * смены по нему — начиная с выбранной даты.
 */
export function ApplyTemplateDialog({
  open = true,
  template,
  previousTitle,
  shifts,
  timezone,
  onClose,
  onApplied,
}: {
  /** Открыта ли панель. Её держат смонтированной, пока она уезжает (docs/motion.md). */
  open?: boolean;
  template: ShiftTemplate;
  previousTitle: string;
  shifts: Shift[];
  timezone: string;
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const today = dateInZone(new Date(), timezone);
  const [from, setFrom] = useState(today);
  const [busy, setBusy] = useState(false);
  // Загруженная неделя не знает о прошлых неделях — точное число считает сервер.
  const loaded = shifts.filter(
    (s) => s.template_id === template.id && dateInZone(s.starts_at, timezone) >= from,
  ).length;
  const [counted, setCounted] = useState<{ from: string; count: number } | null>(null);
  useEffect(() => {
    let live = true;
    countTemplateShifts({ id: template.id, from })
      .then(unwrapAction)
      .then((count) => { if (live) setCounted({ from, count }); })
      .catch(() => {});
    return () => { live = false; };
  }, [template.id, from]);
  const affected = counted?.from === from ? counted.count : loaded;
  const counting = counted?.from !== from;
  const presets = [
    { label: "Сегодня", value: today },
    { label: "С начала недели", value: weekStart(today) },
    { label: "С прошлой недели", value: addDays(weekStart(today), -7) },
  ];
  const apply = async () => {
    setBusy(true);
    try {
      const result = await applyTemplateToShifts({ id: template.id, from, previousTitle });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      await onApplied().catch(() => {
        toast.warning("Смены обновлены. Обновите страницу, чтобы увидеть изменения.");
      });
      const skipped = result.skipped.length;
      const message = result.updated
        ? `Обновлено смен: ${result.updated}`
        : "Смены уже соответствуют шаблону";
      if (skipped) {
        const reasons = [...new Set(result.skipped.map((s) => s.reason))].slice(0, 3);
        toast.warning(`${message}. Пропущено: ${skipped}`, {
          description: reasons.join(" · "),
          duration: 10000,
        });
      } else toast.success(message);
      onClose();
    } catch {
      toast.error("Не удалось обновить смены. Проверьте соединение.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Обновить смены по шаблону?</DialogTitle>
          <DialogDescription>
            Шаблон «{shiftTemplateLabel(template)}» сохранён. Уже созданные по нему смены
            пока остались прежними — можно перенести в них новое время, название, цвет и
            должность.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Label htmlFor="apply-template-from">Обновить смены с даты</Label>
          <DatePicker id="apply-template-from" clearable={false} value={from} onChange={(v) => v && setFrom(v)} />
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <Button
                key={p.label}
                type="button"
                size="sm"
                variant={from === p.value ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setFrom(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {affected
              ? `Смен по шаблону с ${dayLabel(from)}: ${affected}${counting ? "…" : ""}. Сотрудники и заметки не изменятся. Зарплата, опоздания и отметки пересчитаются по новому времени. Смены с начатым чек-листом будут пропущены.`
              : counting ? "Считаем смены…" : `С ${dayLabel(from)} смен по этому шаблону нет.`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Не обновлять
          </Button>
          <Button disabled={busy || counting || !affected} onClick={apply}>
            {busy ? "Обновление…" : `Обновить смены · ${affected}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
