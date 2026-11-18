"use client";

import { useEffect, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { candidateError } from "@/lib/candidates/errors";
import { pluralRu } from "@/lib/format/plural";

/** Удаление одной или нескольких анкет навсегда — общий `ConfirmDialog`. */
export function CandidateDeleteDialog({
  open,
  onOpenChange,
  name,
  count = 1,
  restriction,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name?: string;
  count?: number;
  restriction?: string;
  onConfirm: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) setError("");
  }, [open]);
  const single = count === 1;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        single
          ? name
            ? `Удалить анкету «${name}»?`
            : "Удалить анкету?"
          : `Удалить ${count} ${pluralRu(count, "анкету", "анкеты", "анкет")}?`
      }
      description={
        single
          ? "Анкета, комментарии, файлы и история будут удалены. Действие необратимо."
          : "Выбранные анкеты, их комментарии, файлы и история будут удалены. Действие необратимо."
      }
      confirmLabel={
        single
          ? "Удалить анкету"
          : `Удалить ${count} ${pluralRu(count, "анкету", "анкеты", "анкет")}`
      }
      pendingLabel="Удаляем…"
      destructive
      busy={pending}
      restriction={restriction}
      error={error}
      onConfirm={() =>
        startTransition(async () => {
          setError("");
          try {
            await onConfirm();
            onOpenChange(false);
          } catch (e) {
            setError(
              candidateError(
                e,
                single
                  ? "Не удалось удалить анкету"
                  : "Не удалось удалить анкеты",
              ),
            );
          }
        })
      }
    />
  );
}
