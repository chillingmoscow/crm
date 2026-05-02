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

interface TrashItemRowProps {
  id: string;
  title: string;
  icon: string | null;
  iconColor: string | null;
  deletedAt: string | null;
  deletedByName: string | null;
}

export function TrashItemRow({
  id,
  title,
  icon,
  iconColor,
  deletedAt,
  deletedByName,
}: TrashItemRowProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onRestore = async () => {
    setPending(true);
    const { error } = await restoreKbPage(id);
    setPending(false);
    if (error) {
      toast.error(`Не удалось восстановить: ${error}`);
      return;
    }
    toast.success("Страница восстановлена");
    router.refresh();
  };

  return (
    <div className="flex items-center gap-3 rounded-md border bg-card p-3">
      <KbPageIcon icon={icon} color={iconColor} size={20} />
      <div className="flex flex-col min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {title || "Без названия"}
        </p>
        <p className="text-xs text-muted-foreground">
          {deletedAt
            ? `Удалено ${formatDistanceToNow(new Date(deletedAt), {
                addSuffix: true,
                locale: ru,
              })}`
            : "Удалено"}
          {deletedByName && (
            <>
              {" · "}
              <span className="text-foreground/80">{deletedByName}</span>
            </>
          )}
        </p>
      </div>
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
  );
}
