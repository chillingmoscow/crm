"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type {
  ColumnSizingState,
  OnChangeFn,
  Table,
} from "@tanstack/react-table";
import { fitColumnWidths, resizeColumnWidths } from "./column-layout";

/** Paint column widths once per animation frame; persist once when the pointer is released. */
export function useTableColumnResize<TData>(
  table: Table<TData>,
  onChange: OnChangeFn<ColumnSizingState>,
) {
  const tableRef = useRef<HTMLTableElement>(null);
  const active = useRef<{ cancel: () => void } | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    const measure = () => setWidth(container.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => active.current?.cancel(), []);
  const columns = table.getVisibleLeafColumns();
  const metrics = columns.map((c) => ({
    size: c.getSize(),
    min: c.columnDef.minSize ?? 80,
    max: c.columnDef.maxSize ?? 800,
    fixed: !c.getCanResize(),
  }));
  const minimumWidth = metrics.reduce(
    (sum, column) => sum + (column.fixed ? column.size : column.min),
    0,
  );
  const minTableWidth = Math.max(
    minimumWidth,
    table.getState().columnSizing.__peopleTableWidth ?? 0,
  );
  const fitted = fitColumnWidths(
    metrics,
    Math.max(width || minimumWidth, minTableWidth),
  );
  const columnWidths = Object.fromEntries(
    columns.map((c, i) => [c.id, fitted[i]]),
  );
  const onResizeStart = useCallback(
    (id: string, event: PointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      active.current?.cancel();
      const el = tableRef.current,
        columns = table.getVisibleLeafColumns(),
        index = columns.findIndex((c) => c.id === id);
      const nodes = el?.querySelectorAll<HTMLTableColElement>("colgroup > col");
      if (!el || !nodes || index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget,
        pointer = event.pointerId,
        startX = event.clientX;
      const metrics = columns.map((c) => ({
        size: c.getSize(),
        min: c.columnDef.minSize ?? 80,
        max: c.columnDef.maxSize ?? 800,
        fixed: !c.getCanResize(),
      }));
      const widths = Array.from(
        el.querySelectorAll("thead tr:first-child th"),
        (th) => th.getBoundingClientRect().width,
      );
      const original = Array.from(nodes, (c) => c.style.width),
        cursor = document.documentElement.style.cursor,
        selection = document.documentElement.style.userSelect;
      let lastX = startX,
        frame = 0,
        done = false,
        next = widths;
      document.documentElement.style.cursor = "col-resize";
      document.documentElement.style.userSelect = "none";
      const paint = () => {
        frame = 0;
        next = resizeColumnWidths(widths, metrics, index, lastX - startX);
        nodes.forEach((c, i) => (c.style.width = `${next[i]}px`));
      };
      const finish = (commit: boolean) => {
        if (done) return;
        done = true;
        if (frame) cancelAnimationFrame(frame);
        if (commit) paint();
        else nodes.forEach((c, i) => (c.style.width = original[i]));
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", cancel);
        window.removeEventListener("blur", cancel);
        handle.removeEventListener("lostpointercapture", cancel);
        document.documentElement.style.cursor = cursor;
        document.documentElement.style.userSelect = selection;
        if (handle.hasPointerCapture(pointer))
          handle.releasePointerCapture(pointer);
        active.current = null;
        if (commit && next.some((v, i) => Math.abs(v - widths[i]) > 0.1))
          onChange((current) => ({
            ...current,
            ...Object.fromEntries(columns.map((c, i) => [c.id, next[i]])),
            __peopleTableWidth: next.reduce((sum, size) => sum + size, 0),
          }));
      };
      const move = (e: globalThis.PointerEvent) => {
        if (e.pointerId === pointer) {
          lastX = e.clientX;
          if (!frame) frame = requestAnimationFrame(paint);
        }
      };
      const up = (e: globalThis.PointerEvent) => {
        if (e.pointerId === pointer) {
          lastX = e.clientX;
          finish(true);
        }
      };
      const cancel = () => finish(false);
      active.current = { cancel };
      handle.setPointerCapture(pointer);
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", cancel);
      handle.addEventListener("lostpointercapture", cancel);
      window.addEventListener("blur", cancel);
    },
    [table, onChange],
  );
  return { tableRef, onResizeStart, columnWidths, minTableWidth };
}
