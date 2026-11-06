"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
    <Dialog
      open={!!task}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить задачу?</DialogTitle>
          <DialogDescription>
            «{task?.name}» исчезнет из списка. Будущие незаполненные задания
            отменятся. Задания на сегодня, переносы, начатые отчёты и фото,
            история и начисления сохранятся.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? "Удаление…" : "Удалить задачу"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
