"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { PageFrame } from "@/components/shared/page-frame";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { TablePageHeader } from "@/components/shared/table";
import type { TaskData } from "@/lib/schedule/tasks";
import { TaskHeaderTarget, TaskTitleTarget } from "./task-header-actions";

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
  const [title, setTitle] = useState<string | null>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  return (
    <TaskTitleTarget.Provider value={setTitle}>
      {/* Как у «Расписания» и «Шаблонов смен»: путь раздела в верхней панели.
          Экраны задачи и настроек ставят свою «← К задачам» — тогда не дублируем. */}
      {title === null && (
        <PageBreadcrumb>
          <nav aria-label="Навигация по разделам" className="flex min-w-0 items-center gap-2 text-sm">
            <span className="text-muted-foreground">График работы</span>
            <span aria-hidden="true" className="text-muted-foreground">/</span>
            <span className="truncate">Задачи</span>
          </nav>
        </PageBreadcrumb>
      )}
      <PageFrame className="space-y-6">
        {title !== null && (
          <TablePageHeader
            title={title}
            actions={<div ref={setHeaderTarget} className="flex flex-wrap items-center gap-2" />}
          />
        )}
        <section>
          <TaskHeaderTarget.Provider value={headerTarget}>
            <TasksClient initial={initial} />
          </TaskHeaderTarget.Provider>
        </section>
      </PageFrame>
    </TaskTitleTarget.Provider>
  );
}
