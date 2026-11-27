"use client";

import { useEffect, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { deleteImpactToConsequences } from "@/components/ui/dialog-tone";

export type DeleteImpact = {
  label: string;
  count: number;
  /**
   * cascade — будет уничтожено вместе с сущностью.
   * unbind — отвяжется (становится «без заведения»/«без контрагента»…),
   * данные сохраняются.
   */
  tone: "cascade" | "unbind";
};

export type DeleteRestriction = {
  label: string;
  count: number;
  /** Подсказка пользователю как разблокировать (1 короткая фраза). */
  hint?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Что удаляем, в винительном падеже («заведение», «юрлицо»). */
  entityGenitive: string;
  entityName: string;
  impact: DeleteImpact[];
  /**
   * Если непусто — диалог объясняет, что мешает удалению, кнопка
   * подтверждения выключена. На сервере проверяется ещё раз.
   */
  restrictedBy: DeleteRestriction[];
  /** Возврат `{ error }` оставляет диалог открытым с ошибкой внутри. */
  onConfirm: () => Promise<{ error: string | null } | void>;
};

/**
 * Безвозвратное удаление на общем `ConfirmDialog`: что удалится вместе с
 * записью, что отвяжется, что мешает удалить. Название вводится руками.
 */
export function HardDeleteConfirmDialog({
  open,
  onOpenChange,
  entityGenitive,
  entityName,
  impact,
  restrictedBy,
  onConfirm,
}: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const matches = input.trim() === entityName.trim();
  const blocked = restrictedBy.length > 0;

  useEffect(() => {
    if (!open) {
      setInput("");
      setError(null);
    }
  }, [open]);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Удалить ${entityGenitive} «${entityName}» навсегда?`}
      description={
        blocked
          ? "Сейчас удалить нельзя: к записи привязаны данные, которые без неё потеряют смысл. Архив скроет запись и сохранит историю"
          : "Если сомневаетесь, отправьте запись в архив."
      }
      icon={Trash2}
      consequences={blocked ? undefined : deleteImpactToConsequences(impact)}
      confirmLabel="Удалить навсегда"
      pendingLabel="Удаляем…"
      destructive
      busy={isPending}
      confirmDisabled={blocked || !matches}
      error={error}
      onConfirm={() => {
        setError(null);
        startTransition(async () => {
          const result = await onConfirm();
          if (result && result.error) setError(result.error);
        });
      }}
    >
      {blocked ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Мешает удалению</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {restrictedBy.map((row) => (
              <li key={row.label}>
                <span>
                  {row.label}: <span className="tabular-nums">{row.count}</span>
                </span>
                {row.hint ? (
                  <span className="block text-xs text-muted-foreground">{row.hint}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Field id="hard-delete-confirm-input" label="Введите название для подтверждения">
          {(control) => (
            <Input
              {...control}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={entityName}
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
      )}
    </ConfirmDialog>
  );
}
