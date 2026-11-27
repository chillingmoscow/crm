"use client";

import { type ReactNode } from "react";
import { toast } from "sonner";

import { unwrapAction } from "@/lib/actions/result";
import { Button } from "@/components/ui/button";
import { useSaveStatus } from "@/components/ui/button-status";
import { updateGeneralSettings } from "../actions";

/** Форма общих настроек: ошибку сохранения показывает тостом по-русски. */
export function GeneralSettingsForm({ children }: { children: ReactNode }) {
  const [status, run] = useSaveStatus();
  return (
    <form
      className="max-w-xl rounded-lg border bg-background p-5"
      // onSubmit, а не action: React сбрасывает форму после action-функции,
      // и поля вернулись бы к старым значениям до перезагрузки страницы.
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(async () => {
          try {
            unwrapAction(await updateGeneralSettings(form));
            toast.success("Настройки сохранены");
            return true;
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Не удалось сохранить настройки");
            return false;
          }
        });
      }}
    >
      {children}
      <div className="mt-5 flex justify-end">
        <Button type="submit" status={status} className="min-w-32">
          Сохранить
        </Button>
      </div>
    </form>
  );
}
