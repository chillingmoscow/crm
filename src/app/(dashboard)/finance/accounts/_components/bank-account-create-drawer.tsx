"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { useDiscardGuard } from "@/components/shared/discard-changes-dialog";
import { createBankAccount } from "@/lib/finance/bank-accounts";
import {
  bankAccountFormDirty,
  bankAccountPayload,
  emptyBankAccountForm,
  validateBankAccountForm,
  type BankAccountFormErrors,
  type BankAccountFormState,
} from "@/lib/finance/bank-account-form";
import type { BankAccountGroupRow, BankAccountRow } from "@/types/finance";
import {
  BankAccountFields,
  type BankAccountLegalEntityOption,
  type BankAccountVenueOption,
} from "./bank-account-form";

/**
 * Только что созданный счёт — для формы, которая сразу его подставляет
 * (например, операция в «Транзакциях»), не дожидаясь обновления списка.
 */
export type CreatedBankAccount = {
  id: string;
  legal_entity_id: string;
  name: string;
  type: BankAccountRow["type"];
  currency: string;
};

/**
 * Панель «Новый счёт». Баланс здесь не задаётся: он складывается из операций.
 * После создания открывается карточка счёта, а если передан `onCreated` —
 * панель просто закрывается и отдаёт счёт вызвавшей форме.
 */
export function BankAccountCreateDrawer({
  open,
  onOpenChange,
  legalEntities,
  venues,
  groups,
  defaultLegalEntityId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legalEntities: BankAccountLegalEntityOption[];
  venues: BankAccountVenueOption[];
  groups: BankAccountGroupRow[];
  /** Юрлицо, выбранное в фильтре списка, или единственное в аккаунте. */
  defaultLegalEntityId: string | null;
  onCreated?: (account: CreatedBankAccount) => void;
}) {
  const router = useRouter();
  const initial = emptyBankAccountForm({
    legal_entity_id: defaultLegalEntityId ?? (legalEntities.length === 1 ? legalEntities[0].id : ""),
  });
  const [form, setForm] = useState<BankAccountFormState>(initial);
  const [errors, setErrors] = useState<BankAccountFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const dirty = bankAccountFormDirty(form, initial);
  const { guard, dialog } = useDiscardGuard(dirty, "Новый счёт не будет создан.");

  const reset = () => {
    setForm(initial);
    setErrors({});
    setServerError(null);
  };
  const close = () => {
    onOpenChange(false);
    reset();
  };

  const change = (patch: Partial<BankAccountFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch) as (keyof BankAccountFormState)[]) delete next[key];
      return next;
    });
  };

  const submit = () => {
    const found = validateBankAccountForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setServerError(null);
    startTransition(async () => {
      try {
        const payload = bankAccountPayload(form);
        const { id, error } = await createBankAccount(payload);
        if (error || !id) {
          setServerError(error ?? "Не удалось создать счёт. Повторите попытку");
          return;
        }
        toast.success(`Счёт «${payload.name}» создан`);
        close();
        if (onCreated)
          onCreated({
            id,
            legal_entity_id: payload.legal_entity_id,
            name: payload.name,
            type: payload.type,
            currency: payload.currency ?? "RUB",
          });
        else router.push(`/finance/accounts/${id}`);
      } catch {
        setServerError("Не удалось создать счёт. Проверьте соединение и повторите");
      }
    });
  };

  const section = (key: string, title: string, children: ReactNode) => (
    <DrawerSection key={key} title={title}>
      {children}
    </DrawerSection>
  );

  return (
    <>
      <EditDrawer
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else if (!isPending) guard(close);
        }}
        title="Новый счёт"
        description="Баланс складывается из операций, здесь его не задают"
        footer={
          <>
            <Button variant="outline" onClick={() => guard(close)} disabled={isPending}>
              Отмена
            </Button>
            <Button onClick={submit} disabled={isPending} className="min-w-32">
              {isPending ? "Создаём…" : "Создать счёт"}
            </Button>
          </>
        }
      >
        <form
          // contents: разделы — прямые блоки тела панели, отступы между ними задаёт панель.
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
          <BankAccountFields
            idPrefix="new-ba"
            mode="create"
            form={form}
            onChange={change}
            errors={errors}
            readOnly={isPending}
            legalEntities={legalEntities}
            venues={venues}
            groups={groups}
            section={section}
          />
          {serverError ? (
            <p role="alert" className="text-xs text-destructive">
              {serverError}
            </p>
          ) : null}
        </form>
      </EditDrawer>
      {dialog}
    </>
  );
}
