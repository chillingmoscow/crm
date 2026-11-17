"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCasualEmployee, provisionCasualEmployee } from "../casual-actions";

export type CasualIssued = { name: string; roleName: string; pin: string };

async function copyPin(pin: string) {
  try {
    await navigator.clipboard.writeText(pin);
    toast.success("PIN скопирован");
  } catch {
    toast.error("Не удалось скопировать. Выделите код вручную");
  }
}

/**
 * «Добавить → Разовый». A casual worker counts as added once Quick Resto has
 * issued the code; if Quick Resto fails, the form stays open with a retry that
 * continues the same attempt (no duplicate in the till).
 */
export function CasualCreateForm({
  roles,
  onCancel,
  onIssued,
}: {
  roles: { id: string; name: string }[];
  onCancel: () => void;
  onIssued: (value: CasualIssued) => void;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = firstName.trim() && lastName.trim() && roleId;
  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = savedId
        ? await provisionCasualEmployee({ id: savedId, firstName, lastName })
        : await createCasualEmployee({ firstName, lastName, roleId });
      if (result.id) setSavedId(result.id);
      if (!result.pin) {
        setError(result.error ?? "Quick Resto не ответил");
        return;
      }
      router.refresh();
      onIssued({
        name: `${firstName.trim()} ${lastName.trim()}`,
        roleName: roles.find((r) => r.id === roleId)?.name ?? "",
        pin: result.pin,
      });
    });
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !pending) submit();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="casual-first" className="text-[13px] font-medium">
            Имя <span className="text-destructive">*</span>
          </Label>
          <Input
            id="casual-first"
            placeholder="Иван"
            value={firstName}
            disabled={!!savedId}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="casual-last" className="text-[13px] font-medium">
            Фамилия <span className="text-destructive">*</span>
          </Label>
          <Input
            id="casual-last"
            placeholder="Иванов"
            value={lastName}
            disabled={!!savedId}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="casual-role" className="text-[13px] font-medium">
          Должность <span className="text-destructive">*</span>
        </Label>
        <Select value={roleId} onValueChange={setRoleId} disabled={!roles.length || !!savedId}>
          <SelectTrigger id="casual-role">
            <SelectValue placeholder={roles.length ? "Выберите должность" : "Нет подходящих должностей"} />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!roles.length && (
          <p className="text-xs text-muted-foreground">
            Настройте в должности оплату за смену и связь с должностью Quick Resto.
          </p>
        )}
      </div>
      {error ? (
        <div
          role="alert"
          className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="font-medium">Не удалось завести в Quick Resto</p>
            <p className="text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Разовый выходит на смены без входа в Sheerly. Заведём его в Quick Resto с личным PIN,
          чтобы отметки на кассе шли в его зарплату. Гостя, бонусный счёт и чаты не создаём.
        </p>
      )}
      <div className="flex gap-3">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={pending}>
          Отмена
        </Button>
        <Button type="submit" className="flex-1" disabled={!ready || pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {savedId ? "Повторить" : "Создать"}
        </Button>
      </div>
    </form>
  );
}

/** PIN shown once the worker is set up in Quick Resto. */
export function CasualPinPanel({ issued, onDone }: { issued: CasualIssued; onDone: () => void }) {
  const first = issued.name.split(" ")[0] ?? issued.name;
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <p className="text-lg font-semibold">{issued.name}</p>
        <p className="text-sm text-muted-foreground">{issued.roleName} · разовый сотрудник</p>
      </div>
      <div className="flex justify-center gap-2" aria-label={`PIN ${issued.pin}`}>
        {issued.pin.split("").map((digit, i) => (
          <span
            key={i}
            className="flex h-16 w-[52px] items-center justify-center rounded-lg border bg-muted/60 text-3xl font-semibold tabular-nums"
          >
            {digit}
          </span>
        ))}
      </div>
      <p className="text-center text-sm leading-relaxed text-muted-foreground">
        Передайте код: {first} открывает и закрывает с ним личную смену на кассе. Код останется
        в списке сотрудников, в столбце «PIN кассы».
      </p>
      <div className="flex gap-3">
        <Button type="button" variant="outline" className="flex-1" onClick={() => void copyPin(issued.pin)}>
          <Copy className="size-4" />
          Скопировать
        </Button>
        <Button type="button" className="flex-1" onClick={onDone}>
          Готово
        </Button>
      </div>
    </div>
  );
}
