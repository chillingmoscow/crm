"use client";

import type { ReactNode } from "react";
import { flexRender, type Table, type Row } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import styles from "./people-table.module.css";

/** Mobile presentation of the same rows, selection, fields and ordering as the desktop table. */
export function PeopleMobileCards<T>({
  table,
  label,
  nameColumn,
  photoColumn,
  roleColumn,
  statusColumn,
  labels,
  selection,
  empty,
  onOpen,
}: {
  table: Table<T>;
  label: string;
  nameColumn: string;
  photoColumn: string;
  roleColumn: string;
  statusColumn?: string;
  labels: Record<string, string>;
  selection?: ReactNode;
  empty: ReactNode;
  onOpen?: (row: Row<T>) => void;
}) {
  const rows = table.getRowModel().rows;
  return (
    <section className={styles.mobileCards} aria-label={label}>
      {selection}
      {rows.map((row) => {
        const cells = row.getVisibleCells();
        const render = (id: string) => {
          const cell = cells.find((c) => c.column.id === id);
          return cell
            ? flexRender(cell.column.columnDef.cell, cell.getContext())
            : null;
        };
        const details = cells.filter(
          (cell) =>
            ![
              nameColumn,
              photoColumn,
              roleColumn,
              statusColumn,
              "select",
              "actions",
            ].includes(cell.column.id),
        );
        const hasRole = cells.some((c) => c.column.id === roleColumn);
        const hasStatus = cells.some((c) => c.column.id === statusColumn);
        return (
          <article
            key={row.id}
            className={cn(
              styles.mobileCard,
              row.getIsSelected() && styles.mobileCardSelected,
            )}
            onClick={(event) => {
              if (
                !(event.target as HTMLElement).closest(
                  "button,a,input,[role=checkbox]",
                )
              )
                onOpen?.(row);
            }}
          >
            <div className="flex items-start gap-3">
              {render(photoColumn)}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className={styles.cardName}>{render(nameColumn)}</div>
                {hasRole && (
                  <div className="text-sm text-muted-foreground">
                    {render(roleColumn)}
                  </div>
                )}
              </div>
              {cells.some((cell) => cell.column.id === "select") ? (
                <label className="flex size-9 shrink-0 cursor-pointer items-center justify-center -mr-2">
                  {render("select")}
                </label>
              ) : (
                <div className="flex h-9 shrink-0 items-center">
                  {render("actions")}
                </div>
              )}
            </div>
            {hasStatus && <div className="mt-3">{render(statusColumn!)}</div>}
            {details.length > 0 && (
              <dl className={styles.cardFields}>
                {details.map((cell) => (
                  <div key={cell.id}>
                    <dt>{labels[cell.column.id]}</dt>
                    <dd>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </article>
        );
      })}
      {!rows.length && (
        <div className="rounded-lg border px-5 py-10 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      )}
    </section>
  );
}
