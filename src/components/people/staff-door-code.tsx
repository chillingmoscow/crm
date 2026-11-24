"use client";
import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getCandidateDoorCode } from "@/app/(dashboard)/people/candidates/actions";
import { unwrapAction } from "@/lib/actions/result";
/** Код офисного замка сотрудника: кнопка открывает диалог. Один вид в карточках
 *  сотрудника и кандидата. */
export function StaffDoorCode({ userId }: { userId: string }) {
  const [code, setCode] = useState<{
    user_number: number;
    password: string;
  } | null>(null);
  const [busy, start] = useTransition();
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={busy}
        onClick={() =>
          start(async () => {
            try {
              const value = unwrapAction(await getCandidateDoorCode(userId));
              if (value) setCode(value);
              else toast.error("Код замка не найден");
            } catch {
              toast.error("Не удалось получить код замка");
            }
          })
        }
      >
        <KeyRound />
        Код офисного замка
      </Button>
      <Dialog
        open={!!code}
        onOpenChange={(open) => {
          if (!open) setCode(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Код офисного замка</DialogTitle>
            <DialogDescription>
              Данные для ручного добавления в замок. Доступны только владельцу.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Номер пользователя</dt>
              <dd className="mt-1 font-mono text-xl">{code?.user_number}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Код</dt>
              <dd className="mt-1 font-mono text-xl">{code?.password}</dd>
            </div>
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
