"use client";

import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import type {
  ColumnSizingState,
  OnChangeFn,
  Table,
} from "@tanstack/react-table";
import type { Candidate } from "@/lib/candidates/types";

/** Update only col widths while dragging; render and persist the final size once. */
export function useCandidateColumnResize(
  table: Table<Candidate>,
  onChange: OnChangeFn<ColumnSizingState>,
) {
  const tableRef = useRef<HTMLTableElement>(null);
  const active = useRef<{ cancel: () => void } | null>(null);
  useEffect(() => () => active.current?.cancel(), []);
  const onResizeStart = useCallback(
    (columnId: string, event: PointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      active.current?.cancel();
      const element = tableRef.current;
      const columns = table.getVisibleLeafColumns();
      const index = columns.findIndex((c) => c.id === columnId);
      const colNodes =
        element?.querySelectorAll<HTMLTableColElement>("colgroup > col");
      if (!element || !colNodes || index < 0 || columns.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      const indicator = handle.firstElementChild as HTMLElement | null;
      const sizes = columns.map((c) => c.getSize());
      const total = sizes.reduce((a, b) => a + b, 0),
        other = total - sizes[index];
      const width = element.getBoundingClientRect().width;
      const startWidth = (width * sizes[index]) / total;
      const min = columns[index].columnDef.minSize ?? 20,
        max = columns[index].columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;
      const startX = event.clientX,
        pointerId = event.pointerId;
      let lastX = startX,
        size = sizes[index],
        frame = 0,
        done = false;
      const original = Array.from(colNodes, (c) => c.style.width);
      const cursor = document.documentElement.style.cursor;
      document.documentElement.style.cursor = "col-resize";
      if (indicator) {
        indicator.style.width = "4px";
        indicator.style.opacity = "1";
        indicator.style.backgroundColor = "hsl(var(--brand))";
      }
      const paint = () => {
        frame = 0;
        const desired = Math.max(
          1,
          Math.min(width - 1, startWidth + lastX - startX),
        );
        size = Math.max(
          min,
          Math.min(max, (desired * other) / (width - desired)),
        );
        const nextTotal = other + size;
        colNodes.forEach((col, i) => {
          col.style.width = `${((i === index ? size : sizes[i]) / nextTotal) * 100}%`;
        });
      };
      const move = (e: globalThis.PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        lastX = e.clientX;
        if (!frame) frame = requestAnimationFrame(paint);
      };
      const finish = (commit: boolean) => {
        if (done) return;
        done = true;
        if (frame) cancelAnimationFrame(frame);
        if (commit) paint();
        else
          colNodes.forEach((col, i) => {
            col.style.width = original[i];
          });
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", cancel);
        window.removeEventListener("blur", cancel);
        handle.removeEventListener("lostpointercapture", cancel);
        document.documentElement.style.cursor = cursor;
        if (indicator) {
          indicator.style.removeProperty("width");
          indicator.style.removeProperty("opacity");
          indicator.style.removeProperty("background-color");
        }
        if (handle.hasPointerCapture(pointerId))
          handle.releasePointerCapture(pointerId);
        active.current = null;
        if (commit && Math.abs(size - sizes[index]) > 0.01)
          onChange((current) => ({ ...current, [columnId]: size }));
      };
      const up = (e: globalThis.PointerEvent) => {
        if (e.pointerId === pointerId) {
          lastX = e.clientX;
          finish(true);
        }
      };
      const cancel = () => finish(false);
      active.current = { cancel };
      handle.setPointerCapture(pointerId);
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", cancel);
      handle.addEventListener("lostpointercapture", cancel);
      window.addEventListener("blur", cancel);
    },
    [table, onChange],
  );
  return { tableRef, onResizeStart };
}
