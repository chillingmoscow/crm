"use client";
import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getCandidateDoorCode } from "../actions";
export function StaffDoorCode({ userId }: { userId: string }) {
  const [code, setCode] = useState<{user_number: number; password: string} | null>(null);
  const [busy, start] = useTransition();
  return <>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
      try { const value = await getCandidateDoorCode(userId); if (value) setCode(value); else toast.error("Код замка не найден"); }
      catch { toast.error("Не удалось получить код замка"); }
    })}><KeyRound className="mr-2 size-4" />Код офисного замка</Button>
    <Dialog open={!!code} onOpenChange={open => { if (!open) setCode(null); }}>
      <DialogContent><DialogHeader><DialogTitle>Код офисного замка</DialogTitle><DialogDescription>Данные для ручного добавления в замок. Доступны только владельцу.</DialogDescription></DialogHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-muted-foreground">Номер пользователя</dt><dd className="mt-1 font-mono text-lg">{code?.user_number}</dd></div><div><dt className="text-muted-foreground">Код</dt><dd className="mt-1 font-mono text-lg">{code?.password}</dd></div></dl>
      </DialogContent>
    </Dialog>
  </>;
}
