"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { markKbPageAsRead } from "@/lib/knowledge/required-reading";

interface KbRequiredReadingBannerProps {
  pageId: string;
  /** Помечена ли страница как обязательная (server-rendered initial). */
  required: boolean;
  /** Когда current user подтвердил прочтение (null если ещё нет). */
  initialReadAt: string | null;
}

/**
 * Баннер «Требуется прочтение» / «✓ Прочитано».
 *
 * Состояния:
 *   1. required=false → ничего не рендерится (compliance-флаг не
 *      выставлен).
 *   2. required=true + readAt=null → жёлтый баннер с кнопкой
 *      «Подтверждаю прочитано».
 *   3. required=true + readAt!=null → зелёный mini-badge «✓ Прочитано
 *      <дата>». Compact, не отвлекает.
 *
 * После подтверждения — optimistic switch в зелёный bдge + router
 * refresh (чтобы подтянуть статус если страница обновится).
 */
export function KbRequiredReadingBanner({
  pageId,
  required,
  initialReadAt,
}: KbRequiredReadingBannerProps) {
  const router = useRouter();
  const [readAt, setReadAt] = useState<string | null>(initialReadAt);
  const [pending, setPending] = useState(false);

  if (!required) return null;

  if (readAt) {
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5
                   text-[12px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
      >
        <CheckCircle2 className="size-3.5" />
        Прочитано {formatReadAt(readAt)}
      </div>
    );
  }

  const onConfirm = async () => {
    setPending(true);
    const { error } = await markKbPageAsRead(pageId);
    setPending(false);
    if (error) {
      toast.error(`Не удалось подтвердить: ${error}`);
      return;
    }
    setReadAt(new Date().toISOString());
    toast.success("Прочтение подтверждено");
    router.refresh();
  };

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4
                 dark:border-yellow-900 dark:bg-yellow-950"
    >
      <span className="shrink-0 inline-flex items-center justify-center size-8 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
        <AlertTriangle className="size-4" />
      </span>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="text-sm font-semibold text-yellow-900 dark:text-yellow-100">
          Требуется прочтение
        </div>
        <div className="text-[13px] leading-snug text-yellow-800 dark:text-yellow-200">
          Эта страница помечена как обязательная к прочтению. После того как
          ознакомитесь с содержимым — подтвердите прочтение.
        </div>
      </div>
      <Button
        size="sm"
        onClick={onConfirm}
        disabled={pending}
        className="shrink-0 bg-yellow-600 hover:bg-yellow-700 text-white"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        Подтверждаю прочитано
      </Button>
    </div>
  );
}

function formatReadAt(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
