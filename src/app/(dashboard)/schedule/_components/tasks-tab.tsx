"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { PageFrame } from "@/components/shared/page-frame";
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
