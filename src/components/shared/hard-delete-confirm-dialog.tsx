"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  entityGenitive: string;
  entityName: string;
  impact: DeleteImpact[];
  /**
   * Если непусто — кнопка подтверждения disabled, сверху показывается
   * блокирующий блок с подсказкой. На сервере re-checked тоже.
   */
  restrictedBy: DeleteRestriction[];
  onConfirm: () => Promise<{ error: string | null } | void>;
};

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
  const [isPending, startTransition] = useTransition();
  const matches = input.trim() === entityName.trim();
  const blocked = restrictedBy.length > 0;
  const visibleImpact = impact.filter((row) => row.count > 0);
  const cascade = visibleImpact.filter((row) => row.tone === "cascade");
  const unbind = visibleImpact.filter((row) => row.tone === "unbind");

  useEffect(() => {
    if (!open) setInput("");
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Удалить {entityGenitive} навсегда
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                <span className="font-medium text-destructive">
                  Действие необратимо.
                </span>{" "}
                Часть данных будет полностью удалена, часть — отвяжется и
                продолжит существовать как «без заведения».
              </p>
              <p className="text-sm">
                Если не уверены — воспользуйтесь «Архивировать»: сущность
                скроется, но данные сохранятся.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {blocked ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <p className="mb-1 text-xs font-medium text-destructive">
              Нельзя удалить — есть блокирующие связи:
            </p>
            <ul className="space-y-1 text-sm">
              {restrictedBy.map((row) => (
                <li key={row.label}>
                  <span className="font-medium">{row.label}:</span>{" "}
                  <span className="tabular-nums">{row.count}</span>
                  {row.hint ? (
                    <span className="block text-xs text-muted-foreground">
                      {row.hint}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {cascade.length > 0 ? (
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <p className="mb-1.5 text-xs font-medium text-destructive">
              Будет удалено вместе:
            </p>
            <ul className="space-y-0.5 text-sm">
              {cascade.map((row) => (
                <li key={row.label} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium tabular-nums">{row.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {unbind.length > 0 ? (
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Отвяжется (сохранится без привязки):
            </p>
            <ul className="space-y-0.5 text-sm">
              {unbind.map((row) => (
                <li key={row.label} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium tabular-nums">{row.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="hard-delete-confirm-input" className="text-sm">
            Для подтверждения введите название:{" "}
            <span className="font-medium text-foreground">{entityName}</span>
          </Label>
          <Input
            id="hard-delete-confirm-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={entityName}
            autoComplete="off"
            spellCheck={false}
            disabled={blocked}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            disabled={!matches || isPending || blocked}
            className={cn(
              buttonVariants({ variant: "destructive" }),
              "shadow-sm",
            )}
            onClick={(e) => {
              e.preventDefault();
              startTransition(async () => {
                await onConfirm();
              });
            }}
          >
            {isPending ? "Удаление…" : "Удалить навсегда"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
