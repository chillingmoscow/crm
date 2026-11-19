"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertCircle, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  ProfileTabsList,
  Tabs,
  TabsContent,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useDiscardGuard } from "@/components/shared/discard-changes-dialog";
import {
  createStaffWithoutEmail,
  inviteStaff,
  type PendingInvitation,
  type StaffMember,
} from "../actions";
import { createCasualEmployee, provisionCasualEmployee } from "../casual-actions";

/**
 * Панель «Новый сотрудник» (кнопка «Добавить» в списке сотрудников).
 * Три способа: карточка без входа в Sheerly, приглашение по email и
 * разовый сотрудник с PIN кассы. Панель-форма по правилам
 * `docs/design-system.md` § «Боковая панель»: поля в теле, кнопки только
 * в подвале, PIN разового показывается в этой же панели.
 */

const inviteSchema = z.object({
  email: z.string().email("Некорректный email"),
  roleId: z.string().min(1, "Выберите должность"),
});
type InviteForm = z.infer<typeof inviteSchema>;

const createSchema = z.object({
  firstName: z.string().min(1, "Укажите имя"),
  lastName: z.string().min(1, "Укажите фамилию"),
  phone: z.string().optional(),
  roleId: z.string().min(1, "Выберите должность"),
});
type CreateForm = z.infer<typeof createSchema>;

export type AddStaffMode = "manual" | "email" | "casual";
type Role = { id: string; name: string };
type CasualIssued = { name: string; roleName: string; pin: string };

const FORM_ID: Record<AddStaffMode, string> = {
  manual: "add-staff-manual",
  email: "add-staff-invite",
  casual: "add-staff-casual",
};

const hasText = (values: Record<string, string | undefined>) =>
  Object.values(values).some((value) => Boolean(value?.trim()));

async function copyPin(pin: string) {
  try {
    await navigator.clipboard.writeText(pin);
    toast.success("PIN скопирован");
  } catch {
    toast.error("Не удалось скопировать. Выделите код вручную");
  }
}

