import type { TaskDefinition } from "@/lib/schedule/tasks";

export type TaskStatus = "Работает" | "Не настроена" | "Черновик";

type SetupFields = Pick<TaskDefinition, "template_id" | "recurrence" | "items">;

/** Чего не хватает, чтобы задачу можно было включить, и на какой вкладке это задают. */
export function taskSetupParts(t: SetupFields): { label: string; tab: string }[] {
  return [
    !t.items.some((i) => i.kind !== "info") && {
      label: "пунктов чек-листа",
      tab: "checklist",
    },
    !t.template_id && { label: "шаблона смены", tab: "settings" },
    !t.recurrence && { label: "повтора", tab: "settings" },
  ].filter(Boolean) as { label: string; tab: string }[];
}

/** Чего не хватает, чтобы задачу можно было включить. */
export function taskMissing(t: SetupFields): string[] {
  return taskSetupParts(t).map((part) => part.label);
}

/** Статус задачи — один для списка и карточки. */
export function taskStatus(
  t: Pick<TaskDefinition, "enabled" | "template_id" | "recurrence" | "items">,
): TaskStatus {
  return t.enabled ? "Работает" : taskMissing(t).length ? "Не настроена" : "Черновик";
}

export function taskStatusTone(status: TaskStatus) {
  return status === "Работает"
    ? "success"
    : status === "Не настроена"
      ? "warning"
      : "neutral";
}
