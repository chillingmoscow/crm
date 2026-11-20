"use client";

import { useEffect, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type ArchiveImpact = {
  label: string;
  count: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Что архивируем, в винительном падеже («заведение» / «контрагента» / …).
   * Идёт строкой, чтобы не плодить enum'ы.
   */
  entityGenitive: string;
  /** Имя для подтверждения ввода и для заголовка. */
  entityName: string;
  /** Список связанных сущностей с числами — что сохранится в архиве. */
  impact: ArchiveImpact[];
  /** Что произойдёт. По умолчанию — общая формулировка «это не удаление». */
  description?: string;
  /**
   * Возврат `{ error }` оставляет диалог открытым и показывает ошибку в нём
   * (DS «Modal»: ошибка сервера — внутри диалога).
   */
  onConfirm: () => Promise<{ error: string | null } | void>;
};

/**
 * Подтверждение «В архив» на общем `ConfirmDialog`: говорит, что это не
 * удаление, что сохранится и где потом искать. Название вводится руками —
 * архив убирает сущность из всех выборов, случайный клик дорого стоит.
 */
export function ArchiveConfirmDialog({
  open,
  onOpenChange,
  entityGenitive,
  entityName,
  impact,
  description,
  onConfirm,
}: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const matches = input.trim() === entityName.trim();

  useEffect(() => {
    if (!open) {
      setInput("");
      setError(null);
    }
  }, [open]);

  const visibleImpact = impact.filter((row) => row.count > 0);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Архивировать ${entityGenitive} «${entityName}»?`}
      description={
        description ??
        "Это не удаление: запись скроется из списков и выборов, связанные данные сохранятся. Вернуть её можно из архива раздела в любой момент"
      }
      confirmLabel={`Архивировать ${entityGenitive}`}
      pendingLabel="Архивируем…"
      busy={isPending}
      confirmDisabled={!matches}
      error={error}
      onConfirm={() => {
        setError(null);
        startTransition(async () => {
          const result = await onConfirm();
          if (result && result.error) setError(result.error);
        });
      }}
    >
      {visibleImpact.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">Сохранится в архиве</p>
          <ul className="divide-y rounded-[10px] border text-sm">
            {visibleImpact.map((row) => (
              <li key={row.label} className="flex justify-between gap-4 px-3 py-2">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium tabular-nums">{row.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Field id="archive-confirm-input" label="Введите название для подтверждения">
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
    </ConfirmDialog>
  );
}
