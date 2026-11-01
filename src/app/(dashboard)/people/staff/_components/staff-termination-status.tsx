"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle, Loader2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { retryStaffTermination } from "../actions";

export function StaffTerminationStatus({
  uvrId,
  status,
  doorNumbers = [],
}: {
  uvrId: string;
  doorNumbers?: number[];
  status: {
    state: string;
    error: string | null;
    door_revoked: boolean;
    shared_access: boolean;
    employee_id: number | null;
    guest_id: number | null;
    attempts: number;
  };
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const complete = status.state === "complete";
  const error = status.state === "error";
  const manualDoorCheck = status.door_revoked;
  useEffect(() => {
    if (complete || (status.state === "error" && status.attempts >= 5)) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [complete, status.state, status.attempts, router]);

  const Icon = error
    ? AlertCircle
    : !complete
      ? Loader2
      : manualDoorCheck
        ? AlertCircle
        : CheckCircle2;
  const label = error
    ? "Требует внимания"
    : !complete
      ? "В процессе"
      : manualDoorCheck
        ? "Проверить замок"
        : "Завершено";
  return (
    <details
      open={error || manualDoorCheck || !complete}
      className="group border-t pt-4 text-sm"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
        <span className="flex-1 font-medium">Закрытие доступов</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ${error ? "bg-destructive/10 text-destructive" : !complete ? "bg-muted text-muted-foreground" : manualDoorCheck ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"}`}
        >
          <Icon
            className={`size-3.5 ${!error && !complete ? "animate-spin motion-reduce:animate-none" : ""}`}
          />
          {label}
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="mt-4 space-y-3" role="status">
        <dl className="space-y-2 text-xs">
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Доступ к заведению</dt>
            <dd>Закрыт</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Quick Resto</dt>
            <dd>
              {status.shared_access
                ? "Сохранён для других заведений"
                : complete
                  ? !status.employee_id && !status.guest_id
                    ? "Связанных записей нет"
                    : "Удаление подтверждено"
                  : error
                    ? "Требует проверки"
                    : "Завершаем удаление"}
            </dd>
          </div>
          {manualDoorCheck && (
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Код замка в CRM</dt>
              <dd>Отозван</dd>
            </div>
          )}
        </dl>
        {status.shared_access && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Сотрудник работает в другом заведении аккаунта. Общий доступ Quick
            Resto и код замка сохранены.
          </p>
        )}
        {error && status.error && (
          <p className="break-words text-xs leading-relaxed text-destructive">
            {status.error}
          </p>
        )}
        {manualDoorCheck && (
          <p className="rounded-lg bg-amber-500/5 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            Если код был добавлен в физический замок, удалите{" "}
            {doorNumbers.length
              ? `пользователя № ${doorNumbers.join(", ")}`
              : "его"}{" "}
            из замка вручную.
          </p>
        )}
        {!complete && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || status.state === "working"}
            onClick={() =>
              start(async () => {
                const result = await retryStaffTermination(uvrId);
                if (result.error) toast.error(result.error);
                else toast.success("Удаление подтверждено");
                router.refresh();
              })
            }
          >
            {busy ? "Проверяем…" : "Продолжить проверку"}
          </Button>
        )}
      </div>
    </details>
  );
}
