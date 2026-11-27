"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

/** Тяжёлое тело с BlockNote-хуком (`useCreateBlockNote` пытается прицепить
 *  `window.ProseMirror` и крашит SSR-проход). Подгружаем динамически с
 *  `ssr: false` — Radix-counter'ы тогда не сдвигаются между server/client
 *  (иначе hydration mismatch на aria-controls в `KbTemplatePicker` и др.). */
const KbImportDialogBody = dynamic(
  () => import("./kb-import-dialog-body"),
  { ssr: false, loading: () => <ImportDialogSkeleton /> },
);

/** Окно импорта, пока подгружается его тело: та же рамка, заготовки вместо полей. */
function ImportDialogSkeleton() {
  return (
    <DialogContent aria-busy>
      <DialogHeader>
        <DialogTitle>Импорт из Markdown / Notion</DialogTitle>
      </DialogHeader>
      <div role="status" aria-label="Открываем импорт" className="space-y-3">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </DialogContent>
  );
}

interface KbImportDialogProps {
  parentId?: string | null;
  triggerLabel?: string;
  /** Controlled-mode: caller владеет open-state'ом, default-trigger
   *  не рендерится. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}

export function KbImportDialog({
  parentId = null,
  triggerLabel,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: KbImportDialogProps) {
  const [openInternal, setOpenInternal] = useState(false);
  const isControlled = openProp !== undefined && onOpenChangeProp !== undefined;
  const open = isControlled ? openProp : openInternal;
  const setOpen = isControlled ? onOpenChangeProp : setOpenInternal;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <IconTooltip label={triggerLabel ?? "Импорт из Markdown / Notion"}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Импорт"
            >
              <Upload className="size-3.5" />
            </Button>
          </DialogTrigger>
        </IconTooltip>
      )}
      {open && (
        <KbImportDialogBody parentId={parentId} onClose={() => setOpen(false)} />
      )}
    </Dialog>
  );
}
