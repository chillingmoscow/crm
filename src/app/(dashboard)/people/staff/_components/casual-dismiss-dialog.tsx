"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TELEGRAM_ID_HINT, telegramIdError } from "@/lib/people/telegram-id";
import type { CasualStaffRow } from "@/lib/payroll/casual-list";
import { dismissCasualEmployee } from "../casual-actions";

/**
 * «Уволить» разового и «Повторить» незавершённое увольнение. Telegram ID —
 * прямо здесь: без него бот не исключит человека из чатов. Если человека в
 * чатах не было, отмечают «Не состоит в чатах», и шаг чатов пропускается.
 */
export function CasualDismissDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: CasualStaffRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [telegramId, setTelegramId] = useState("");
  const [withoutChats, setWithoutChats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const retry = employee?.dismissal != null;

  useEffect(() => {
    if (!open) return;
    setTelegramId(employee?.telegramId ?? "");
    setWithoutChats(false);
    setError(null);
  }, [open, employee]);

  const empty = telegramId.trim() === "";
  const confirm = () => {
    if (!employee || pending) return;
    // Новое увольнение: нужен ID или отметка «не состоит в чатах». Повтор
    // не требует — шаг чатов мог уже пройти, сервер скажет, если нет.
    const tgError = empty && !withoutChats && !retry
      ? "Укажите Telegram ID или отметьте, что человек не состоит в чатах"
      : telegramIdError(telegramId, false);
    if (tgError) {
      setError(tgError);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await dismissCasualEmployee({
        id: employee.id,
        telegramId: empty ? null : telegramId,
        withoutChats: empty && withoutChats,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
      if (result.done) toast.success(`${employee.name} уволен(а): доступ в Quick Resto и чатах закрыт`);
      else
        toast.warning(
          `${employee.name} уволен(а), но доступ закрыт не полностью: ${result.pending}. Sheerly повторит сам, строка останется в списке с «Повторить»`,
          { duration: 12000 },
        );
    });
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={retry ? `Завершить увольнение «${employee?.name ?? ""}»?` : `Уволить «${employee?.name ?? ""}»?`}
      description={
        retry
          ? "Sheerly ещё раз проверит Quick Resto и чаты и закроет то, что осталось."
          : "Сотрудник Quick Resto будет удалён — PIN перестанет работать. Бот исключит человека из всех чатов организации. Смены, начисления и выплаты останутся в истории."
      }
      confirmLabel={retry ? "Повторить" : "Уволить сотрудника"}
      pendingLabel={retry ? "Повторяем…" : "Увольняем…"}
      destructive={!retry}
      busy={pending}
      error={error}
      onConfirm={confirm}
    >
      <div className="grid gap-4">
        <Field id="casual-dismiss-telegram" label="Telegram ID" hint={TELEGRAM_ID_HINT}>
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              autoComplete="off"
              placeholder="123456789"
              value={telegramId}
              disabled={pending}
              onChange={(e) => {
                setTelegramId(e.target.value.replace(/\s+/g, ""));
                setError(null);
              }}
            />
          )}
        </Field>
        {empty ? (
          <div className="flex items-start gap-2">
            <Checkbox
              id="casual-dismiss-no-chats"
              checked={withoutChats}
              disabled={pending}
              onCheckedChange={(value) => {
                setWithoutChats(value === true);
                setError(null);
              }}
            />
            <Label htmlFor="casual-dismiss-no-chats" className="font-normal leading-snug">
              Не состоит в рабочих чатах Telegram — исключать не нужно
            </Label>
          </div>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
