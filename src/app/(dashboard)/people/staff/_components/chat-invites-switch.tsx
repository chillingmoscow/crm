"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * «Пригласить в чаты Telegram» в формах добавления сотрудника. Включено —
 * бот присылает в чат приглашений одноразовые ссылки в чаты должности (как при
 * найме кандидата). Для разового по умолчанию выключено: зовут осознанно.
 */
export function ChatInvitesSwitch({
  id,
  checked,
  onCheckedChange,
  disabled,
  hint = "Бот пришлёт в чат приглашений ссылки в чаты должности",
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
        <Label htmlFor={id}>Пригласить в чаты Telegram</Label>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
