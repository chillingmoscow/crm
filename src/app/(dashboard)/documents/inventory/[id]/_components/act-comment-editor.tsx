"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateInventoryDocumentNote } from "@/app/(dashboard)/inventory/actions";

type Props = {
  documentId: string;
  note: string | null;
  canEdit: boolean;
};

export function ActCommentEditor({ documentId, note, canEdit }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(note ?? "");
  const [saving, startSaving] = useTransition();

  const dirty = (note ?? "") !== value;

  if (!canEdit) {
    return (
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
        {note?.trim() ? note : "Комментарий не задан."}
      </p>
    );
  }

  const save = () => {
    startSaving(async () => {
      const result = await updateInventoryDocumentNote({ documentId, note: value });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Комментарий сохранён");
      router.refresh();
    });
  };

  return (
    <div className="max-w-2xl">
      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={saving}
        rows={4}
        placeholder="Общий комментарий к акту…"
      />
      <Button type="button" className="mt-3" disabled={!dirty || saving} onClick={save}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Сохранить комментарий
      </Button>
    </div>
  );
}
