"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import type { TaskData } from "@/lib/schedule/tasks";
import { loadTasks } from "../tasks/actions";

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

export function ScheduleTasksTab({
  initial,
  active,
}: {
  initial: TaskData | null;
  active: boolean;
}) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(!initial);
  const retry = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setData(await loadTasks());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    loadTasks()
      .then((next) => {
        if (alive) setData(next);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [initial]);
  if (loading) return <TaskLoading />;
  if (error || !data)
    return (
      <div role="alert" className="space-y-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          Не удалось загрузить задачи
        </p>
        <Button variant="outline" onClick={() => void retry()}>
          Попробовать ещё раз
        </Button>
      </div>
    );
  return <TasksClient initial={data} active={active} />;
}
