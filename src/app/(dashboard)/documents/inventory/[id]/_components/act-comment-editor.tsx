"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { SaveBar } from "@/components/shared/save-bar";
import { updateInventoryDocumentNote } from "@/app/(dashboard)/inventory/_actions/documents";

type Props = {
  documentId: string;
  note: string | null;
  canEdit: boolean;
};

/**
 * Комментарий к акту — правка на месте: поле в секции, сохранение через
 * общую полосу `SaveBar` (видна только при изменениях, защищает уход со
 * страницы). Своей кнопки «Сохранить комментарий» нет — design-system
 * § «SaveBar».
 */
export function ActCommentEditor({ documentId, note, canEdit }: Props) {
  const router = useRouter();
  const saved = note ?? "";
  const [value, setValue] = useState(saved);
  const [saving, startSaving] = useTransition();

  // Пришло свежее значение с сервера (после сохранения или правки другим
  // человеком) — поле без несохранённых правок подтягивает его.
  const [lastSaved, setLastSaved] = useState(saved);
  useEffect(() => {
    if (saved !== lastSaved) {
      setLastSaved(saved);
      setValue((current) => (current === lastSaved ? saved : current));
    }
  }, [saved, lastSaved]);

  if (!canEdit) {
    return (
      <p className="whitespace-pre-wrap text-sm">
        {saved.trim() ? saved : <span className="text-muted-foreground">Не указан</span>}
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
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (value !== saved && !saving) save();
      }}
      className="flex flex-col gap-4"
    >
      <Field
        label="Комментарий"
        hint="Не уходит в Quick Resto и не меняется при синхронизации"
      >
        {(control) => (
          <Textarea
            {...control}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={saving}
            rows={4}
            placeholder="Например, что учесть при подсчёте"
          />
        )}
      </Field>
      <SaveBar
        dirty={value !== saved}
        saving={saving}
        onSave={save}
        onReset={() => setValue(saved)}
      />
    </form>
  );
}
