"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { restoreStaff, retryStaffTermination } from "../actions";

/** An unfinished «Восстановить»: shows the step error and continues the same restore. */
export function StaffRestoreStatus({
  uvrId,
  status,
}: {
  uvrId: string;
  status: { state: string; error: string | null; attempts: number };
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const error = status.state === "error";
  useEffect(() => {
    if (error && status.attempts >= 5) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [error, status.attempts, router]);
  const Icon = error ? AlertCircle : Loader2;
  return (
    <div className="space-y-3 border-t pt-4 text-sm" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 font-medium">Возврат сотрудника</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ${error ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
        >
          <Icon className={`size-3.5 ${error ? "" : "animate-spin motion-reduce:animate-none"}`} />
          {error ? "Требует внимания" : "В процессе"}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Доступ вернётся после восстановления записей Quick Resto и выдачи нового
        кода замка.
      </p>
      {error && status.error && (
        <p className="break-words text-xs leading-relaxed text-destructive">
          {status.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || status.state === "working"}
        onClick={() =>
          start(async () => {
            const result = await restoreStaff(uvrId);
            if (result.error) toast.error(result.error);
            else toast.success("Сотрудник восстановлен");
            router.refresh();
          })
        }
      >
        {busy ? "Проверяем…" : "Повторить"}
      </Button>
      {error && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            start(async () => {
              // Abandons the restore; the dismissal runs again and removes what was recovered.
              const result = await retryStaffTermination(uvrId);
              if (result.error) toast.error(result.error);
              else toast.success("Возврат отменён, доступы закрыты");
              router.refresh();
            })
          }
        >
          Отменить возврат
        </Button>
      )}
      </div>
    </div>
  );
}
