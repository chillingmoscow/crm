"use client";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { TaskDefinition } from "@/lib/schedule/tasks";
import { deleteTask } from "./actions";
export function DeleteTaskDialog({
  task,
  onClose,
  onDeleted,
}: {
  task: TaskDefinition | null;
  onClose: () => void;
  onDeleted: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!task || busy) return;
    setBusy(true);
    try {
      const result = await deleteTask({ id: task.id, version: task.version });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Задача удалена");
      onClose();
      await onDeleted();
    } catch {
      toast.error("Не удалось обновить список. Обновите страницу.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmDialog
      open={!!task}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Удалить задачу?"
      description={`«${task?.name ?? ""}» исчезнет из списка.`}
      consequences={[
        { kind: "remove", text: "Будущие незаполненные задания отменятся" },
        {
          kind: "keep",
          text: "Задания на сегодня, переносы, начатые отчёты и фото, история и начисления сохранятся",
        },
      ]}
      confirmLabel="Удалить задачу"
      pendingLabel="Удаление…"
      destructive
      busy={busy}
      onConfirm={() => void remove()}
    />
  );
}
