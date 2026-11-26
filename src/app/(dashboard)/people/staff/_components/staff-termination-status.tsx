"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Disclosure } from "@/components/shared/disclosure";
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
  // Раскрыт, пока что-то требует внимания; когда статус снова требует
  // внимания (ошибка, ручная проверка замка), блок раскрывается сам.
  const attention = error || manualDoorCheck || !complete;
  const [open, setOpen] = useState(attention);
  useEffect(() => {
    if (attention) setOpen(true);
  }, [attention]);
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
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      chevron="end"
      className="border-t pt-4 text-sm"
      triggerClassName="focus-visible:ring-brand"
      title={
        <>
        <span className="flex-1 font-medium">Закрытие доступов</span>
        <StatusBadge
          tone={error ? "danger" : !complete ? "neutral" : manualDoorCheck ? "warning" : "success"}
          icon={
            <Icon
              className={!error && !complete ? "animate-spin motion-reduce:animate-none" : undefined}
            />
          }
        >
          {label}
        </StatusBadge>
        </>
      }
    >
      <div className="space-y-3 pt-4" role="status">
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
    </Disclosure>
  );
}
