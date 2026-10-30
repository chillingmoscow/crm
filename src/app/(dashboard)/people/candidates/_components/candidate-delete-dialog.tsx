"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { candidateError } from "@/lib/candidates/errors";

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

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm gap-5 rounded-xl p-5">
        <AlertDialogHeader className="gap-2 space-y-0 text-left">
          <AlertDialogTitle className="flex items-center gap-2 text-base leading-6">
            <AlertTriangle
              className="size-5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            {count === 1 ? "Удалить анкету?" : "Удалить анкеты?"}
          </AlertDialogTitle>
          <AlertDialogDescription className="break-words leading-6">
            {name ? (
              <>Анкета «{name}» и связанные с ней данные будут полностью удалены.</>
            ) : (
              <>Выбранные анкеты ({count}) и связанные с ними данные будут полностью удалены.</>
            )}
            {" "}Действие необратимо.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {restriction || error ? (
          <p role="alert" className="text-sm leading-5 text-destructive">
            {restriction || error}
          </p>
        ) : null}
        <AlertDialogFooter className="flex-row justify-end gap-2 space-x-0 sm:space-x-0">
          <AlertDialogCancel disabled={pending} className="mt-0 h-9 px-3 text-sm">
            Отмена
          </AlertDialogCancel>
          <Button
            variant="destructive"
            size="sm"
            disabled={pending || !!restriction}
            onClick={() =>
              startTransition(async () => {
                setError("");
                try {
                  await onConfirm();
                  onOpenChange(false);
                } catch (e) {
                  setError(candidateError(e, count === 1 ? "Не удалось удалить анкету." : "Не удалось удалить анкеты."));
                }
              })
            }
          >
            {pending ? "Удаляем…" : "Удалить"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
