"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import type { ShiftAttendanceMark, ShiftAttendanceState } from "@/lib/payroll/types";
import { reviewShiftAttendance } from "../actions";

const descriptions: Record<ShiftAttendanceState, string> = {
  missing: "Смену можно засчитать вручную.",
  scheduled: "Выход засчитан по графику.",
  included: "Выход засчитан по решению управляющего.",
  excluded: "Выход исключён из расчёта по решению управляющего.",
};

export function ShiftAttendancePopover({ shiftId, version, mark, canReview }: {
  shiftId: string;
  version: number;
  mark: ShiftAttendanceMark;
  canReview: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const pinned = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  const closeOnLeave = () => {
    if (!pinned.current) closeTimer.current = setTimeout(() => setOpen(false), 180);
  };
  const pending = mark.sourceState === "pending" || mark.sourceState === "loading" ||
    (mark.sourceState === "complete" && savedAt !== null && savedAt === mark.syncedAt);
  const failed = mark.sourceState === "error";
  const heading = mark.state === "excluded"
    ? "Смена не засчитана"
    : mark.hasQuickResto
      ? mark.state === "missing" ? "Отметка не связана со сменой" : "Выход проверен"
      : "Нет отметки в Quick Resto";
  const save = async (decision: "include" | "exclude") => {
    if (saving || pending || mark.sourceState !== "complete" || !mark.syncedAt) return;
    setSaving(true);
    try {
      await reviewShiftAttendance({
        shiftId,
        version,
        syncedAt: mark.syncedAt,
        decision,
        reason: reason.trim() || "Выход подтверждён по расписанию",
      });
      setSavedAt(mark.syncedAt);
      toast.success("Решение сохранено. Начисления пересчитываются.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить решение");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={(next) => {
      if (!next) {
        pinned.current = false;
        setReason("");
        clearClose();
      }
      setOpen(next);
    }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={heading}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="absolute right-0.5 top-0.5 grid size-6 place-items-center rounded text-amber-700 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300"
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse") return;
            clearClose();
            setOpen(true);
          }}
          onPointerLeave={closeOnLeave}
          onClick={(event) => {
            clearClose();
            if (open && !pinned.current) {
              pinned.current = true;
              event.preventDefault();
            } else {
              pinned.current = !open;
            }
          }}
        >
          <CircleAlert aria-hidden="true" className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={heading}
        align="end"
        className="w-80 max-w-[calc(100vw-24px)] space-y-3 p-3"
        onPointerEnter={clearClose}
        onPointerLeave={closeOnLeave}
        onOpenAutoFocus={(event) => {
          if (!pinned.current) event.preventDefault();
        }}
      >
        <div className="space-y-1">
          <p className="text-sm font-semibold">{heading}</p>
          <p className="text-xs text-muted-foreground">
            {failed ? "Пересчёт не завершился. Проверьте синхронизацию зарплаты."
              : pending ? "Начисления пересчитываются." : descriptions[mark.state]}
          </p>
          {mark.reason && !pending && <p className="text-xs text-muted-foreground">{mark.reason}</p>}
        </div>
        {canReview && mark.syncedAt && mark.sourceState === "complete" && !pending && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`shift-review-reason-${shiftId}`} className="text-xs">Причина решения</Label>
              <Input
                id={`shift-review-reason-${shiftId}`}
                value={reason}
                onFocus={() => { pinned.current = true; }}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Обязательна для исключения"
                maxLength={1000}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={saving || mark.state === "included"} onClick={() => void save("include")}>Засчитать</Button>
              <Button size="sm" variant="outline" disabled={saving || mark.state === "excluded" || reason.trim().length < 3} onClick={() => void save("exclude")}>Не засчитывать</Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
