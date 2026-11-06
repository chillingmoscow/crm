"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TaskListRow = {
  id: string;
  name: string;
  details?: string;
  assignee: string;
  timing: string;
  review: string;
  status: string;
  tone?: "positive" | "negative";
  blocker?: string;
  onOpen: () => void;
};

function Status({ row }: { row: TaskListRow }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "whitespace-nowrap font-medium",
        row.tone === "positive" &&
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        row.tone === "negative" && "bg-destructive/10 text-destructive",
      )}
    >
      {row.status}
    </Badge>
  );
}

export function TaskList({
  rows,
  empty,
}: {
  rows: TaskListRow[];
  empty: ReactNode;
}) {
  if (!rows.length)
    return (
      <div className="rounded-lg border bg-card px-5 py-14 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border bg-card sm:block">
        <table
          className="w-full min-w-[820px] text-sm"
          aria-label="Шаблоны задач"
        >
          <thead className="h-11 border-b bg-muted/70 text-left text-xs font-medium text-muted-foreground">
            <tr>
              {[
                "Задача",
                "Ответственная смена",
                "Повторение",
                "Приёмка",
                "Статус",
              ].map((title) => (
                <th key={title} scope="col" className="px-3 py-3 font-medium">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr
                key={row.id}
                className="h-[60px] cursor-pointer transition-colors hover:bg-muted/50"
                onClick={row.onOpen}
              >
                <td className="w-[34%] min-w-64 px-3 py-3">
                  <button
                    className="text-left font-medium leading-5 hover:text-brand focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.stopPropagation();
                      row.onOpen();
                    }}
                  >
                    {row.name}
                  </button>
                  {row.details && (
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {row.details}
                    </p>
                  )}
                  {row.blocker && (
                    <p className="mt-1 max-w-md text-[13px] text-destructive">
                      {row.blocker}
                    </p>
                  )}
                </td>
                <td className="px-3 py-3">{row.assignee}</td>
                <td className="px-3 py-3 text-muted-foreground">
                  {row.timing}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {row.review}
                </td>
                <td className="px-3 py-3">
                  <Status row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y rounded-lg border bg-card sm:hidden">
        {rows.map((row) => (
          <button
            key={row.id}
            className="block w-full space-y-2 px-4 py-4 text-left transition-colors hover:bg-muted/50"
            onClick={row.onOpen}
          >
            <p className="text-sm font-medium leading-5">{row.name}</p>
            <p className="text-[13px] leading-5 text-muted-foreground">
              {row.assignee} · {row.timing}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Status row={row} />
              <span className="text-[13px] text-muted-foreground">
                {row.review}
              </span>
            </div>
            {row.blocker && (
              <p className="text-[13px] text-destructive">{row.blocker}</p>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
