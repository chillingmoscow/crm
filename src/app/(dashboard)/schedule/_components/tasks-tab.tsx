"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { PageFrame } from "@/components/shared/page-frame";
import type { TaskData } from "@/lib/schedule/tasks";
import { TaskTitleTarget } from "./task-header-actions";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";

function TaskLoading() {
  return (
    <div role="status" aria-label="Загрузка задач" className="space-y-4 py-2">
      <div className="h-10 w-64 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
const TasksClient = dynamic(
  () => import("../tasks/tasks-client").then((module) => module.TasksClient),
  { loading: TaskLoading },
);

export function ScheduleTasksTab({ initial }: { initial: TaskData }) {
  // Название открытой задачи нужно только чтобы спрятать путь раздела:
  // карточка задачи ставит свой «График работы / Задачи / Название», а шапку
  // с плиткой и вкладками рисует сама (канон карточки сущности).
  const [title, setTitle] = useState<string | null>(null);
  return (
    <TaskTitleTarget.Provider value={setTitle}>
      {title === null && (
        <Breadcrumbs
          items={[{ label: "График работы" }, { label: "Задачи" }]}
        />
      )}
      <PageFrame className="space-y-6">
        <section>
          <TasksClient initial={initial} />
        </section>
      </PageFrame>
    </TaskTitleTarget.Provider>
  );
}
