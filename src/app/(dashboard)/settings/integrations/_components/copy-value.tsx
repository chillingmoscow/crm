"use client";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
export function CopyValue({ value, label }: { value: string; label: string }) {
  return <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/30 p-3">
    <code className="min-w-0 flex-1 break-all text-xs leading-5">{value}</code>
    <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Скопировать ${label}`} onClick={async () => {
      try { await navigator.clipboard.writeText(value); toast.success("Скопировано"); }
      catch { toast.error("Не удалось скопировать. Выделите и скопируйте значение вручную."); }
    }}><Copy className="size-4" /></Button>
  </div>;
}
