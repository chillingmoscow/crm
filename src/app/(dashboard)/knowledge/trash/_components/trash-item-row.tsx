"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { restoreKbPage } from "@/lib/knowledge/pages";
import { TrashPreviewSheet } from "./trash-preview-sheet";

interface TrashItemRowProps {
  id: string;
  title: string;
  icon: string | null;
  iconColor: string | null;
  /** Cascade-deleted descendants count — surfaces в meta-строке для
   *  ясности что restore вернёт всё дерево. */
  descendantsCount: number;
  deletedAt: string | null;
  deletedByName: string | null;
}

export function TrashItemRow({
  id,
  title,
  icon,
  iconColor,
  descendantsCount,
  deletedAt,
  deletedByName,
}: TrashItemRowProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onRestore = async () => {
    setPending(true);
    const { restored, error } = await restoreKbPage(id);
    setPending(false);
    if (error) {
      toast.error(`Не удалось восстановить: ${error}`);
      return;
    }
    toast.success(
      restored > 1
        ? `Восстановлено страниц: ${restored}`
        : "Страница восстановлена",
    );
    router.refresh();
  };

  // Single-line meta: «Удалено N · Имя · +M подстраниц» — раньше
  // было block-уровневое stack, выглядело squashed.
  const metaParts: string[] = [];
  if (deletedAt) {
    metaParts.push(
      `Удалено ${formatDistanceToNow(new Date(deletedAt), {
        addSuffix: true,
        locale: ru,
      })}`,
    );
  }
  if (deletedByName) metaParts.push(deletedByName);
  if (descendantsCount > 0) {
    metaParts.push(`+ ${descendantsCount} ${childWord(descendantsCount)}`);
  }

  return (
    <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5">
      <KbPageIcon icon={icon} color={iconColor} size={20} />
      <p className="truncate text-sm font-medium min-w-0 flex-1">
        {title || "Без названия"}
      </p>
      <p className="hidden md:block shrink-0 text-xs text-muted-foreground truncate max-w-[420px]">
        {metaParts.join(" · ")}
      </p>
      <div className="flex items-center gap-1 shrink-0">
        <TrashPreviewSheet
          pageId={id}
          title={title}
          icon={icon}
          iconColor={iconColor}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={onRestore}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCcw className="size-4" />
          )}
          Восстановить
        </Button>
      </div>
    </div>
  );
}

function childWord(n: number): string {
  // 1, 21, 31 → подстраница; 2-4, 22-24 → подстраницы; 5-20, 25-30 → подстраниц
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "подстраниц";
  if (mod10 === 1) return "подстраница";
  if (mod10 >= 2 && mod10 <= 4) return "подстраницы";
  return "подстраниц";
}
