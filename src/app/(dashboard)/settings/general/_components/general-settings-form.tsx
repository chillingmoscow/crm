"use client";

import { useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { unwrapAction } from "@/lib/actions/result";
import { Button } from "@/components/ui/button";
import { updateGeneralSettings } from "../actions";

/** Форма общих настроек: ошибку сохранения показывает тостом по-русски. */
export function GeneralSettingsForm({ children }: { children: ReactNode }) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="max-w-xl rounded-lg border bg-background p-5"
      // onSubmit, а не action: React сбрасывает форму после action-функции,
      // и поля вернулись бы к старым значениям до перезагрузки страницы.
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            unwrapAction(await updateGeneralSettings(form));
            toast.success("Настройки сохранены");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Не удалось сохранить настройки");
          }
        });
      }}
    >
      {children}
      <div className="mt-5 flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Сохраняем…" : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}
