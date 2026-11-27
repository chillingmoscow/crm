"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { PhoneInput } from "@/components/ui/phone-input";
import { GENDER_OPTIONS, type Gender } from "@/lib/people/gender";
import { splitCasualName } from "@/lib/payroll/casual-name";
import { convertCasualToStaff } from "../casual-actions";
import { ChatInvitesSwitch } from "./chat-invites-switch";
import { telegramIdError } from "@/lib/people/telegram-id";

/**
 * «Перевести в штат» у разового в списке сотрудников (меню строки). Поля — как
 * в «Добавить → Создать»; учётная запись привязывается к той же записи
 * зарплаты, поэтому смены, начисления и выплаты остаются при человеке.
 */
export function CasualToStaffDrawer({
  open,
  onOpenChange,
  employee,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: { id: string; name: string; role_id?: string | null; hasPin: boolean; telegramId?: string | null };
  roles: { id: string; name: string }[];
}) {
  const router = useRouter();
  const named = splitCasualName(employee.name);
  const [firstName, setFirstName] = useState(named.firstName);
  const [lastName, setLastName] = useState(named.lastName);
  const [gender, setGender] = useState<Gender | "">("");
  const [phone, setPhone] = useState("");
  const [roleId, setRoleId] = useState(employee.role_id ?? "");
  const [chatInvites, setChatInvites] = useState(true);
  // ID, вписанный разовому, переходит в карточку штатного.
  const [telegramId, setTelegramId] = useState(employee.telegramId ?? "");
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = Boolean(firstName.trim() && lastName.trim() && gender && roleId);

  const submit = () => {
    if (!ready || pending) return;
    const tgError = telegramIdError(telegramId, chatInvites);
    setTelegramError(tgError);
    if (tgError) return;
    setError(null);
    startTransition(async () => {
      const result = await convertCasualToStaff({
        employeeId: employee.id,
        firstName,
        lastName,
        gender: gender as Gender,
        phone: phone || undefined,
        roleId,
        chatInvites,
        telegramId,
      });
      if (result.error || !result.userId) {
        setError(result.error ?? "Не удалось перевести сотрудника в штат");
        return;
      }
      const who = `${firstName.trim()} ${lastName.trim()}`;
      // Выданный при переводе код показываем сразу: его передают сотруднику.
      if (result.issuedPin)
        toast.success(`${who} теперь в штате. PIN кассы: ${result.issuedPin}`, { duration: 20000 });
      else toast.success(`${who} теперь в штате`);
      if (result.notice) toast.warning(result.notice);
      onOpenChange(false);
      router.push(`/people/staff/${result.userId}`);
    });
  };

  return (
    <EditDrawer
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title="Перевести в штат"
      description={employee.name}
      footer={
        <>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="submit" form="casual-to-staff" disabled={!ready || pending}>
            {pending ? "Переводим…" : "Перевести в штат"}
          </Button>
        </>
      }
    >
      <form
        id="casual-to-staff"
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="text-sm text-muted-foreground">
          Появится карточка сотрудника. Смены, начисления и выплаты разового останутся при нём,
          будущие смены перейдут на карточку.{" "}
          {employee.hasPin
            ? "PIN кассы не изменится."
            : "Кода кассы у него нет — Sheerly заведёт сотрудника в Quick Resto и выдаст PIN."}
        </p>
        {/* Пока идёт перевод, поля не правятся: ответ сервера про другие данные. */}
        <fieldset disabled={pending} className="grid min-w-0 gap-5">
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field id="convert-first" label="Имя" required>
            {(control) => (
              <Input {...control} aria-required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            )}
          </Field>
          <Field id="convert-last" label="Фамилия" required>
            {(control) => (
              <Input {...control} aria-required value={lastName} onChange={(e) => setLastName(e.target.value)} />
            )}
          </Field>
        </div>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field id="convert-gender" label="Пол" required>
            {(control) => (
              <OptionSelect
                {...control}
                aria-required
                value={gender}
                onValueChange={(v) => setGender(v as Gender)}
                placeholder="Выберите пол"
                options={GENDER_OPTIONS}
              />
            )}
          </Field>
          <Field id="convert-phone" label="Телефон">
            {(control) => <PhoneInput id={control.id} value={phone} onChange={setPhone} />}
          </Field>
        </div>
        <Field
          id="convert-role"
          label="Должность"
          required
          hint={roleId && roleId !== employee.role_id ? "Условия оплаты новой должности — с сегодняшнего дня" : undefined}
        >
          {(control) => (
            <OptionSelect
              {...control}
              aria-required
              value={roleId}
              onValueChange={setRoleId}
              placeholder="Выберите должность"
              options={roles.map((r) => ({ value: r.id, label: r.name }))}
            />
          )}
        </Field>
        <ChatInvitesSwitch
          id="convert-chats"
          checked={chatInvites}
          onCheckedChange={setChatInvites}
          telegramId={telegramId}
          onTelegramIdChange={(value) => {
            setTelegramId(value);
            setTelegramError(null);
          }}
          telegramIdError={telegramError}
        />
        </fieldset>
        {pending && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            {employee.hasPin
              ? "Создаём карточку и переносим смены…"
              : "Заводим сотрудника в Quick Resto, создаём карточку и переносим смены. Это может занять до минуты…"}
          </p>
        )}
        {error && !pending && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </EditDrawer>
  );
}