/** Подпись над полем, поле, ошибка или подсказка под ним. */
function FormField({
  id,
  label,
  required,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * «Добавить → Разовый». Разовый считается добавленным, когда Quick Resto
 * выдал PIN; если Quick Resto не ответил, форма остаётся с повтором, который
 * продолжает ту же попытку (второго сотрудника в кассе не появится).
 */
function useCasualCreate(roles: Role[], onIssued: (value: CasualIssued) => void) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = Boolean(firstName.trim() && lastName.trim() && roleId);
  const submit = () => {
    if (!ready || pending) return;
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
  };
  return {
    roles,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    roleId,
    setRoleId,
    retry: savedId !== null,
    error,
    pending,
    ready,
    filled: hasText({ firstName, lastName, roleId }),
    submit,
  };
}
type CasualCreate = ReturnType<typeof useCasualCreate>;

function CasualCreateFields({ form }: { form: CasualCreate }) {
  const locked = form.retry || form.pending;
  return (
    <form
      id={FORM_ID.casual}
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        form.submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="casual-first" label="Имя" required>
          <Input
            id="casual-first"
            placeholder="Иван"
            aria-required
            value={form.firstName}
            disabled={locked}
            onChange={(e) => form.setFirstName(e.target.value)}
          />
        </FormField>
        <FormField id="casual-last" label="Фамилия" required>
          <Input
            id="casual-last"
            placeholder="Иванов"
            aria-required
            value={form.lastName}
            disabled={locked}
            onChange={(e) => form.setLastName(e.target.value)}
          />
        </FormField>
      </div>
      <FormField
        id="casual-role"
        label="Должность"
        required
        hint={
          form.roles.length
            ? undefined
            : "Настройте в должности оплату за смену и связь с должностью Quick Resto"
        }
      >
        <OptionSelect
          id="casual-role"
          value={form.roleId}
          onValueChange={form.setRoleId}
          disabled={!form.roles.length || locked}
          placeholder={form.roles.length ? "Выберите должность" : "Нет подходящих должностей"}
          options={form.roles.map((r) => ({ value: r.id, label: r.name }))}
        />
      </FormField>
      {form.error ? (
        <div
          role="alert"
          className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="font-medium">Не удалось завести в Quick Resto</p>
            <p className="text-muted-foreground">{form.error}</p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Без входа в Sheerly. Получит PIN кассы в Quick Resto
        </p>
      )}
    </form>
  );
}

/** PIN, выданный Quick Resto, — экран результата внутри той же панели. */
function CasualPinResult({ issued }: { issued: CasualIssued }) {
  const first = issued.name.split(" ")[0] ?? issued.name;
  return (
    <div className="space-y-5 pt-2">
      <div className="flex justify-center gap-2" role="group" aria-label={`PIN ${issued.pin}`}>
        {issued.pin.split("").map((digit, i) => (
          <span
            key={i}
            aria-hidden
            className="flex h-16 w-[52px] items-center justify-center rounded-lg border bg-muted/60 text-[28px] font-semibold tabular-nums"
          >
            {digit}
          </span>
        ))}
      </div>
      <p className="text-center text-sm leading-relaxed text-muted-foreground">
        Передайте PIN: с ним {first} открывает и закрывает личную смену на кассе. PIN
        останется в списке сотрудников, в столбце «PIN кассы».
      </p>
    </div>
  );
}

export function AddStaffDrawer({
  open,
  onOpenChange,
  roles,
  casualRoles,
  venueId,
  defaultMode,
  onInvited,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
  /** null — разовые недоступны, вкладки «Разовый» нет. */
  casualRoles: Role[] | null;
  venueId: string;
  defaultMode: AddStaffMode;
  onInvited: (invitation: PendingInvitation) => void;
  onCreated: (member: StaffMember) => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AddStaffMode>(
    defaultMode === "casual" && !casualRoles ? "manual" : defaultMode,
  );
  const [issued, setIssued] = useState<CasualIssued | null>(null);
  const [pending, startTransition] = useTransition();

  const manual = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { firstName: "", lastName: "", phone: "", roleId: "" },
  });
  const invite = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", roleId: "" },
  });
  const casual = useCasualCreate(casualRoles ?? [], setIssued);

  const busy = pending || casual.pending;
  // Закрытие заполненной формы спрашивает подтверждение. Экран PIN — нет:
  // разовый уже добавлен, PIN остаётся в списке.
  const filled =
    hasText(manual.watch()) || hasText(invite.watch()) || casual.filled;
  const { guard, dialog } = useDiscardGuard(!issued && filled);
  const close = () => onOpenChange(false);
  const requestClose = () => {
    if (busy) return;
    if (issued) close();
    else guard(close);
  };

  const onCreate = (values: CreateForm) => {
    startTransition(async () => {
      const result = await createStaffWithoutEmail({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone || null,
        roleId: values.roleId,
        venueId,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.member) onCreated(result.member);
      toast.success(`Сотрудник «${values.firstName} ${values.lastName}» добавлен`);
      close();
    });
  };

  const onInvite = (values: InviteForm) => {
    startTransition(async () => {
      const result = await inviteStaff({
        email: values.email,
        roleId: values.roleId,
        venueId,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.invitation) onInvited(result.invitation);
      toast.success(`Приглашение отправлено на ${values.email}`);
      close();
      router.refresh();
    });
  };

  const roleOptions = roles.map((r) => ({ value: r.id, label: r.name }));
  const manualErrors = manual.formState.errors;
  const inviteErrors = invite.formState.errors;

  const footer = issued ? (
    <>
      <Button variant="outline" onClick={() => void copyPin(issued.pin)}>
        <Copy />
        Скопировать PIN
      </Button>
      <Button onClick={close}>Готово</Button>
    </>
  ) : (
    <>
      <Button variant="outline" disabled={busy} onClick={requestClose}>
        Отмена
      </Button>
      {mode === "manual" && (
        <Button type="submit" form={FORM_ID.manual} disabled={busy}>
          {pending ? "Создаём…" : "Создать сотрудника"}
        </Button>
      )}
      {mode === "email" && (
        <Button type="submit" form={FORM_ID.email} disabled={busy}>
          {pending ? "Отправляем…" : "Отправить приглашение"}
        </Button>
      )}
      {mode === "casual" && (
        <Button type="submit" form={FORM_ID.casual} disabled={busy || !casual.ready}>
          {casual.pending ? "Создаём…" : casual.retry ? "Повторить" : "Создать разового"}
        </Button>
      )}
    </>
  );

  return (
    <>
      <EditDrawer
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else requestClose();
        }}
        title={issued ? "PIN кассы" : "Новый сотрудник"}
        description={
          issued
            ? [issued.name, issued.roleName, "разовый сотрудник"].filter(Boolean).join(" · ")
            : undefined
        }
        footer={footer}
      >
        {issued ? (
          <CasualPinResult issued={issued} />
        ) : (
          <Tabs value={mode} onValueChange={(v) => setMode(v as AddStaffMode)}>
            <ProfileTabsList>
              <TabsTrigger value="manual" disabled={busy}>
                Создать
              </TabsTrigger>
              <TabsTrigger value="email" disabled={busy}>
                Пригласить
              </TabsTrigger>
              {casualRoles && (
                <TabsTrigger value="casual" disabled={busy}>
                  Разовый
                </TabsTrigger>
              )}
            </ProfileTabsList>

            <TabsContent value="manual">
              <form
                id={FORM_ID.manual}
                onSubmit={manual.handleSubmit(onCreate)}
                className="grid gap-5"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    id="create-first"
                    label="Имя"
                    required
                    error={manualErrors.firstName?.message}
                  >
                    <Input
                      id="create-first"
                      placeholder="Иван"
                      aria-required
                      aria-invalid={!!manualErrors.firstName}
                      {...manual.register("firstName")}
                    />
                  </FormField>
                  <FormField
                    id="create-last"
                    label="Фамилия"
                    required
                    error={manualErrors.lastName?.message}
                  >
                    <Input
                      id="create-last"
                      placeholder="Иванов"
                      aria-required
                      aria-invalid={!!manualErrors.lastName}
                      {...manual.register("lastName")}
                    />
                  </FormField>
                </div>
                <FormField id="create-phone" label="Телефон">
                  <Controller
                    control={manual.control}
                    name="phone"
                    render={({ field }) => (
                      <PhoneInput
                        id="create-phone"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                </FormField>
                <FormField
                  id="create-role"
                  label="Должность"
                  required
                  error={manualErrors.roleId?.message}
                >
                  <Controller
                    control={manual.control}
                    name="roleId"
                    render={({ field }) => (
                      <OptionSelect
                        id="create-role"
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder="Выберите должность"
                        options={roleOptions}
                      />
                    )}
                  />
                </FormField>
                <p className="text-xs text-muted-foreground">
                  Без входа в Sheerly. Доступ можно выдать позже в карточке
                </p>
              </form>
            </TabsContent>

            <TabsContent value="email">
              <form
                id={FORM_ID.email}
                onSubmit={invite.handleSubmit(onInvite)}
                className="grid gap-5"
              >
                <FormField
                  id="inv-email"
                  label="Email сотрудника"
                  required
                  error={inviteErrors.email?.message}
                >
                  <Input
                    id="inv-email"
                    type="email"
                    placeholder="employee@example.com"
                    aria-required
                    aria-invalid={!!inviteErrors.email}
                    {...invite.register("email")}
                  />
                </FormField>
                <FormField
                  id="inv-role"
                  label="Должность"
                  required
                  error={inviteErrors.roleId?.message}
                >
                  <Controller
                    control={invite.control}
                    name="roleId"
                    render={({ field }) => (
                      <OptionSelect
                        id="inv-role"
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder="Выберите должность"
                        options={roleOptions}
                      />
                    )}
                  />
                </FormField>
                <p className="text-xs text-muted-foreground">
                  Сотрудник получит письмо и сам заполнит профиль
                </p>
              </form>
            </TabsContent>

            {casualRoles && (
              <TabsContent value="casual">
                <CasualCreateFields form={casual} />
              </TabsContent>
            )}
          </Tabs>
        )}
      </EditDrawer>
      {dialog}
    </>
  );
}
