"use client";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TELEGRAM_ID_HINT } from "@/lib/people/telegram-id";

/**
 * «Пригласить в чаты Telegram» в формах добавления сотрудника. Включено —
 * бот присылает в чат приглашений одноразовые ссылки в чаты должности (как при
 * найме кандидата). Для разового по умолчанию выключено: зовут осознанно.
 *
 * С `onTelegramIdChange` при включённом переключателе появляется обязательное
 * поле Telegram ID: без него бот не исключит человека из чатов при увольнении.
 * В «Пригласить» поля нет — ID сотрудник вписывает сам при первом входе.
 */
export function ChatInvitesSwitch({
  id,
  checked,
  onCheckedChange,
  disabled,
  hint = "Бот пришлёт в чат приглашений ссылки в чаты должности",
  telegramId,
  onTelegramIdChange,
  telegramIdError,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
  telegramId?: string;
  onTelegramIdChange?: (value: string) => void;
  telegramIdError?: string | null;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
          <Label htmlFor={id}>Пригласить в чаты Telegram</Label>
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {checked && onTelegramIdChange ? (
        <Field
          id={`${id}-telegram`}
          label="Telegram ID"
          required
          hint={TELEGRAM_ID_HINT}
          error={telegramIdError ?? undefined}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              autoComplete="off"
              placeholder="123456789"
              aria-required
              value={telegramId ?? ""}
              disabled={disabled}
              onChange={(e) => onTelegramIdChange(e.target.value.replace(/\s+/g, ""))}
            />
          )}
        </Field>
      ) : null}
    </div>
  );
}
