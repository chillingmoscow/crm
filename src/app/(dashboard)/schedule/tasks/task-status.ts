import type { TaskDefinition } from "@/lib/schedule/tasks";

export type TaskStatus = "Работает" | "Не настроена" | "Черновик";

/** Чего не хватает, чтобы задачу можно было включить. */
export function taskMissing(
  t: Pick<TaskDefinition, "template_id" | "recurrence" | "items"> &
    Partial<Pick<TaskDefinition, "kind" | "count_config">>,
): string[] {
  return [
    !t.template_id && "шаблона смены",
    !t.recurrence && "повтора",
    t.kind === "stock_count"
      ? !t.count_config && "склада и позиций"
      : !t.items.some((i) => i.kind !== "info") && "пунктов чек-листа",
  ].filter(Boolean) as string[];
}

/** Статус задачи — один для списка и карточки. */
export function taskStatus(
  t: Pick<TaskDefinition, "enabled" | "template_id" | "recurrence" | "items"> &
    Partial<Pick<TaskDefinition, "kind" | "count_config">>,
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
