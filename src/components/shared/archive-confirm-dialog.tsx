"use client";

import { useEffect, useState, useTransition } from "react";
import { Archive } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ArchiveImpact = { label: string; count: number };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Грамматическое склонение в шапке («заведения» / «контрагента» / …).
   * Идёт строкой, чтобы не плодить enum'ы.
   */
  entityGenitive: string;
  /** Имя для подтверждения ввода и для строки заголовка. */
  entityName: string;
  /** Список связанных сущностей с числами — что сохранится в архиве. */
  impact: ArchiveImpact[];
  /** Что произойдёт. Поверх стандартной «всё сохранится» формулировки. */
  description?: string;
  onConfirm: () => Promise<{ error: string | null } | void>;
};

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
  const [isPending, startTransition] = useTransition();
  const matches = input.trim() === entityName.trim();

  useEffect(() => {
    if (!open) setInput("");
  }, [open]);

  const visibleImpact = impact.filter((row) => row.count > 0);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-muted-foreground" />
            Архивировать {entityGenitive}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {description ??
                  "Скрыть из всех списков и переключателей. Связанные данные сохраняются и продолжают существовать — заведение можно восстановить в любой момент."}
              </p>
              <p className="text-sm">
                Архив доступен только владельцу аккаунта.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {visibleImpact.length > 0 ? (
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Сохранится в архиве:
            </p>
            <ul className="space-y-0.5 text-sm">
              {visibleImpact.map((row) => (
                <li key={row.label} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium tabular-nums">{row.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="archive-confirm-input" className="text-sm">
            Для подтверждения введите название:{" "}
            <span className="font-medium text-foreground">{entityName}</span>
          </Label>
          <Input
            id="archive-confirm-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={entityName}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            disabled={!matches || isPending}
            onClick={(e) => {
              e.preventDefault();
              startTransition(async () => {
                await onConfirm();
              });
            }}
          >
            {isPending ? "Архивирование…" : "Архивировать"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
